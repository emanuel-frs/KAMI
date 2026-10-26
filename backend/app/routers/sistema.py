"""
Módulo Sistema — backup/exportação e reset completo dos dados.
Único par de endpoints do app que enxerga
o banco inteiro em vez de um módulo específico.

Endpoints:
  GET  /api/sistema/export   devolve TODAS as tabelas do usuário em JSON
  POST /api/sistema/export-protegido
                             o mesmo backup, cifrado com uma senha e com
                             as senhas salvas dentro (SEG-03)
  POST /api/sistema/import   substitui TODOS os dados atuais pelo
                             conteúdo de um export anterior (mesmo
                             formato devolvido por /export, ou o arquivo
                             protegido + a senha)
  POST /api/sistema/reset    apaga tudo e recria o estado de instalação
                             nova (mesma seed do primeiro boot)
  POST /api/sistema/remover-do-computador
                             DIST-03: apaga a chave do cofre do sistema;
                             os arquivos quem apaga é o app (src-tauri),
                             depois de derrubar este backend
  POST /api/sistema/erro-frontend
                             registra no kami-backend.log um erro de
                             JavaScript da tela (CONF-01)
  GET  /api/sistema/diagnostico
                             texto pra colar num relato de problema:
                             versão, sistema e o fim do log, SEM dados
                             pessoais (CONF-06)

Nota sobre /import: no backup SEM senha, `email_accounts.app_password_enc`,
`github_settings.token_enc` e `search_settings.api_key_enc` saem
cifrados com a chave local da máquina (app/crypto.py — no cofre do
sistema desde a 1.11): importado em outra instalação, esses três não
abrem, só o resto. No backup COM senha eles vão decifrados dentro do
arquivo cifrado e voltam cifrados com a chave de quem importa.
"""
import logging
import platform
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app import backup_auto
from app.database import get_db, _seed_defaults, migrate_timestamps_to_local, now_iso
from app.version import KAMI_VERSION
from app.backup_cifrado import SENHA_MIN, ArquivoInvalido, SenhaErrada, cifrar, decifrar
from app.crypto import ChaveIndisponivel, apagar_do_cofre, decrypt_password, encrypt_password
from app.limites import Entrada
from app.mensagens import ErroKami, erro_de

logger = logging.getLogger(__name__)

router = APIRouter()

RESET_CONFIRMATION_WORD = "excluir"
REMOVER_CONFIRMATION_WORD = "remover"
IMPORT_CONFIRMATION_WORD = "importar"

