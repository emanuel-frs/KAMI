"""
Conexão com o SQLite e inicialização do schema.

Sem ORM de propósito (alinhado com a filosofia "leve, RAM-consciente"
do projeto) — sqlite3 puro da stdlib, com row_factory pra devolver
dicts em vez de tuplas.
"""
import logging
import shutil
import sqlite3
import uuid
import datetime
from pathlib import Path
from app.paths import APP_DIR, get_data_dir
from app.version import KAMI_VERSION

logger = logging.getLogger(__name__)

# kami.db mora na pasta de dados do usuário (get_data_dir), não mais
# fixo em "ao lado do código" — ver app/paths.py pro motivo (fase
# 15.8, sidecar/PyInstaller). schema.sql continua relativo ao próprio
# módulo: é um arquivo empacotado junto do binário (read-only), não
# dado do usuário, então pode seguir __file__ normalmente.
DB_PATH = get_data_dir() / "kami.db"
SCHEMA_PATH = APP_DIR / "schema.sql"

# atributos finais e fechados (decisão 13) — carreira fica is_active=1
# desde o v1 mesmo sem tela própria (decisão 13, caso especial)
DEFAULT_ATTRIBUTES = ["carreira", "financas", "aprendizado", "organizacao", "metas"]


def new_id() -> str:
    """Gera um novo UUID4 como string — usado como PK em toda tabela."""
    return str(uuid.uuid4())


def local_now() -> datetime.datetime:
    """Agora no fuso do computador de quem usa o app, com offset explícito."""
    return datetime.datetime.now().astimezone()


def now_iso() -> str:
    """
    Timestamp gravado em toda coluna *_at: hora LOCAL com offset
    (ex: '2026-10-07T20:30:00.123456-03:00').

    Antes era utcnow() sem offset — o navegador lia esse texto como hora
    local e mostrava tudo deslocado pelo fuso (3h a mais no Brasil), e
    o prefixo YYYY-MM-DD (usado pra sequência de dias, limites diários
    e calendário) virava o dia seguinte pra qualquer ação depois das
    21h. Com o fuso local o prefixo é o dia de quem usa, e o offset
    explícito deixa o horário inequívoco pro frontend.
    """
    return local_now().isoformat()


def backup_database(conn: sqlite3.Connection, label: str) -> str:
    """
    Copia o banco inteiro pra um arquivo ao lado do kami.db (mesma pasta
    de dados, ver app/paths.py), via API de backup do sqlite — consistente
    mesmo com o banco aberto. Usado antes de operações que reescrevem
    dados em massa (ex: revisão de xp). Devolve o caminho do arquivo.
    """
    stamp = local_now().strftime("%Y%m%d-%H%M%S")
    dest_path = DB_PATH.parent / f"kami-{label}-{stamp}.db"
    dest = sqlite3.connect(dest_path)
    try:
        conn.backup(dest)
    finally:
        dest.close()
    return str(dest_path)


def get_connection() -> sqlite3.Connection:
    # timeout=30: quanto tempo o sqlite espera por um lock liberado antes de
    # estourar "database is locked" (default do driver é só 5s — curto
    # demais pra operações que ficam mais tempo com a conexão aberta, tipo
    # o sync de e-mail via IMAP; ver sync_email_account em routers/organizacao/emails.py).
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # WAL: sem isso, todo mundo usa o rollback journal padrão, onde qualquer
    # transação de escrita bloqueia TODAS as outras conexões (inclusive
    # leituras) até dar commit. Com várias contas de e-mail sincronizando em
    # paralelo (email-sync-scheduler.js roda todas via Promise.all a cada
    # tick, e pode coincidir com um clique manual de sync), isso é a causa
    # raiz do "database is locked" visto nos logs — WAL permite leitores
    # concorrentes com um único escritor por vez, e busy_timeout (em ms,
    # espelhando o timeout acima) faz escritores concorrentes esperarem a
    # vez em vez de falhar na hora.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    # ORG-03: busca que ignora acento ("acao" acha "Ação") — ver app/busca.py
    from app.busca import sem_acento

    conn.create_function("sem_acento", 1, sem_acento, deterministic=True)
    return conn


def get_db():
    """Dependency do FastAPI — uma conexão por request."""
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


# GAM-13: preferências de som (coluna → default). Combinado no começo como
# "som desligado", mudou no teste do Emanuel (2026-10-09): o som começa
# LIGADO, com todos os grupos ligados — todo botão tem som.
SOM_COLUNAS = {
    "som_ativo": 1,
    "som_volume": 60,
    "som_progresso": 1,
    "som_interface": 1,
    "som_avisos": 1,
}


