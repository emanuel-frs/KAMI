"""
Módulo Sistema — backup/exportação e reset completo dos dados
(ALINHAMENTO.md 4.3/4.4). Único par de endpoints do app que enxerga
o banco inteiro em vez de um módulo específico.

Endpoints:
  GET  /api/system/export   devolve TODAS as tabelas do usuário em JSON
  POST /api/system/import   substitui TODOS os dados atuais pelo
                             conteúdo de um export anterior (mesmo
                             formato devolvido por /export)
  POST /api/system/reset    apaga tudo e recria o estado de instalação
                             nova (mesma seed do primeiro boot)

Nota sobre /import: `email_accounts.app_password_enc`,
`github_settings.token_enc` e `search_settings.api_key_enc` no export
saem criptografados com a chave local da máquina (app/crypto.py +
.secret_key) — um export importado numa instalação diferente não vai
conseguir descriptografar essas credenciais, só o resto dos dados.
"""
import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, _seed_defaults
from app.version import KAMI_VERSION

router = APIRouter()

RESET_CONFIRMATION_WORD = "excluir"
IMPORT_CONFIRMATION_WORD = "importar"

# ordem de leaf -> root, pra respeitar as foreign keys mesmo em bancos
# onde PRAGMA foreign_keys por algum motivo não esteja ativa na conexão
# (defesa em profundidade — get_connection() já liga isso, mas um
# DELETE explícito na ordem certa não depende disso pra funcionar).
_TABLES_DELETE_ORDER = [
    "action_log_attributes",
    "action_logs",
    "income_entries",
    "compra_parcelada_aplicacoes",
    "compras_parceladas",
    "wallet_subscription_periods",
    "wallet_subscriptions",
    "transactions",
    "wallet_accounts",
    "wallet_banks",
    "milestones",
    "tracks",
    "email_cache",
    "email_accounts",
    "goal_contributions",
    "goals",
    "income_sources",
    "fixed_bills",
    "debts",
    "links",
    "github_repos",
    "github_settings",
    "search_settings",
    "achievements",
    "attributes",
    "dashboard_widgets",
    "user_profile",
]

# ordem inversa de _TABLES_DELETE_ORDER (root -> leaf): ao importar,
# insere primeiro quem é referenciado por FK antes de quem referencia,
# senão a própria FK que o `PRAGMA foreign_keys = ON` da conexão
# (app/database.py) rejeitaria a inserção fora de ordem.
_TABLES_IMPORT_ORDER = list(reversed(_TABLES_DELETE_ORDER))


class ResetIn(BaseModel):
    confirmation: str


class ImportIn(BaseModel):
    confirmation: str
    tables: dict[str, list[dict]]


@router.get("/export")
def export_data(db=Depends(get_db)):
    """
    Dump completo em JSON de todas as tabelas de usuário — introspecta
    `sqlite_master` em vez de listar tabelas na mão, pra não exigir
    lembrar de atualizar este endpoint toda vez que schema.sql ganhar
    uma tabela nova.
    """
    table_names = [
        r["name"]
        for r in db.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name"
        ).fetchall()
    ]

    tables = {}
    for name in table_names:
        rows = db.execute(f"SELECT * FROM {name}").fetchall()  # nomes vêm do próprio sqlite_master, não de input externo
        tables[name] = [dict(r) for r in rows]

    return {
        "kami_version": KAMI_VERSION,
        "exported_at": datetime.datetime.utcnow().isoformat(),
        "tables": tables,
    }


@router.post("/import")
def import_data(payload: ImportIn, db=Depends(get_db)):
    """
    Substitui TODOS os dados atuais pelo conteúdo de `tables` (mesmo
    formato do campo `tables` devolvido por /export). Irreversível e
    destrutivo com os dados atuais — por isso a mesma exigência de
    palavra de confirmação exata no corpo da requisição usada em
    /reset (a confirmação do frontend, com o modal explícito, é
    conveniência de UX; essa aqui é a barreira de verdade).

    Só aceita tabelas conhecidas (whitelist = _TABLES_IMPORT_ORDER) e,
    dentro de cada uma, só colunas que de fato existem no schema atual
    (via PRAGMA table_info) — protege contra um arquivo adulterado ou
    de uma versão incompatível do Kami injetar nomes de tabela/coluna
    arbitrários na query. Tudo roda numa única transação: se qualquer
    linha falhar (ex.: FK apontando pra um id que não veio no arquivo),
    a operação inteira é desfeita e os dados atuais permanecem intactos.
    """
    if payload.confirmation != IMPORT_CONFIRMATION_WORD:
        raise HTTPException(
            status_code=422,
            detail=f"confirmação inválida; envie confirmation='{IMPORT_CONFIRMATION_WORD}' pra prosseguir",
        )

    if "user_profile" not in payload.tables:
        raise HTTPException(
            status_code=422,
            detail="arquivo não parece ser um backup válido do Kami (faltando user_profile)",
        )

    try:
        for table in _TABLES_DELETE_ORDER:
            db.execute(f"DELETE FROM {table}")  # nomes vêm da whitelist fixa, não do arquivo importado

        for table in _TABLES_IMPORT_ORDER:
            rows = payload.tables.get(table)
            if not rows:
                continue
            valid_cols = {r["name"] for r in db.execute(f"PRAGMA table_info({table})").fetchall()}
            for row in rows:
                cols = [c for c in row.keys() if c in valid_cols]  # descarta colunas de versões incompatíveis do schema
                if not cols:
                    continue
                placeholders = ", ".join("?" for _ in cols)
                col_list = ", ".join(cols)
                values = [row[c] for c in cols]
                db.execute(f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})", values)

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="falha ao importar o backup — arquivo corrompido, incompatível, ou dados inconsistentes; nenhuma alteração foi feita",
        ) from exc

    return {"status": "ok"}


@router.post("/reset")
def reset_data(payload: ResetIn, db=Depends(get_db)):
    """
    Apaga TODOS os dados do usuário e recria o estado de instalação
    nova — mesma seed que roda no primeiro boot (perfil vazio,
    atributos zerados, renda default, layout default de dashboard,
    conquistas todas bloqueadas). Irreversível: por isso a exigência
    de mandar a palavra de confirmação exata no corpo da requisição,
    em vez de confiar só na confirmação do lado do frontend.
    """
    if payload.confirmation != RESET_CONFIRMATION_WORD:
        raise HTTPException(
            status_code=422,
            detail=f"confirmação inválida; envie confirmation='{RESET_CONFIRMATION_WORD}' pra prosseguir",
        )

    for table in _TABLES_DELETE_ORDER:
        db.execute(f"DELETE FROM {table}")  # _TABLES_DELETE_ORDER é uma constante fixa do código, não input externo
    db.commit()

    _seed_defaults(db)
    from app.achievements import seed_achievements
    seed_achievements(db)
    db.commit()

    return {"status": "ok"}