"""
Módulo Sistema — backup/exportação e reset completo dos dados.
Único par de endpoints do app que enxerga
o banco inteiro em vez de um módulo específico.

Endpoints:
  GET  /api/sistema/export   devolve TODAS as tabelas do usuário em JSON
  POST /api/sistema/import   substitui TODOS os dados atuais pelo
                             conteúdo de um export anterior (mesmo
                             formato devolvido por /export)
  POST /api/sistema/reset    apaga tudo e recria o estado de instalação
                             nova (mesma seed do primeiro boot)
  POST /api/sistema/erro-frontend
                             registra no kami-backend.log um erro de
                             JavaScript da tela (CONF-01)

Nota sobre /import: `email_accounts.app_password_enc`,
`github_settings.token_enc` e `search_settings.api_key_enc` no export
saem criptografados com a chave local da máquina (app/crypto.py +
.secret_key) — um export importado numa instalação diferente não vai
conseguir descriptografar essas credenciais, só o resto dos dados.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, _seed_defaults, migrate_timestamps_to_local, now_iso
from app.version import KAMI_VERSION

logger = logging.getLogger(__name__)

router = APIRouter()

RESET_CONFIRMATION_WORD = "excluir"
IMPORT_CONFIRMATION_WORD = "importar"

# ordem de leaf -> root, pra respeitar as foreign keys mesmo em bancos
# onde PRAGMA foreign_keys por algum motivo não esteja ativa na conexão
# (defesa em profundidade — get_connection() já liga isso, mas um
# DELETE explícito na ordem certa não depende disso pra funcionar).
_TABLES_DELETE_ORDER = [
    "calendar_events",
    "screen_tips_seen",
    "action_log_attributes",
    "dias_protegidos",
    "missoes",
    "retrospectivas",
    "action_logs",
    "career_salary_records",
    "career_educations",
    "career_positions",
    "career_interests",
    "career_profile",
    "income_entries",
    "compras_parceladas",
    "wallet_subscription_periods",
    "wallet_subscriptions",
    "transactions",
    "wallet_accounts",
    "wallet_banks",
    "milestones",
    "tracks",
    "email_cache",
    "muted_accounts",
    "email_accounts",
    "goal_contributions",
    "goals",
    "income_sources",
    "fixed_bill_periods",
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

    exported_at = now_iso()

    # registra que um backup de verdade acabou de ser feito — usado pelo
    # lembrete discreto do frontend ("faz tempo que você não exporta um
    # backup"). Só o GET /export conta como backup real; import/reset não
    # mexem nisso, cada um cuida da própria semântica.
    if "user_profile" in tables and tables["user_profile"]:
        db.execute(
            "UPDATE user_profile SET last_backup_at = ? WHERE id = ?",
            (exported_at, tables["user_profile"][0]["id"]),
        )
        db.commit()
        tables["user_profile"][0]["last_backup_at"] = exported_at

    return {
        "kami_version": KAMI_VERSION,
        "exported_at": exported_at,
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
    arbitrários na query.

    Roda com `PRAGMA foreign_keys = OFF` durante a troca inteira — a
    ordem de delete/insert (_TABLES_DELETE_ORDER/_TABLES_IMPORT_ORDER)
    parou de garantir isso sozinha assim que metas ganhou colunas de FK
    cruzando pra tracks/wallet_accounts/transactions (migração v2, ver
    _migrate_goals_v2) sem que a lista de ordem fosse atualizada junto.
    Manter uma lista de ordem manual em dia a cada FK nova que aparecer
    é frágil demais pra confiar — desligar a checagem durante a troca
    (delete + insert de TODAS as tabelas na mesma transação) e validar
    o resultado final com `PRAGMA foreign_key_check` antes de comitar
    resolve isso de vez, pra qualquer dependência futura. Um backup com
    uma referência de verdade quebrada (não só fora de ordem) ainda é
    rejeitado — só que agora apontando a tabela/linha exata.
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
        # tabelas que de fato existem neste banco — se o schema.sql do
        # código for mais novo que este kami.db (ex.: sidecar compilado
        # antes de uma tabela nova ser adicionada), a tabela nova ainda
        # não existe aqui e um DELETE incondicional quebraria o import
        # inteiro por causa de uma tabela que nem tem dado pra apagar.
        existing_tables = {
            r["name"]
            for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }

        # ver docstring — desligado durante toda a troca porque a ordem
        # de delete/insert não é mais suficiente sozinha pra cobrir as
        # FKs cruzadas de metas v2. PRAGMA só pode mudar fora de uma
        # transação pendente, por isso vem antes do primeiro DELETE.
        db.execute("PRAGMA foreign_keys = OFF")

        for table in _TABLES_DELETE_ORDER:
            if table not in existing_tables:
                continue
            db.execute(f"DELETE FROM {table}")  # nomes vêm da whitelist fixa, não do arquivo importado

        for table in _TABLES_IMPORT_ORDER:
            if table not in existing_tables:
                continue
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

        # com a checagem desligada durante os inserts, uma referência
        # de verdade quebrada (não só fora de ordem) só aparece aqui —
        # confere antes de comitar, senão o import "funcionaria" e
        # deixaria o banco com uma FK pendurada em nada.
        # backups de versões antigas trazem horários em UTC sem offset —
        # converte pro fuso local, igual ao que init_db faz no banco
        migrate_timestamps_to_local(db)

        violations = db.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            detail = "; ".join(f"{v['table']} (linha {v['rowid']} → {v['parent']})" for v in violations[:5])
            raise ValueError(f"referências quebradas no backup: {detail}")

        db.commit()
    except Exception as exc:
        db.rollback()
        # antes essa exceção era totalmente engolida — só sobrava "400
        # Bad Request" no log, sem pista nenhuma do motivo real.
        logger.exception("falha ao importar backup")
        raise HTTPException(
            status_code=400,
            detail=f"falha ao importar o backup — arquivo corrompido, incompatível, ou dados inconsistentes; nenhuma alteração foi feita ({exc})",
        ) from exc
    finally:
        # religa sempre — get_connection() liga por padrão, mas cada
        # request tem sua própria conexão (get_db()), então isso é só
        # devolver esta conexão específica pro estado padrão antes dela
        # ser fechada/reciclada, sucesso ou falha.
        db.execute("PRAGMA foreign_keys = ON")

    # backups antigos trazem conquistas sem `chave` (e sem as conquistas
    # adicionadas depois) — reaplica o seed, mesmo passo do init_db
    from app.achievements import seed_achievements
    seed_achievements(db)

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

    existing_tables = {
        r["name"]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    }
    for table in _TABLES_DELETE_ORDER:
        if table not in existing_tables:
            continue
        db.execute(f"DELETE FROM {table}")  # _TABLES_DELETE_ORDER é uma constante fixa do código, não input externo
    db.commit()

    _seed_defaults(db)
    from app.achievements import seed_achievements
    seed_achievements(db)
    db.commit()

    return {"status": "ok"}


# ── erros de JavaScript da tela → kami-backend.log (CONF-01) ─────────────
#
# Por que existe: o log do backend é o único lugar que a pessoa consegue
# anexar num relato de problema, e um erro de JavaScript na tela (ex.: um
# widget que quebra só no WebView2 do Windows) não deixava rastro nenhum.
# O frontend (components/error-notice.js) manda aqui a mensagem e o
# arquivo/linha do erro — nunca dados digitados pelo usuário — e isso
# vira uma linha com data/hora no mesmo log.
#
# Limites: cada campo é cortado no tamanho máximo do modelo, e o processo
# registra no máximo FRONTEND_ERRORS_MAX erros por execução — um erro num
# loop de render não pode encher o disco.

FRONTEND_ERRORS_MAX = 50
_frontend_errors_logged = 0
frontend_logger = logging.getLogger("app.frontend")


class FrontendErrorIn(BaseModel):
    tipo: str = Field("erro", max_length=20)
    mensagem: str = Field(..., max_length=500)
    origem: str = Field("", max_length=300)
    linha: int | None = None
    coluna: int | None = None
    pilha: str = Field("", max_length=2000)
    tela: str = Field("", max_length=60)
    versao: str = Field("", max_length=20)


@router.post("/erro-frontend", status_code=204)
def registrar_erro_frontend(payload: FrontendErrorIn):
    global _frontend_errors_logged
    if _frontend_errors_logged >= FRONTEND_ERRORS_MAX:
        return None
    _frontend_errors_logged += 1
    onde = payload.origem
    if payload.linha is not None:
        posicao = f"{payload.linha}" + (f":{payload.coluna}" if payload.coluna is not None else "")
        # sem arquivo (código avaliado na hora): "linha 1:24" em vez de ":1:24"
        onde = f"{onde}:{posicao}" if onde else f"linha {posicao}"
    frontend_logger.warning(
        "%s na tela %s: %s%s%s",
        payload.tipo,
        payload.tela or "?",
        payload.mensagem,
        f" ({onde})" if onde else "",
        f"\n{payload.pilha}" if payload.pilha else "",
    )
    if _frontend_errors_logged == FRONTEND_ERRORS_MAX:
        frontend_logger.warning("limite de %d erros da tela atingido — os próximos não serão registrados", FRONTEND_ERRORS_MAX)
    return None