# ORG-05: notificações fora do app (coluna → default SQL). Ver schema.sql.
NOTIF_COLUNAS = {
    "notif_fora_lembretes": "INTEGER NOT NULL DEFAULT 1",
    "notif_fora_vencimentos": "INTEGER NOT NULL DEFAULT 1",
    "notif_fora_eventos": "INTEGER NOT NULL DEFAULT 1",
    "notif_ocultar_texto": "INTEGER NOT NULL DEFAULT 0",
    "avisos_hora": "TEXT NOT NULL DEFAULT '09:00'",
    # ORG-07 (P-53): como as datas aparecem — 'sistema' segue o idioma do sistema
    "formato_data": "TEXT NOT NULL DEFAULT 'sistema'",
}


# DIST-01 (P-75/P-88): aviso de versão nova. O app só AVISA — quem baixa e
# instala é a pessoa, quando quiser. `atualizacao_avisada`: a versão que já
# contou no sino (o aviso não insiste: uma vez por versão); `..._pulada`:
# "pular esta versão" (some do sino, continua em configurações › sobre).
ATUALIZACAO_COLUNAS = {
    "atualizacoes_procurar": "INTEGER NOT NULL DEFAULT 1",
    "atualizacao_avisada": "TEXT",
    "atualizacao_pulada": "TEXT",
}


# MAN-02: as migrações moram em app/migracoes.py; os nomes vêm pra cá pra
# _init_db chamá-las como sempre (e quem troca uma delas aqui, nos testes,
# continua trocando a que roda). Fica DEPOIS de new_id/now_iso/SOM_COLUNAS:
# migracoes.py usa esses nomes deste módulo (import circular, ver lá).
from app.migracoes import (
    _migrate_email_cache_body_preview,
    _migrate_milestones_fields,
    _migrate_user_profile_onboarding,
    _migrate_user_profile_last_backup,
    _migrate_user_profile_notif_settings,
    _migrate_tracks_position,
    _migrate_goals_v2,
    _migrate_recorrentes_conta_transacao,
    _migrate_income_v2,
    _migrate_remove_org_notifications_widget,
    _migrate_muted_accounts,
    _migrate_email_accounts_sync_by_default,
    _migrate_github_repos_source,
    _migrate_drop_compra_parcelada_aplicacoes,
    _migrate_rename_wallet_widget_type,
    _migrate_action_logs_referencia,
    _migrate_achievements_chave,
    _migrate_achievements_meta,
    _migrate_user_profile_efeitos_visuais,
    _migrate_user_profile_icone_tema,
    _migrate_user_profile_sequencia_protecao,
    _migrate_user_profile_recompensas,
    _migrate_user_profile_notif_fora,
    _migrate_user_profile_atualizacao,
    _migrate_user_profile_idioma,
    _migrate_user_profile_moeda_pais,
    _migrate_textos_sistema,
    _migrate_textos_antigos,
    _migrate_user_profile_som,
    _migrate_missoes_widget,
    migrate_timestamps_to_local,
    _migrate_debts_quitacao,
    _migrate_transacao_referencia,
)


# ==================== backup antes de migrar (CONF-05) ====================
# Uma versão nova do app pode mexer no banco (migrações _migrate_* abaixo).
# Se isso der errado no meio, o banco do usuário ficava pela metade. Agora:
#   - ao abrir uma versão diferente da que atualizou o banco por último
#     (sistema_info.versao_banco), o banco é copiado pra
#     <pasta de dados>/backups/kami-antes-da-<versão>-<data>.db ANTES de
#     qualquer migração; ficam os MIGRATION_BACKUPS_KEEP mais recentes;
#   - se alguma migração falhar, o banco volta sozinho pra essa cópia e o
#     backend não sobe (erro claro no log e na faixa do vigia, CONF-02) —
#     nunca abre com o banco pela metade;
#   - instalação nova (banco vazio) não gera backup.

BACKUPS_DIR_NAME = "backups"
MIGRATION_BACKUPS_KEEP = 3
MIGRATION_BACKUP_PREFIX = "kami-antes-da-"


class MigracaoFalhou(RuntimeError):
    """A atualização do banco falhou e ele foi restaurado do backup."""


def backups_dir() -> Path:
    return DB_PATH.parent / BACKUPS_DIR_NAME


def _stored_db_version(conn: sqlite3.Connection):
    """
    Versão do app que atualizou o banco por último. None = banco novo
    (sem tabelas — nada a proteger); "" = banco de antes do CONF-05 (sem
    sistema_info), que precisa de backup como qualquer versão diferente.
    """
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()}
    if "user_profile" not in tables:
        return None
    if "sistema_info" not in tables:
        return ""
    row = conn.execute("SELECT valor FROM sistema_info WHERE chave = 'versao_banco'").fetchone()
    return row["valor"] if row else ""


