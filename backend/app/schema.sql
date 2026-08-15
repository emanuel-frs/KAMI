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
    id                    TEXT PRIMARY KEY,   -- linha única (app single-user no v1)
    display_name          TEXT NOT NULL,
    accent_color          TEXT NOT NULL DEFAULT '#8fbf8f',
    avatar_ascii          TEXT,               -- NULL = sem avatar ainda
    onboarding_completed  INTEGER NOT NULL DEFAULT 0,  -- decisão 25 (seção 15.6)
    last_backup_at        TEXT,               -- NULL = nunca exportou um backup
    updated_at            TEXT NOT NULL
);

-- ---------------- DICAS CONTEXTUAIS POR TELA (etapa 5, plano-onboarding-kami.md) ----------------
-- Granularidade por tela, separada de user_profile.onboarding_completed
-- (que é só o tour geral de 7 telas). Uma linha por tela já vista =
-- sequência de dicas contextuais concluída ou pulada nessa tela.
CREATE TABLE IF NOT EXISTS screen_tips_seen (
    screen    TEXT PRIMARY KEY,   -- 'nucleo' | 'perfil' | 'financas' | 'aprendizado' | 'organizacao' | 'metas'
    seen_at   TEXT NOT NULL
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

-- Cadastro da conta fixa em si (nome/valor/dia de vencimento). Assim como
-- wallet_subscriptions, marcar uma instância mensal (fixed_bill_periods)
-- como paga é OPCIONALMENTE real: se `conta_id` está preenchida E o
-- usuário confirma na hora de marcar como paga (ver
-- app/routers/financas.py::pay_fixed_bill_period), gera uma transação
-- 'saida' de verdade e desconta saldo/fatura da conta vinculada — mesmo
-- comportamento de um app de finanças "de verdade" (YNAB/Mobills: marcar
-- uma conta recorrente como paga lança a despesa). Sem conta_id, ou se o
-- usuário recusar, continua sendo só lembrete (decisão do item 6 do mapa
-- de problemas, resolvida como opcional por registro).
CREATE TABLE IF NOT EXISTS fixed_bills (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    amount    REAL NOT NULL,
    due_day   INTEGER NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1,
    conta_id  TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL,
    categoria TEXT   -- usada na transação gerada quando marcada paga; cai
                      -- pra um default ("contas fixas") se ficar em branco
);

-- Um registro por (conta fixa, mês) — nasce "não paga" quando o mês é
-- consultado pela primeira vez. Mesmo padrão sob-demanda de
-- wallet_subscription_periods/income_entries, unificando os 3 conceitos de
-- "coisa que se repete todo mês" (item 1 do mapa de problemas).
-- transaction_id aponta pra a transação real gerada ao marcar como paga
-- (NULL se foi marcada só como lembrete, sem gerar transação) — permite
-- reverter de forma limpa quando o usuário desfaz o pagamento.
CREATE TABLE IF NOT EXISTS fixed_bill_periods (
    id             TEXT PRIMARY KEY,
    fixed_bill_id  TEXT NOT NULL REFERENCES fixed_bills(id) ON DELETE CASCADE,
    mes_ano        TEXT NOT NULL,   -- 'YYYY-MM'
    paga           INTEGER NOT NULL DEFAULT 0,
    valor_pago     REAL,            -- override, só se pago com valor diferente do esperado
    transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    UNIQUE(fixed_bill_id, mes_ano)
);

CREATE TABLE IF NOT EXISTS debts (
    id           TEXT PRIMARY KEY,
    description  TEXT NOT NULL,
    counterparty TEXT,
    amount       REAL NOT NULL,
    due_date     TEXT,
    status       TEXT NOT NULL DEFAULT 'aberta'
);

-- ---------------- WALLET (bancos → contas) ----------------
-- Substitui a antiga credit_cards. Um banco agrupa 1+ contas; cada conta
-- escolhe individualmente se possui_saldo e/ou possui_credito. O banco
-- "dinheiro" é fixo (is_dinheiro=1), criado sob demanda pelo backend
-- (ver app/routers/wallet.py::_ensure_dinheiro_bank), nunca deletável.
CREATE TABLE IF NOT EXISTS wallet_banks (
    id          TEXT PRIMARY KEY,
    nome        TEXT NOT NULL,
    icon_ascii  TEXT,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_accounts (
    id              TEXT PRIMARY KEY,
    bank_id         TEXT NOT NULL REFERENCES wallet_banks(id) ON DELETE CASCADE,
    nome            TEXT NOT NULL,
    possui_saldo    INTEGER NOT NULL DEFAULT 0,
    saldo_atual     REAL,
    possui_credito  INTEGER NOT NULL DEFAULT 0,
    fatura_atual    REAL,
    limite_total    REAL,
    dia_vencimento  INTEGER,
    UNIQUE(bank_id, nome)
);

-- Assinaturas: marcar uma instância mensal (wallet_subscription_periods)
-- como paga é OPCIONALMENTE real — mesmo mecanismo de fixed_bills acima
-- (item 6 do mapa de problemas): com conta_id preenchida e confirmação do
-- usuário no momento de marcar como paga, gera uma transação 'saida' de
-- verdade. `categoria` alimenta essa transação (default "assinaturas" se
-- vazia). Sem conta_id, continua sendo só lembrete.
CREATE TABLE IF NOT EXISTS wallet_subscriptions (
    id             TEXT PRIMARY KEY,
    nome           TEXT NOT NULL,
    valor_esperado REAL NOT NULL,
    dia_cobranca   INTEGER NOT NULL,
    conta_id       TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL,
    active         INTEGER NOT NULL DEFAULT 1,
    categoria      TEXT
);

-- Um registro por (assinatura, mês) — nasce "não paga" quando o mês é
-- consultado pela primeira vez (mesmo padrão sob-demanda de income_entries).
-- transaction_id: ver comentário equivalente em fixed_bill_periods.
CREATE TABLE IF NOT EXISTS wallet_subscription_periods (
    id               TEXT PRIMARY KEY,
    subscription_id  TEXT NOT NULL REFERENCES wallet_subscriptions(id) ON DELETE CASCADE,
    mes_ano          TEXT NOT NULL,   -- 'YYYY-MM'
    paga             INTEGER NOT NULL DEFAULT 0,
    valor_pago       REAL,            -- override, só se pago com valor diferente do esperado
    transaction_id   TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    UNIQUE(subscription_id, mes_ano)
);

-- transactions: troca card_id (apontava pra credit_cards, removida) por
-- conta_id (wallet_accounts, agora obrigatório), e ganha suporte a
-- transferência. Uma transferência é UMA linha só (origem + destino na
-- mesma linha) — não duas linhas linkadas, já que os dois saldos são
-- atualizados na mesma operação e não há necessidade de separar.
CREATE TABLE IF NOT EXISTS transactions (
    id                TEXT PRIMARY KEY,
    description       TEXT NOT NULL,
    amount            REAL NOT NULL,
    type              TEXT NOT NULL,   -- 'entrada' | 'saida' | 'transferencia'
    category          TEXT NOT NULL,
    conta_id          TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL,  -- origem (ou única conta) —
                                                                                -- obrigatório na criação (ver
                                                                                -- financas.py), mas nullable aqui
                                                                                -- pra não apagar histórico se a
                                                                                -- conta for deletada depois
    forma_pagamento   TEXT,            -- 'saldo' | 'credito' — só quando a conta tem os dois (tipo 'saida')
    conta_destino_id  TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL,  -- só transferência interna
    destino_externo   TEXT,            -- só transferência externa (texto livre)
    date              TEXT NOT NULL
);

-- ---------------- APRENDIZADO ----------------
CREATE TABLE IF NOT EXISTS tracks (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    general_goal TEXT,
    status       TEXT NOT NULL DEFAULT 'ativa',  -- 'ativa' | 'pausada' | 'parada'
    position     INTEGER NOT NULL DEFAULT 0,     -- ordem manual na sidebar (drag-and-drop, item 3.2)
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
    id                TEXT PRIMARY KEY,
    track_id          TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    description       TEXT,               -- descricao fixa do modulo, editada no modal "editar modulo"
    notes             TEXT,                -- anotacoes livres do usuario, separadas da descricao
    status            TEXT NOT NULL DEFAULT 'pendente',  -- 'pendente' | 'concluido' | 'esquecido'
    position          INTEGER NOT NULL DEFAULT 0,  -- ordem dentro da trilha (reordenavel, estilo trello)
    started_at        TEXT,
    completed_at      TEXT,
    last_activity_at  TEXT,
    xp_awarded         INTEGER             -- XP creditado ao concluir este marco especifico — usado
                                            -- pra estornar o valor exato se o marco for desmarcado
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
    summary_text TEXT,                -- NULL no v1 (sem IA); campo reservado pro pós-mvp
    body_preview TEXT                 -- trecho em TEXTO PURO do corpo (sem HTML), truncado
                                       -- na extração (ver app/routers/organizacao.py) — nunca
                                       -- o corpo original/HTML bruto, por segurança (XSS/tracking)
);

-- ---------------- METAS PESSOAIS (v2 — tipos, peso, financas+aprendizado) ----------------
CREATE TABLE IF NOT EXISTS goals (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    type             TEXT NOT NULL,       -- 'financeira' | 'livre' | 'saude' | 'leitura' | 'habito' |
                                           -- 'aprendizado' ('academica' entra com Carreira, pós-mvp)
    current_value    REAL NOT NULL DEFAULT 0,
    target_value     REAL NOT NULL,
    unit             TEXT NOT NULL DEFAULT 'count',  -- 'money' | 'count'
    unit_label       TEXT,                 -- rótulo livre pro 'count' ("kg", "páginas", "vezes"...)
    deadline         TEXT,
    status           TEXT NOT NULL DEFAULT 'ativa',  -- 'ativa' | 'concluida'
    weight           TEXT NOT NULL DEFAULT 'medio',  -- 'baixo' | 'medio' | 'alto' | 'epico' — multiplica o xp
    linked_conta_id  TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL,  -- só 'financeira' (conta padrão)
    linked_track_id  TEXT REFERENCES tracks(id) ON DELETE SET NULL           -- só 'aprendizado'
);

CREATE TABLE IF NOT EXISTS goal_contributions (
    id             TEXT PRIMARY KEY,
    goal_id        TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    amount         REAL NOT NULL,
    note           TEXT,
    date           TEXT NOT NULL,
    origem         TEXT,     -- 'conta' | 'externo' | NULL (metas não-financeiras não usam)
    transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL  -- só quando origem = 'conta'
);

-- ---------------- CONFIGURAÇÃO GITHUB (token pessoal, opcional) ----------------
CREATE TABLE IF NOT EXISTS github_settings (
    id         TEXT PRIMARY KEY,   -- linha única (mesmo padrão de user_profile)
    token_enc  TEXT,               -- fine-grained PAT, criptografado (mesmo esquema do IMAP)
    updated_at TEXT
);

-- ---------------- CONFIGURAÇÃO BUSCA (chave da Tavily, obrigatória pra 4.1) ----------------
CREATE TABLE IF NOT EXISTS search_settings (
    id         TEXT PRIMARY KEY,   -- linha única (mesmo padrão de github_settings)
    api_key_enc TEXT,              -- chave da Tavily, criptografada (mesmo esquema do IMAP/github)
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS compras_parceladas (
    id                   TEXT PRIMARY KEY,
    nome                 TEXT NOT NULL,
    valor_total          REAL NOT NULL,
    num_parcelas         INTEGER NOT NULL,
    conta_id             TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL,
    mes_primeira_parcela TEXT NOT NULL,
    ajuste_parcelas      INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compra_parcelada_aplicacoes (
    id             TEXT PRIMARY KEY,
    compra_id      TEXT NOT NULL REFERENCES compras_parceladas(id) ON DELETE CASCADE,
    mes_ano        TEXT NOT NULL,
    parcela_numero INTEGER NOT NULL,
    valor_aplicado REAL NOT NULL,
    UNIQUE(compra_id, mes_ano)
);

-- ---------------- ÍNDICES ÚTEIS ----------------
CREATE INDEX IF NOT EXISTS idx_action_logs_created_at ON action_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_conta ON transactions(conta_id);
CREATE INDEX IF NOT EXISTS idx_wallet_accounts_bank ON wallet_accounts(bank_id);
CREATE INDEX IF NOT EXISTS idx_email_cache_account ON email_cache(account_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_screen ON dashboard_widgets(screen);