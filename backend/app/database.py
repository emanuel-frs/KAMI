"""
Conexão com o SQLite e inicialização do schema.

Sem ORM de propósito (alinhado com a filosofia "leve, RAM-consciente"
do projeto) — sqlite3 puro da stdlib, com row_factory pra devolver
dicts em vez de tuplas.
"""
import sqlite3
import uuid
import datetime
from pathlib import Path
from app.widgets import WIDGET_CATALOG

APP_DIR = Path(__file__).parent
BACKEND_DIR = APP_DIR.parent
DB_PATH = BACKEND_DIR / "kami.db"
SCHEMA_PATH = APP_DIR / "schema.sql"

# atributos finais e fechados (decisão 13) — carreira fica is_active=1
# desde o v1 mesmo sem tela própria (decisão 13, caso especial)
DEFAULT_ATTRIBUTES = ["carreira", "financas", "aprendizado", "organizacao", "metas"]


def new_id() -> str:
    """Gera um novo UUID4 como string — usado como PK em toda tabela."""
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    """Dependency do FastAPI — uma conexão por request."""
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Cria as tabelas (se não existirem) e semeia dados default."""
    conn = get_connection()
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.commit()
    _seed_defaults(conn)

    # import local pra evitar import circular (achievements importa new_id/now_iso daqui)
    from app.achievements import seed_achievements
    seed_achievements(conn)

    conn.close()


def _seed_defaults(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()

    # perfil: linha única, criada vazia se ainda não existir
    cur.execute("SELECT COUNT(*) AS c FROM user_profile")
    if cur.fetchone()["c"] == 0:
        cur.execute(
            "INSERT INTO user_profile (id, display_name, accent_color, avatar_ascii, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (new_id(), "usuário", "#8fbf8f", None, now_iso()),
        )

    # atributos: lista fechada da decisão 13
    cur.execute("SELECT COUNT(*) AS c FROM attributes")
    if cur.fetchone()["c"] == 0:
        for name in DEFAULT_ATTRIBUTES:
            cur.execute(
                "INSERT INTO attributes (id, name, current_xp, current_level, is_active) "
                "VALUES (?, ?, 0, 1, 1)",
                (new_id(), name),
            )

    # renda recorrente: parte 1 (~5º dia útil) + parte 2 (~+15 dias úteis) —
    # valores default do usuário (decisão 06), editáveis depois via API
    cur.execute("SELECT COUNT(*) AS c FROM income_sources")
    if cur.fetchone()["c"] == 0:
        cur.execute(
            "INSERT INTO income_sources (id, label, amount, payment_rule) VALUES (?, ?, ?, ?)",
            (new_id(), "parte 1", 1800, "5º dia útil do mês"),
        )
        cur.execute(
            "INSERT INTO income_sources (id, label, amount, payment_rule) VALUES (?, ?, ?, ?)",
            (new_id(), "parte 2", 1300, "+15 dias úteis após parte 1"),
        )

    # dashboard: layout default por tela (decisão 17) — espelha o que já
    # foi validado visualmente no protótipo (kami_telas_final.html)
    DEFAULT_LAYOUTS = {
        "perfil": ["profile", "attributes", "achievements"],
        "nucleo": ["attributes", "priorities", "log", "registrar", "achievements"],
    }
    cur.execute("SELECT COUNT(*) AS c FROM dashboard_widgets")
    if cur.fetchone()["c"] == 0:
        for screen, widget_types in DEFAULT_LAYOUTS.items():
            for position, widget_type in enumerate(widget_types):
                default_span = WIDGET_CATALOG[widget_type]["default_span"]
                cur.execute(
                    "INSERT INTO dashboard_widgets "
                    "(id, screen, widget_type, position, width, height, config_json) "
                    "VALUES (?, ?, ?, ?, ?, NULL, NULL)",
                    (new_id(), screen, widget_type, position, default_span),
                )

    conn.commit()