def _backup_before_migration(conn: sqlite3.Connection) -> Path:
    folder = backups_dir()
    folder.mkdir(parents=True, exist_ok=True)
    stamp = local_now().strftime("%Y%m%d-%H%M%S")
    dest_path = folder / f"{MIGRATION_BACKUP_PREFIX}{KAMI_VERSION}-{stamp}.db"
    dest = sqlite3.connect(dest_path)
    try:
        conn.backup(dest)  # API de backup do sqlite: consistente com o WAL
    finally:
        dest.close()
    # mantém só os mais recentes — ordena pela data/hora que está no FIM do
    # nome (…-AAAAMMDD-HHMMSS.db), não pela versão nem pelo mtime do arquivo
    old = sorted(folder.glob(f"{MIGRATION_BACKUP_PREFIX}*.db"), key=lambda p: p.stem[-15:])
    for path in old[:-MIGRATION_BACKUPS_KEEP]:
        path.unlink(missing_ok=True)
    logger.info("banco copiado pra %s antes de atualizar pra versão %s", dest_path.name, KAMI_VERSION)
    return dest_path


def _restore_backup(backup_path: Path) -> None:
    """Volta o kami.db pra cópia. Os arquivos -wal/-shm do banco quebrado saem junto."""
    for suffix in ("-wal", "-shm"):
        Path(str(DB_PATH) + suffix).unlink(missing_ok=True)
    shutil.copyfile(backup_path, DB_PATH)


def _set_db_version(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO sistema_info (chave, valor) VALUES ('versao_banco', ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (KAMI_VERSION,),
    )
    conn.commit()


def init_db() -> None:
    """
    Cria as tabelas (se não existirem), roda as migrações e semeia dados
    default — com backup antes e restauração se a migração falhar (CONF-05).
    """
    conn = get_connection()
    stored = _stored_db_version(conn)
    backup_path = _backup_before_migration(conn) if stored is not None and stored != KAMI_VERSION else None
    try:
        _init_db(conn)
    except Exception as exc:
        conn.close()
        if backup_path is None:
            raise
        _restore_backup(backup_path)
        logger.exception("a atualização do banco pra versão %s falhou; banco restaurado de %s", KAMI_VERSION, backup_path.name)
        raise MigracaoFalhou(
            f"a atualização do banco de dados pra versão {KAMI_VERSION} falhou e o banco foi restaurado "
            f"da cópia {backup_path.name} (em {backup_path.parent}). Nada foi perdido. Volte pra versão "
            f"anterior do Kami e envie o kami-backend.log num relato de problema."
        ) from exc
    conn.close()


def _init_db(conn: sqlite3.Connection) -> None:
    # GAM-07: a tabela missoes já existia? (decide se o widget novo entra
    # no layout de quem já usava o app — ver _migrate_missoes_widget)
    had_missoes = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'missoes'"
    ).fetchone() is not None
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.commit()

    _migrate_email_cache_body_preview(conn)
    _migrate_milestones_fields(conn)
    _migrate_user_profile_onboarding(conn)
    _migrate_user_profile_last_backup(conn)
    _migrate_user_profile_notif_settings(conn)
    _migrate_tracks_position(conn)
    _migrate_goals_v2(conn)
    _migrate_recorrentes_conta_transacao(conn)
    _migrate_income_v2(conn)
    _migrate_remove_org_notifications_widget(conn)
    _migrate_drop_compra_parcelada_aplicacoes(conn)
    _migrate_muted_accounts(conn)
    _migrate_email_accounts_sync_by_default(conn)
    _migrate_github_repos_source(conn)
    _migrate_rename_wallet_widget_type(conn)
    _migrate_action_logs_referencia(conn)
    _migrate_achievements_chave(conn)
    _migrate_achievements_meta(conn)
    _migrate_user_profile_efeitos_visuais(conn)
    _migrate_user_profile_icone_tema(conn)
    _migrate_user_profile_sequencia_protecao(conn)
    _migrate_missoes_widget(conn, had_missoes)
    _migrate_user_profile_recompensas(conn)
    _migrate_user_profile_som(conn)
    _migrate_user_profile_notif_fora(conn)
    _migrate_user_profile_atualizacao(conn)
    _migrate_user_profile_idioma(conn)
    _migrate_user_profile_moeda_pais(conn)
    _migrate_debts_quitacao(conn)
    _migrate_transacao_referencia(conn)
    migrate_timestamps_to_local(conn)
    # I18N: por último — dependem das colunas das migrações acima
    _migrate_textos_sistema(conn)
    _migrate_textos_antigos(conn)
    conn.commit()

    _seed_defaults(conn)

    # import local pra evitar import circular (achievements importa new_id/now_iso daqui)
    from app.achievements import seed_achievements
    seed_achievements(conn)

    _set_db_version(conn)