# ordem de leaf -> root, pra respeitar as foreign keys mesmo em bancos
# onde PRAGMA foreign_keys por algum motivo não esteja ativa na conexão
# (defesa em profundidade — get_connection() já liga isso, mas um
# DELETE explícito na ordem certa não depende disso pra funcionar).
_TABLES_DELETE_ORDER = [
    "calendar_events",
    "screen_tips_seen",
    "dicas_vistas",
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
    "lembretes",
    "habitos_marcas",
    "habitos_pausas",
    "habitos",
    "caixa_entrada",
    "notas_tags",
    "notas",
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


class ResetIn(Entrada):
    confirmation: str


class ImportIn(Entrada):
    confirmation: str
    # backup sem senha: as tabelas direto. Com senha (SEG-03): o arquivo
    # inteiro em `cifrado` + a `senha` — um dos dois, nunca os dois.
    tables: Optional[dict[str, list[dict]]] = None
    cifrado: Optional[dict[str, Any]] = None
    senha: Optional[str] = Field(None, max_length=200)


class ExportProtegidoIn(Entrada):
    senha: str = Field(..., min_length=SENHA_MIN, max_length=200)


# colunas com segredo cifrado pela chave local (app/crypto.py): no backup
# COM senha elas vão decifradas, dentro do arquivo cifrado, e voltam
# cifradas com a chave da máquina que importa — por isso esse backup
# funciona em outro computador e o sem senha não (SEG-03)
SEGREDOS = [
    ("email_accounts", "app_password_enc"),
    ("github_settings", "token_enc"),
    ("search_settings", "api_key_enc"),
    ("notas", "conteudo_cifrado"),  # ORG-01: texto da nota trancada
]


def _montar_export(db) -> tuple[dict, str]:
    """
    Dump completo de todas as tabelas de usuário — introspecta
    `sqlite_master` em vez de listar tabelas na mão, pra não exigir
    lembrar de atualizar este endpoint toda vez que schema.sql ganhar
    uma tabela nova.
    """
    table_names = [
        r["name"]
        for r in db.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
            # sistema_info é do banco, não do usuário (CONF-05)
            "AND name != 'sistema_info' "
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

    return tables, exported_at


@router.get("/export")
def export_data(db=Depends(get_db)):
    tables, exported_at = _montar_export(db)
    return {
        "kami_version": KAMI_VERSION,
        "exported_at": exported_at,
        "tables": tables,
    }


@router.post("/export-protegido")
def export_protegido(payload: ExportProtegidoIn, db=Depends(get_db)):
    """
    Backup com senha (SEG-03): o mesmo conteúdo do /export, com as senhas
    salvas decifradas numa seção `segredos`, tudo cifrado pela senha
    (app/backup_cifrado.py). Devolve o arquivo pronto em `arquivo`.
    Segredo que não dá pra decifrar agora (chave indisponível, dado
    corrompido) fica de fora — `segredos_fora` conta quantos.
    """
    tables, exported_at = _montar_export(db)
    segredos, fora = {}, 0
    for table, col in SEGREDOS:
        for row in tables.get(table, []):
            if not row.get(col):
                continue
            try:
                segredos.setdefault(table, {})[row["id"]] = decrypt_password(row[col])
            except (ValueError, ChaveIndisponivel):
                fora += 1
                continue
            row[col] = "" if table == "email_accounts" else None
    conteudo = {"kami_version": KAMI_VERSION, "exported_at": exported_at, "tables": tables, "segredos": segredos}
    arquivo = cifrar(conteudo, payload.senha, kami_version=KAMI_VERSION, exported_at=exported_at)
    return {
        "arquivo": arquivo,
        "segredos_incluidos": sum(len(v) for v in segredos.values()),
        "segredos_fora": fora,
    }


def _restaurar_segredos(db, segredos: dict) -> tuple[int, int]:
    """Cifra de novo, com a chave DESTA máquina, as senhas que vieram no backup protegido."""
    restaurados, fora = 0, 0
    validos = dict(SEGREDOS)
    for table, por_id in (segredos or {}).items():
        col = validos.get(table)
        if not col or not isinstance(por_id, dict):
            continue
        for row_id, plain in por_id.items():
            if not isinstance(plain, str):
                continue
            try:
                enc = encrypt_password(plain)
            except ChaveIndisponivel:
                fora += 1
                continue
            db.execute(f"UPDATE {table} SET {col} = ? WHERE id = ?", (enc, row_id))  # table/col da lista fixa SEGREDOS
            restaurados += 1
    return restaurados, fora


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
        raise ErroKami(
            422,
            "erro.sistema.confirmacao_invalida_envie_confirmation_import",
            "confirmação inválida; envie confirmation='{import_confirmation_word}' pra prosseguir",
            import_confirmation_word=IMPORT_CONFIRMATION_WORD,
        )

    tables, segredos = payload.tables, {}
    if payload.cifrado is not None:
        if not payload.senha:
            raise ErroKami(
                422,
                "erro.sistema.este_backup_protegido_informe_senha",
                "este backup é protegido — informe a senha",
            )
        try:
            conteudo = decifrar(payload.cifrado, payload.senha)
        except SenhaErrada as exc:
            raise erro_de(exc, 422) from exc
        except ArquivoInvalido as exc:
            raise erro_de(exc, 422) from exc
        tables = conteudo.get("tables") if isinstance(conteudo, dict) else None
        segredos = conteudo.get("segredos") or {}
        if not isinstance(tables, dict):
            raise ErroKami(
                422,
                "erro.sistema.arquivo_nao_parece_ser_backup_2",
                "arquivo não parece ser um backup válido do Kami",
            )

    if not tables or "user_profile" not in tables:
        raise ErroKami(
            422,
            "erro.sistema.arquivo_nao_parece_ser_backup",
            "arquivo não parece ser um backup válido do Kami (faltando user_profile)",
        )

    # CONF-08: o estado de agora fica em backups/ antes de ser sobrescrito
    backup_auto.copia_antes_de(db, "importar")

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
            rows = tables.get(table)
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

        # backup protegido: as senhas salvas voltam cifradas pela chave daqui
        segredos_restaurados, segredos_fora = _restaurar_segredos(db, segredos)

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
        raise ErroKami(
            400,
            "erro.sistema.falha_ao_importar_backup_arquivo",
            "falha ao importar o backup — arquivo corrompido, incompatível, ou dados inconsistentes; nenhuma alteração foi feita ({exc})",
            exc=str(exc),
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

    return {"status": "ok", "segredos_restaurados": segredos_restaurados, "segredos_fora": segredos_fora}


@router.post("/remover-do-computador")
def remover_do_computador(payload: ResetIn):
    """
    DIST-03 (P-91): primeiro passo do "remover tudo do Kami deste
    computador" — a chave das senhas sai do cofre do sistema (só a desta
    pasta de dados). Pasta de dados, cópias, autostart, atalhos e o cache
    da tela quem apaga é o app (src-tauri/src/limpeza.rs), com este backend
    já fora do ar. A pasta extra das cópias fica (P-92).
    """
    if payload.confirmation != REMOVER_CONFIRMATION_WORD:
        raise ErroKami(
            422,
            "erro.sistema.confirmacao_invalida_envie_confirmation_remover",
            "confirmação inválida; envie confirmation='{remover_confirmation_word}' pra prosseguir",
            remover_confirmation_word=REMOVER_CONFIRMATION_WORD,
        )
    havia = apagar_do_cofre()
    logger.warning("remover tudo do computador: chave %s", "apagada do cofre" if havia else "não estava no cofre")
    return {"cofre": havia}


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
        raise ErroKami(
            422,
            "erro.sistema.confirmacao_invalida_envie_confirmation_reset",
            "confirmação inválida; envie confirmation='{reset_confirmation_word}' pra prosseguir",
            reset_confirmation_word=RESET_CONFIRMATION_WORD,
        )

    # CONF-08: "apagar tudo" sem querer passa a ter volta (configurações ›
    # backup › cópias automáticas)
    backup_auto.copia_antes_de(db, "apagar-tudo")

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


class FrontendErrorIn(Entrada):
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


# ── diagnóstico pra relato de problema (CONF-06) ──────────────────────────
#
# Junta o que ajuda a investigar um problema (versão, sistema, tamanho do
# banco, fim do kami-backend.log) num texto pronto pra colar num relato —
# e tira o que é pessoal ANTES de sair daqui: e-mails, chaves/tokens,
# valores em R$, senhas, e a pasta pessoal (vira "~"). O log já não grava
# query string nem headers (app/logs.py), isto é a segunda camada.

DIAGNOSTICO_LINHAS_LOG = 100

_ANONIMIZAR = [
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[e-mail removido]"),
    (re.compile(r"\b(?:ghp_|gho_|github_pat_|tvly-|sk-)[A-Za-z0-9_\-]+"), "[chave removida]"),
    (re.compile(r"(?i)\b(senha|password|passwd|token|api[_-]?key|secret)\b(\s*[:=]\s*)\S+"), r"\1\2[removido]"),
    (re.compile(r"R\$\s?-?[\d.,]+"), "R$ [valor]"),
    # qualquer sequência longa sem hífen (hash, token, chave) — UUIDs têm
    # hífen e ficam (ajudam a achar a linha certa, não identificam ninguém)
    (re.compile(r"\b[A-Za-z0-9_]{32,}\b"), "[removido]"),
]


def anonimizar(texto: str) -> str:
    home = str(Path.home())
    if home and home != "/":
        texto = texto.replace(home, "~")
    for padrao, troca in _ANONIMIZAR:
        texto = padrao.sub(troca, texto)
    return texto


def _fim_do_log(path: Path, linhas: int) -> list[str]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        return [l.rstrip("\n") for l in fh.readlines()[-linhas:]]


def _local_da_chave() -> str:
    from app import crypto

    try:
        estado = crypto.estado_da_chave()
    except Exception as exc:  # noqa: BLE001 — o diagnóstico nunca pode falhar por isso
        return f"erro ao consultar ({type(exc).__name__})"
    texto = estado["local"] + (f" ({estado['cofre']})" if estado["cofre"] else "")
    return texto + (f" — {estado['motivo']}" if estado["motivo"] else "")


@router.get("/diagnostico")
def diagnostico():
    from app.database import DB_PATH, MIGRATION_BACKUP_PREFIX, backups_dir
    from app.paths import get_data_dir

    data_dir = get_data_dir()
    log_path = data_dir / "kami-backend.log"
    banco_kb = round(DB_PATH.stat().st_size / 1024) if DB_PATH.exists() else 0
    backups = len(list(backups_dir().glob(f"{MIGRATION_BACKUP_PREFIX}*.db"))) if backups_dir().exists() else 0
    log = _fim_do_log(log_path, DIAGNOSTICO_LINHAS_LOG)

    cabecalho = [
        f"Kami v{KAMI_VERSION} — diagnóstico gerado em {now_iso()[:19].replace('T', ' ')}",
        f"sistema: {platform.platform()} · python {platform.python_version()}",
        f"pasta de dados: {data_dir}",
        f"banco: {banco_kb} KB · backups de atualização: {backups}",
        f"chave dos segredos: {_local_da_chave()}",
        "",
        f"--- últimas {len(log)} linhas do kami-backend.log ---" if log
        else "--- sem kami-backend.log (o app em modo de desenvolvimento não grava log em arquivo) ---",
    ]
    texto = anonimizar("\n".join(cabecalho + log))
    return {"versao": KAMI_VERSION, "texto": texto, "linhas_de_log": len(log)}

