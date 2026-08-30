"""
Conexão com o SQLite e inicialização do schema.

Sem ORM de propósito (alinhado com a filosofia "leve, RAM-consciente"
do projeto) — sqlite3 puro da stdlib, com row_factory pra devolver
dicts em vez de tuplas.
"""
import sqlite3
import uuid
import datetime
from app.widgets import WIDGET_CATALOG
from app.paths import APP_DIR, get_data_dir

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


def now_iso() -> str:
    return datetime.datetime.utcnow().isoformat()


def get_connection() -> sqlite3.Connection:
    # timeout=30: quanto tempo o sqlite espera por um lock liberado antes de
    # estourar "database is locked" (default do driver é só 5s — curto
    # demais pra operações que ficam mais tempo com a conexão aberta, tipo
    # o sync de e-mail via IMAP; ver sync_email_account em routers/organizacao.py).
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
    return conn


def get_db():
    """Dependency do FastAPI — uma conexão por request."""
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def _migrate_email_cache_body_preview(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra quem já tinha um kami.db criado antes da coluna
    body_preview existir — `CREATE TABLE IF NOT EXISTS` no schema.sql
    NÃO altera uma tabela que já existe, então bancos antigos ficariam
    sem a coluna pra sempre sem isso aqui. SQLite não tem `ADD COLUMN
    IF NOT EXISTS`, então checamos via PRAGMA antes de tentar.
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(email_cache)").fetchall()]
    if "body_preview" not in cols:
        conn.execute("ALTER TABLE email_cache ADD COLUMN body_preview TEXT")
        conn.commit()


def _migrate_milestones_fields(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra bancos criados antes de description/notes/position/
    xp_awarded/was_ever_stale existirem em milestones. `position` é
    backfillada a partir da ordem antiga (rowid, mesma ordem que a API já
    devolvia antes desta mudança) — sem isso, todo marco existente nasceria
    empatado em 0 e a ordem visual embaralharia na primeira listagem.
    `was_ever_stale` nasce em 0 pra todo marco pré-existente (não há como
    saber retroativamente se ele já passou por 'esquecido' antes desta
    coluna existir — assume-se que não).
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(milestones)").fetchall()]

    if "description" not in cols:
        conn.execute("ALTER TABLE milestones ADD COLUMN description TEXT")
    if "notes" not in cols:
        conn.execute("ALTER TABLE milestones ADD COLUMN notes TEXT")
    if "xp_awarded" not in cols:
        conn.execute("ALTER TABLE milestones ADD COLUMN xp_awarded INTEGER")

    needs_position_backfill = "position" not in cols
    if needs_position_backfill:
        conn.execute("ALTER TABLE milestones ADD COLUMN position INTEGER NOT NULL DEFAULT 0")

    if "was_ever_stale" not in cols:
        conn.execute("ALTER TABLE milestones ADD COLUMN was_ever_stale INTEGER NOT NULL DEFAULT 0")
    conn.commit()

    if needs_position_backfill:
        tracks = conn.execute("SELECT DISTINCT track_id FROM milestones").fetchall()
        for t in tracks:
            rows = conn.execute(
                "SELECT id FROM milestones WHERE track_id = ? ORDER BY rowid",
                (t["track_id"],),
            ).fetchall()
            for i, r in enumerate(rows):
                conn.execute("UPDATE milestones SET position = ? WHERE id = ?", (i, r["id"]))
        conn.commit()


def _migrate_user_profile_onboarding(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra bancos criados antes de onboarding_completed existir
    (item 15.6, decisão 25). Sem isso, quem já tem um kami.db de antes desta
    mudança nunca ganharia a coluna e o onboarding tentaria ler/gravar um
    campo inexistente. Default 0 (não visto ainda) — igual ao DEFAULT do
    schema.sql, mas precisa ser feito manualmente via ALTER TABLE porque
    `CREATE TABLE IF NOT EXISTS` não altera uma tabela já existente.
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()]
    if "onboarding_completed" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0")
        conn.commit()


def _migrate_user_profile_last_backup(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra bancos criados antes de last_backup_at existir
    (lembrete de backup). NULL = nunca exportou — mesmo default do
    schema.sql, feito manualmente via ALTER TABLE pelo mesmo motivo de
    sempre (`CREATE TABLE IF NOT EXISTS` não altera tabela existente).
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()]
    if "last_backup_at" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN last_backup_at TEXT")
        conn.commit()


def _migrate_user_profile_notif_settings(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra bancos criados antes de notif_alerts_enabled/
    notif_email_enabled existirem (configurações > notificações, filtro
    por tipo). Default 1 (ligado) pros dois — mesmo comportamento de
    hoje (tudo aparece) até o usuário desmarcar algo, igual ao DEFAULT
    do schema.sql; feito manualmente via ALTER TABLE porque `CREATE
    TABLE IF NOT EXISTS` não altera uma tabela já existente.
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()]
    if "notif_alerts_enabled" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN notif_alerts_enabled INTEGER NOT NULL DEFAULT 1")
        conn.commit()
    if "notif_email_enabled" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN notif_email_enabled INTEGER NOT NULL DEFAULT 1")
        conn.commit()


def _migrate_tracks_position(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra bancos criados antes de `position` existir em tracks
    (item 3.2, ordenação manual das trilhas na sidebar). Backfilla a partir
    da ordem alfabética por nome — mesma ordem que a listagem já usava antes
    desta mudança (`ORDER BY name`) — pra ninguém ver a sidebar embaralhar
    na primeira abertura depois do update; a partir daí, a ordem vira 100%
    manual (drag-and-drop).
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(tracks)").fetchall()]
    if "position" in cols:
        return
    conn.execute("ALTER TABLE tracks ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
    conn.commit()

    rows = conn.execute("SELECT id FROM tracks ORDER BY name").fetchall()
    for i, r in enumerate(rows):
        conn.execute("UPDATE tracks SET position = ? WHERE id = ?", (i, r["id"]))
    conn.commit()


def _migrate_goals_v2(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra bancos criados antes da v2 de Metas (peso, unit_label,
    vínculo com conta/trilha). Bancos antigos ganham `weight='medio'`
    (multiplicador 1x — não muda o xp de nenhuma meta já existente) e o
    resto NULL, mesmo comportamento de hoje até o usuário editar/criar algo
    novo. `CREATE TABLE IF NOT EXISTS` não altera uma tabela que já existe,
    daí o ALTER TABLE manual de sempre.
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(goals)").fetchall()]
    if "weight" not in cols:
        conn.execute("ALTER TABLE goals ADD COLUMN weight TEXT NOT NULL DEFAULT 'medio'")
    if "unit_label" not in cols:
        conn.execute("ALTER TABLE goals ADD COLUMN unit_label TEXT")
    if "linked_conta_id" not in cols:
        conn.execute("ALTER TABLE goals ADD COLUMN linked_conta_id TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL")
    if "linked_track_id" not in cols:
        conn.execute("ALTER TABLE goals ADD COLUMN linked_track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL")
    if "linked_education_id" not in cols:
        conn.execute("ALTER TABLE goals ADD COLUMN linked_education_id TEXT REFERENCES career_educations(id) ON DELETE SET NULL")
    conn.commit()

    gc_cols = [r["name"] for r in conn.execute("PRAGMA table_info(goal_contributions)").fetchall()]
    if "origem" not in gc_cols:
        conn.execute("ALTER TABLE goal_contributions ADD COLUMN origem TEXT")
    if "transaction_id" not in gc_cols:
        conn.execute("ALTER TABLE goal_contributions ADD COLUMN transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL")
    conn.commit()


def _migrate_recorrentes_conta_transacao(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra bancos criados antes de fixed_bills/wallet_subscriptions
    ganharem geração OPCIONAL de transação real ao marcar como pago (item 6
    do mapa de problemas, resolvido junto com a unificação do item 1):
      - fixed_bills ganha conta_id (vínculo, igual wallet_subscriptions já
        tinha) e categoria (usada na transação gerada).
      - wallet_subscriptions ganha categoria (conta_id já existia).
      - fixed_bill_periods/wallet_subscription_periods ganham transaction_id,
        apontando pra transação real gerada (NULL se foi marcada só como
        lembrete) — mesmo padrão de goal_contributions.transaction_id acima.
    `CREATE TABLE IF NOT EXISTS` não altera tabela já existente, daí o
    ALTER TABLE manual de sempre.
    """
    fb_cols = [r["name"] for r in conn.execute("PRAGMA table_info(fixed_bills)").fetchall()]
    if "conta_id" not in fb_cols:
        conn.execute("ALTER TABLE fixed_bills ADD COLUMN conta_id TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL")
    if "categoria" not in fb_cols:
        conn.execute("ALTER TABLE fixed_bills ADD COLUMN categoria TEXT")

    ws_cols = [r["name"] for r in conn.execute("PRAGMA table_info(wallet_subscriptions)").fetchall()]
    if "categoria" not in ws_cols:
        conn.execute("ALTER TABLE wallet_subscriptions ADD COLUMN categoria TEXT")

    fbp_cols = [r["name"] for r in conn.execute("PRAGMA table_info(fixed_bill_periods)").fetchall()]
    if "transaction_id" not in fbp_cols:
        conn.execute("ALTER TABLE fixed_bill_periods ADD COLUMN transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL")

    wsp_cols = [r["name"] for r in conn.execute("PRAGMA table_info(wallet_subscription_periods)").fetchall()]
    if "transaction_id" not in wsp_cols:
        conn.execute("ALTER TABLE wallet_subscription_periods ADD COLUMN transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL")

    conn.commit()


def _migrate_income_v2(conn: sqlite3.Connection) -> None:
    """
    Substitui income_sources/income_entries pelo modelo v2 (renda
    recorrente genérica, CRUD completo, encadeamento — ver
    app/routers/financas.py) — dropa as tabelas antigas em bancos
    criados antes desta mudança. Sem perda de dado real:
    income_sources/income_entries só continham dado semeado ("parte 1"/
    "parte 2" hardcoded, sem CRUD próprio antes disso), nunca algo que o
    usuário tenha digitado num cadastro dele. `CREATE TABLE IF NOT
    EXISTS` não recria uma tabela que já existe, então quem já tinha o
    schema antigo precisa do DROP manual pra ganhar as colunas novas
    (frequencia/tipo_data/conta_id/etc.) — mesmo motivo de sempre pras
    migrações deste arquivo. Bancos novos já nascem com o schema.sql
    atual (v2) e essa função é um no-op pra eles.
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(income_sources)").fetchall()]
    if "frequencia" in cols:
        return  # já é v2
    conn.execute("DROP TABLE IF EXISTS income_entries")
    conn.execute("DROP TABLE IF EXISTS income_sources")
    conn.executescript(
        """
        CREATE TABLE income_sources (
            id                   TEXT PRIMARY KEY,
            nome                 TEXT NOT NULL,
            valor                REAL NOT NULL,
            conta_id             TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL,
            categoria            TEXT,
            frequencia           TEXT NOT NULL,
            tipo_data            TEXT,
            dia_mes              INTEGER,
            nth_dia_util         INTEGER,
            intervalo_dias       INTEGER,
            data_base            TEXT,
            fonte_referencia_id  TEXT REFERENCES income_sources(id) ON DELETE SET NULL,
            offset_dias_uteis    INTEGER,
            data_avulsa          TEXT,
            active               INTEGER NOT NULL DEFAULT 1,
            unica                INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE income_entries (
            id                TEXT PRIMARY KEY,
            income_source_id  TEXT NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
            expected_date     TEXT NOT NULL,
            paid_date         TEXT,
            amount            REAL NOT NULL,
            status            TEXT NOT NULL DEFAULT 'previsto',
            transaction_id    TEXT REFERENCES transactions(id) ON DELETE SET NULL
        );
        """
    )
    conn.commit()


def _migrate_remove_org_notifications_widget(conn: sqlite3.Connection) -> None:
    """
    Remove qualquer instância do widget `org_notifications` de layouts
    já salvos (notificações v2 — vira sino global, não widget de
    dashboard mais). Sem isso, quem já tinha adicionado esse widget ao
    grid de Perfil/Núcleo ficaria com uma linha em dashboard_widgets
    apontando pra um widget_type que não existe mais em WIDGET_CATALOG
    (app/widgets.py), o que o frontend não sabe renderizar (buraco no
    grid) e o backend não sabe mais validar. Idempotente — DELETE sem
    match nenhum é um no-op silencioso.
    """
    conn.execute("DELETE FROM dashboard_widgets WHERE widget_type = 'org_notifications'")
    conn.commit()


def _migrate_muted_accounts(conn: sqlite3.Connection) -> None:
    """
    Substitui `muted_senders` (silenciar por remetente individual) por
    `muted_accounts` (silenciar a conta de e-mail inteira) — ver
    comentário da tabela nova em schema.sql pro motivo da mudança.
    `CREATE TABLE IF NOT EXISTS` já cria muted_accounts do zero em
    bancos novos; aqui só cuida de quem já tinha muted_senders: migra
    o melhor esforço (silencia a(s) conta(s) de onde já veio algum
    e-mail de cada remetente silenciado) e dropa a tabela antiga.
    Idempotente — a checagem de existência faz o resto virar no-op
    depois da primeira vez que rodar.
    """
    exists = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='muted_senders'"
    ).fetchone()
    if not exists:
        return

    senders = conn.execute("SELECT sender FROM muted_senders").fetchall()
    for row in senders:
        accounts = conn.execute(
            "SELECT DISTINCT account_id FROM email_cache WHERE sender = ?", (row["sender"],)
        ).fetchall()
        for acc in accounts:
            already = conn.execute(
                "SELECT id FROM muted_accounts WHERE account_id = ?", (acc["account_id"],)
            ).fetchone()
            if not already:
                conn.execute(
                    "INSERT INTO muted_accounts (id, account_id, muted_at) VALUES (?, ?, ?)",
                    (new_id(), acc["account_id"], now_iso()),
                )

    conn.execute("DROP TABLE IF EXISTS muted_senders")
    conn.commit()


def _migrate_email_accounts_sync_by_default(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra quem já tinha um kami.db criado antes da coluna
    sync_by_default existir (redesign da aba e-mail — ver
    plano-email-organizacao.md secao 3.1). Default 1 pra não quebrar
    contas já cadastradas: continuam aparecendo pré-selecionadas na
    visualização combinada, como se sempre tivessem sido "padrão".
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(email_accounts)").fetchall()]
    if "sync_by_default" not in cols:
        conn.execute("ALTER TABLE email_accounts ADD COLUMN sync_by_default INTEGER NOT NULL DEFAULT 1")
        conn.commit()


def _migrate_github_repos_source(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra quem já tinha um kami.db criado antes das colunas
    source/owner_login existirem (importação automática de repositórios
    ao conectar/trocar o token — ver organizacao.py, PUT /github-token).
    DEFAULT 'manual' pra não quebrar repos já cadastrados: continuam
    sendo tratados como cadastro manual (nunca removidos automaticamente
    numa troca de token), que é exatamente o comportamento que já tinham
    antes dessa coluna existir.
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(github_repos)").fetchall()]
    if "source" not in cols:
        conn.execute("ALTER TABLE github_repos ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
    if "owner_login" not in cols:
        conn.execute("ALTER TABLE github_repos ADD COLUMN owner_login TEXT")
    conn.commit()


def _migrate_drop_compra_parcelada_aplicacoes(conn: sqlite3.Connection) -> None:
    """
    Dropa `compra_parcelada_aplicacoes` (item 3 do plano de ajustes de
    finanças) — a tabela nunca foi usada em nenhuma rota do
    wallet.py; a exibição de parcela por mês sempre foi (e continua
    sendo) calculada on the fly a partir de mes_primeira_parcela +
    ajuste_parcelas (ver _compra_parcelada_out/_parcela_no_mes),
    tornando a tabela redundante desde sempre — sobrou de um plano
    anterior que não foi concluído. `DROP TABLE IF EXISTS` é seguro
    tanto pra quem nunca teve a tabela quanto pra quem tinha (dado
    nela, se houver, não é usado por nada — perda sem efeito real).
    """
    conn.execute("DROP TABLE IF EXISTS compra_parcelada_aplicacoes")
    conn.commit()


def init_db() -> None:
    """Cria as tabelas (se não existirem) e semeia dados default."""
    conn = get_connection()
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

    # dashboard: layout default por tela (decisão 17) — espelha o que já
    # foi validado visualmente no protótipo (kami_telas_final.html)
    DEFAULT_LAYOUTS = {
        "perfil": ["profile", "attributes", "achievements"],
        "nucleo": ["attributes", "priorities", "log", "registrar", "achievements"],
        # carreira_perfil é removable:False (auto-injetado de qualquer
        # forma por withRequiredWidgets no frontend, ver dashboard.js) —
        # entra aqui também só pra já nascer na posição 1, antes de
        # carreira_interesses (removable:True, que SÓ aparece de cara
        # por estar listado aqui — sem isso a tela chegaria com só o
        # bloco obrigatório e o usuário precisaria adicionar interesses
        # manualmente pelo popover "+ adicionar widget").
        # carreira_posicoes (Parte 2) entra aqui também pro mesmo efeito
        # de carreira_interesses acima: sem isso, instalações novas só
        # ganhariam a linha do tempo adicionando manualmente pelo popover.
        # carreira_formacoes (Parte 3) — mesmo raciocínio, novas
        # instalações já nascem com o bloco de formação acadêmica visível.
        "carreira": ["carreira_perfil", "carreira_interesses", "carreira_posicoes", "carreira_formacoes"],
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