def _seed_defaults(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()

    # perfil: linha única, criada vazia se ainda não existir. Os sons vão
    # explícitos (SOM_COLUNAS): o DEFAULT da coluna fica gravado na tabela
    # de quem criou o banco quando o som começava desligado, e o reset
    # (sistema.py) recriaria o perfil mudo
    cur.execute("SELECT COUNT(*) AS c FROM user_profile")
    if cur.fetchone()["c"] == 0:
        som_cols = ", ".join(SOM_COLUNAS)
        som_marks = ", ".join("?" * len(SOM_COLUNAS))
        cur.execute(
            f"INSERT INTO user_profile (id, display_name, accent_color, avatar_ascii, updated_at, {som_cols}) "
            f"VALUES (?, ?, ?, ?, ?, {som_marks})",
            (new_id(), "usuário", "#8fbf8f", None, now_iso(), *SOM_COLUNAS.values()),
        )

    # carreira: linha única (área atual/meta), criada vazia se ainda não
    # existir — mesmo padrão de user_profile. career_interests não tem
    # seed (lista livre, começa vazia de verdade).
    cur.execute("SELECT COUNT(*) AS c FROM career_profile")
    if cur.fetchone()["c"] == 0:
        cur.execute(
            "INSERT INTO career_profile (id, area_atual, area_meta, updated_at) VALUES (?, ?, ?, ?)",
            (new_id(), None, None, now_iso()),
        )

    # atributos: lista fechada da decisão 13. Checado nome a nome (e não
    # só "tabela vazia?") pra bancos criados antes de um atributo novo
    # existir (ex: 'carreira') ganharem o que falta sem perder XP/nível
    # dos atributos que já tinham — mesmo raciocínio das migrações
    # ALTER TABLE manuais acima, aplicado a linhas em vez de colunas.
    existing_names = {r["name"] for r in cur.execute("SELECT name FROM attributes").fetchall()}
    for name in DEFAULT_ATTRIBUTES:
        if name not in existing_names:
            cur.execute(
                "INSERT INTO attributes (id, name, current_xp, current_level, is_active) "
                "VALUES (?, ?, 0, 1, 1)",
                (new_id(), name),
            )

    # renda recorrente (v2): parte 1 (5º dia útil) + parte 2 (+15 dias
    # úteis após parte 1, via encadeamento offset_fonte) — mesmos valores
    # default de sempre (decisão 06), agora editáveis via CRUD completo
    # (GET/POST/PUT/DELETE /financas/income-sources) em vez de fixos.
    cur.execute("SELECT COUNT(*) AS c FROM income_sources")
    if cur.fetchone()["c"] == 0:
        parte1_id = new_id()
        cur.execute(
            "INSERT INTO income_sources "
            "(id, nome, valor, frequencia, tipo_data, nth_dia_util, active, unica) "
            "VALUES (?, ?, ?, 'mensal', 'dia_util', ?, 1, 0)",
            (parte1_id, "parte 1", 1800, 5),
        )
        cur.execute(
            "INSERT INTO income_sources "
            "(id, nome, valor, frequencia, tipo_data, fonte_referencia_id, offset_dias_uteis, active, unica) "
            "VALUES (?, ?, ?, 'mensal', 'offset_fonte', ?, ?, 1, 0)",
            (new_id(), "parte 2", 1300, parte1_id, 15),
        )

    # dashboard: layout padrão por tela (LAY-02) — definido em
    # app/widgets.py (LAYOUT_PADRAO), junto do catálogo; o mesmo dado serve
    # o "restaurar padrão" e o aviso de layout novo (routers/dashboard.py).
    from app.widgets import LAYOUT_PADRAO, LAYOUT_PADRAO_VERSAO

    cur.execute("SELECT COUNT(*) AS c FROM dashboard_widgets")
    if cur.fetchone()["c"] == 0:
        # instalação nova (ou reset): já nasce com o padrão atual — o aviso
        # "o layout padrão melhorou" (P-23) é só pra quem tinha o antigo
        cur.execute(
            "INSERT INTO sistema_info (chave, valor) VALUES ('layout_padrao_versao', ?) "
            "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
            (str(LAYOUT_PADRAO_VERSAO),),
        )
        for screen, widgets in LAYOUT_PADRAO.items():
            for position, (widget_type, width, height) in enumerate(widgets):
                cur.execute(
                    "INSERT INTO dashboard_widgets "
                    "(id, screen, widget_type, position, width, height, config_json) "
                    "VALUES (?, ?, ?, ?, ?, ?, NULL)",
                    (new_id(), screen, widget_type, position, width, height),
                )

    conn.commit()