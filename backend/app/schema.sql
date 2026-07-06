-- ============================================================
-- KAMI — schema SQLite do v1
-- Convenção: todo `id` é TEXT (UUID v4, gerado em Python antes do
-- insert — não é AUTOINCREMENT). Ver decisão de arquitetura: risco
-- de mobile sync (13.6) e multi-perfil (13.4) tornava caro trocar
-- isso depois, então decidimos usar UUID desde o v1.
-- Datas guardadas como TEXT ISO-8601 (SQLite não tem tipo DATE).
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------------- PERFIL (decisão 15) ----------------
CREATE TABLE IF NOT EXISTS user_profile (
    id            TEXT PRIMARY KEY,   -- linha única (app single-user no v1)
    display_name  TEXT NOT NULL,
    accent_color  TEXT NOT NULL DEFAULT '#8fbf8f',
    avatar_ascii  TEXT,               -- NULL = sem avatar ainda
    updated_at    TEXT NOT NULL
);

-- ---------------- DASHBOARDS / WIDGETS (decisão 17) ----------------
CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id          TEXT PRIMARY KEY,
    screen      TEXT NOT NULL,        -- 'perfil' | 'nucleo'
    widget_type TEXT NOT NULL,        -- catálogo fixo, validado em código (app/widgets.py)
    position    INTEGER NOT NULL,
    width       INTEGER NOT NULL,     -- em sextos da linha (1-6)
    height      INTEGER,              -- opcional, unidades de grade
    config_json TEXT
);

-- ---------------- NÚCLEO ----------------
CREATE TABLE IF NOT EXISTS attributes (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,  -- 'carreira' | 'financas' | 'aprendizado' | 'organizacao' | 'metas'
    current_xp    INTEGER NOT NULL DEFAULT 0,
    current_level INTEGER NOT NULL DEFAULT 1,
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS action_logs (
    id           TEXT PRIMARY KEY,
    description  TEXT NOT NULL,
    xp_gained    INTEGER NOT NULL,
    impact_note  INTEGER,             -- 1-5, subjetivo
    source       TEXT NOT NULL DEFAULT 'form',  -- v1: só 'form'; 'kami_chat' entra pós-mvp
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_log_attributes (
    action_log_id TEXT NOT NULL REFERENCES action_logs(id) ON DELETE CASCADE,
    attribute_id  TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
    PRIMARY KEY (action_log_id, attribute_id)
);

CREATE TABLE IF NOT EXISTS achievements (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    description   TEXT,
    rule_type     TEXT NOT NULL DEFAULT 'fixed',  -- v1: só 'fixed'
    criteria_json TEXT NOT NULL,       -- regra em JSON (ex: {"attribute":"aprendizado","count":10})
    unlocked_at   TEXT                 -- NULL = ainda bloqueada
);

-- ---------------- FINANÇAS ----------------
CREATE TABLE IF NOT EXISTS income_sources (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,        -- "parte 1", "parte 2"
    amount       REAL NOT NULL,
    payment_rule TEXT NOT NULL         -- ex: "5o dia útil" / "+15 dias úteis após parte 1"
);

CREATE TABLE IF NOT EXISTS income_entries (
    id                TEXT PRIMARY KEY,
    income_source_id  TEXT NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
    expected_date     TEXT NOT NULL,   -- calculada via workalendar
    paid_date         TEXT,
    amount            REAL NOT NULL,
    status            TEXT NOT NULL DEFAULT 'previsto'  -- 'previsto' | 'pago'
);

CREATE TABLE IF NOT EXISTS credit_cards (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    closing_day INTEGER NOT NULL,
    due_day     INTEGER NOT NULL,
    card_limit  REAL
);

CREATE TABLE IF NOT EXISTS fixed_bills (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    amount  REAL NOT NULL,
    due_day INTEGER NOT NULL,
    active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS debts (
    id           TEXT PRIMARY KEY,
    description  TEXT NOT NULL,
    counterparty TEXT,
    amount       REAL NOT NULL,
    due_date     TEXT,
    status       TEXT NOT NULL DEFAULT 'aberta'
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    amount               REAL NOT NULL,
    billing_day          INTEGER NOT NULL,
    installment_current  INTEGER,     -- NULL = assinatura recorrente sem fim
    installment_total    INTEGER,
    active               INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
    id          TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    amount      REAL NOT NULL,
    type        TEXT NOT NULL,         -- 'entrada' | 'saida'
    category    TEXT NOT NULL,
    card_id     TEXT REFERENCES credit_cards(id) ON DELETE SET NULL,
    date        TEXT NOT NULL
);

-- ---------------- APRENDIZADO ----------------
CREATE TABLE IF NOT EXISTS tracks (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    general_goal TEXT,
    status       TEXT NOT NULL DEFAULT 'ativa',  -- 'ativa' | 'pausada' | 'parada'
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
    id                TEXT PRIMARY KEY,
    track_id          TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pendente',  -- 'pendente' | 'concluido' | 'esquecido'
    started_at        TEXT,
    completed_at      TEXT,
    last_activity_at  TEXT
);

-- ---------------- ORGANIZAÇÃO ----------------
CREATE TABLE IF NOT EXISTS links (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    url      TEXT NOT NULL,
    category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_repos (
    id              TEXT PRIMARY KEY,
    repo_full_name  TEXT NOT NULL,     -- "usuario/kami"
    cached_status   TEXT,              -- json cru da última resposta da api pública
    last_synced_at  TEXT
);

CREATE TABLE IF NOT EXISTS email_accounts (
    id                TEXT PRIMARY KEY,
    label             TEXT NOT NULL,
    imap_host         TEXT NOT NULL,
    imap_port         INTEGER NOT NULL,
    username          TEXT NOT NULL,
    app_password_enc  TEXT NOT NULL    -- senha de app, criptografada localmente
);

CREATE TABLE IF NOT EXISTS email_cache (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    subject      TEXT NOT NULL,
    sender       TEXT NOT NULL,
    received_at  TEXT NOT NULL,
    is_read      INTEGER NOT NULL DEFAULT 0,
    summary_text TEXT                 -- NULL no v1 (sem IA); campo reservado pro pós-mvp
);

-- ---------------- METAS PESSOAIS ----------------
CREATE TABLE IF NOT EXISTS goals (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    type           TEXT NOT NULL,       -- 'financeira' | 'livre' ('academica' entra com Carreira, pós-mvp)
    current_value  REAL NOT NULL DEFAULT 0,
    target_value   REAL NOT NULL,
    unit           TEXT NOT NULL DEFAULT 'count',  -- 'money' | 'count'
    deadline       TEXT,
    status         TEXT NOT NULL DEFAULT 'ativa'   -- 'ativa' | 'concluida'
);

CREATE TABLE IF NOT EXISTS goal_contributions (
    id       TEXT PRIMARY KEY,
    goal_id  TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    amount   REAL NOT NULL,
    note     TEXT,
    date     TEXT NOT NULL
);

-- ---------------- ÍNDICES ÚTEIS ----------------
CREATE INDEX IF NOT EXISTS idx_action_logs_created_at ON action_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_email_cache_account ON email_cache(account_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_screen ON dashboard_widgets(screen);
