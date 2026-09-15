-- ============================================================
-- KAMI — schema SQLite do v1
-- Convenção: todo `id` é TEXT (UUID v4, gerado em Python antes do
-- insert — não é AUTOINCREMENT). Ver decisão de arquitetura: risco
-- de mobile sync (13.6) e multi-perfil (13.4) tornava caro trocar
-- isso depois, então decidimos usar UUID desde o v1.
-- Datas guardadas como TEXT ISO-8601 (SQLite não tem tipo DATE).
-- ============================================================

-- Convenção daqui pra frente: toda tabela/coluna NOVA nasce em português.
-- Tabelas/colunas antigas em inglês (wallet_*, debts, income_sources,
-- transactions e suas colunas description/amount/type/category/date) não
-- são renomeadas retroativamente pra não exigir migration de dado já
-- gravado em instalações existentes.

PRAGMA foreign_keys = ON;

-- ---------------- PERFIL (decisão 15) ----------------
CREATE TABLE IF NOT EXISTS user_profile (
    id                    TEXT PRIMARY KEY,   -- linha única (app single-user no v1)
    display_name          TEXT NOT NULL,
    accent_color          TEXT NOT NULL DEFAULT '#8fbf8f',
    avatar_ascii          TEXT,               -- NULL = sem avatar ainda
    onboarding_completed  INTEGER NOT NULL DEFAULT 0,  -- decisão 25 (seção 15.6)
    last_backup_at        TEXT,               -- NULL = nunca exportou um backup
    notif_alerts_enabled  INTEGER NOT NULL DEFAULT 1,  -- config. notificações: seção "vencendo em breve" (calendário)
    notif_email_enabled   INTEGER NOT NULL DEFAULT 1,  -- config. notificações: seção "e-mails"
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
-- Renda recorrente (v2 — substitui o hardcode de exatamente 2 fontes
-- fixas "parte 1"/"parte 2" por um cadastro genérico, com CRUD completo
-- e suporte a encadeamento entre fontes; ver app/routers/financas.py e
-- app/database.py::_migrate_income_v2 pro racional completo).
--
-- `frequencia`: 'mensal' | 'quinzenal' | 'semanal' | 'avulsa'.
-- `tipo_data` (NULL só quando frequencia='avulsa') define como a data
-- prevista de cada ocorrência é calculada:
--   'dia_fixo'       -> `dia_mes` (1-31, clampado no último dia do mês
--                        em meses mais curtos). Só mensal.
--   'dia_util'       -> N-ésimo dia útil do mês (`nth_dia_util`), via
--                        business_days.py. Só mensal.
--   'intervalo_dias' -> toda vez que se passam `intervalo_dias` dias a
--                        partir de `data_base` (cobre quinzenal=14/
--                        semanal=7 como caso particular, mas aceita
--                        qualquer N).
--   'offset_fonte'   -> depende de outra fonte (`fonte_referencia_id`):
--                        soma `offset_dias_uteis` dias úteis à data
--                        (paga, se já confirmada; senão prevista) da
--                        ocorrência da fonte de referência naquele mês.
--                        Validado contra ciclos na criação/edição.
-- `data_avulsa` só é usada com frequencia='avulsa' — uma única entrada
-- nessa data, sem gerar novas ocorrências (`unica=1`, ver
-- _ensure_income_entries_for_month).
-- `conta_id` opcional: marcar uma ocorrência como paga credita saldo
-- real na conta vinculada (mesmo padrão opcional de fixed_bills/
-- wallet_subscriptions — item 6 do mapa de problemas, agora replicado
-- aqui). `categoria` alimenta a transação gerada, cai pra "renda" se
-- vazia.
CREATE TABLE IF NOT EXISTS income_sources (
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

-- Uma linha por ocorrência, gerada sob demanda (mesmo padrão sob-demanda
-- de fixed_bill_periods/wallet_subscription_periods). transaction_id:
-- ver comentário equivalente em fixed_bill_periods — aponta pra
-- transação 'entrada' real gerada ao marcar como paga (NULL se a fonte
-- não tem conta_id vinculada, ou se foi marcada só como lembrete),
-- permite reverter de forma limpa em /unpay.
CREATE TABLE IF NOT EXISTS income_entries (
    id                TEXT PRIMARY KEY,
    income_source_id  TEXT NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
    expected_date     TEXT NOT NULL,   -- calculada via business_days.py quando aplicável
    paid_date         TEXT,
    amount            REAL NOT NULL,
    status            TEXT NOT NULL DEFAULT 'previsto',  -- 'previsto' | 'pago'
    transaction_id    TEXT REFERENCES transactions(id) ON DELETE SET NULL
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
    xp_awarded         INTEGER,            -- XP creditado ao concluir este marco especifico — usado
                                            -- pra estornar o valor exato se o marco for desmarcado
    was_ever_stale     INTEGER NOT NULL DEFAULT 0  -- 1 se este marco já passou por 'esquecido' em
                                            -- algum momento da vida dele (marcado por _apply_staleness),
                                            -- mesmo que depois tenha sido reaberto/concluído — nunca
                                            -- volta a 0; usado pelo achievement 'milestone_completed'
                                            -- ("trilha em dia": concluir um marco sem nunca ter ficado
                                            -- esquecido)
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
    last_synced_at  TEXT,
    source          TEXT NOT NULL DEFAULT 'manual',  -- 'manual' ou 'auto' (importado via token)
    owner_login     TEXT               -- login da conta dona do token, só pra source='auto'
);

CREATE TABLE IF NOT EXISTS email_accounts (
    id                TEXT PRIMARY KEY,
    label             TEXT NOT NULL,
    imap_host         TEXT NOT NULL,
    imap_port         INTEGER NOT NULL,
    username          TEXT NOT NULL,
    app_password_enc  TEXT NOT NULL,   -- senha de app, criptografada localmente
    sync_by_default   INTEGER NOT NULL DEFAULT 1  -- redesign da aba e-mail: contas "padrão"
                                                    -- já vêm selecionadas na visualização
                                                    -- combinada ao entrar na tela (ver
                                                    -- plano-email-organizacao.md secao 3.1)
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

-- ---------------- CONTAS SILENCIADAS (notificações v2.1) ----------------
-- silencia uma CONTA de e-mail inteira (não um remetente/e-mail
-- individual) — decisão revisitada: quem tem mais de uma conta IMAP
-- vinculada em Organização e recebe muito volume numa delas prefere
-- silenciar a conta de uma vez a ter que silenciar remetente por
-- remetente. E-mails da conta continuam sendo sincronizados/cacheados
-- normalmente em email_cache (aparecem em Organização igual a
-- qualquer outro), só ficam de fora da lista/contagem do sino de
-- notificações. Substitui a antiga muted_senders (ver
-- _migrate_muted_accounts em app/database.py pra migração dos dados).
CREATE TABLE IF NOT EXISTS muted_accounts (
    id         TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE REFERENCES email_accounts(id) ON DELETE CASCADE,
    muted_at   TEXT NOT NULL
);

-- ---------------- METAS PESSOAIS (v2 — tipos, peso, financas+aprendizado) ----------------
CREATE TABLE IF NOT EXISTS goals (
    id                   TEXT PRIMARY KEY,
    title                TEXT NOT NULL,
    type                 TEXT NOT NULL,       -- 'financeira' | 'livre' | 'saude' | 'leitura' | 'habito' |
                                               -- 'aprendizado' | 'academica' (Parte 3 de Carreira)
    current_value        REAL NOT NULL DEFAULT 0,
    target_value         REAL NOT NULL,
    unit                 TEXT NOT NULL DEFAULT 'count',  -- 'money' | 'count'
    unit_label           TEXT,                 -- rótulo livre pro 'count' ("kg", "páginas", "vezes"...)
    deadline             TEXT,
    status               TEXT NOT NULL DEFAULT 'ativa',  -- 'ativa' | 'concluida'
    weight               TEXT NOT NULL DEFAULT 'medio',  -- 'baixo' | 'medio' | 'alto' | 'epico' — multiplica o xp
    linked_conta_id      TEXT REFERENCES wallet_accounts(id) ON DELETE SET NULL,      -- só 'financeira'
    linked_track_id      TEXT REFERENCES tracks(id) ON DELETE SET NULL,               -- só 'aprendizado'
    linked_education_id  TEXT REFERENCES career_educations(id) ON DELETE SET NULL     -- só 'academica'
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

-- compra_parcelada_aplicacoes (um registro por mês/parcela) foi removida:
-- nunca chegou a ser usada em nenhuma rota (app/routers/wallet.py sempre
-- calculou a parcela on the fly a partir de mes_primeira_parcela +
-- ajuste_parcelas — ver _compra_parcelada_out/_parcela_no_mes). Ficava
-- redundante manter uma tabela morta desde o plano anterior que não foi
-- concluído; dropada via migration em database.py pra quem já tinha um
-- kami.db antigo com ela criada.

-- ---------------- CALENDÁRIO (eventos manuais) ----------------
-- Única tabela própria do módulo Calendário (item novo) — todo o resto
-- que aparece na grade (conta_fixa/divida/assinatura/parcela/meta/acao)
-- continua vindo agregado de outros módulos, sem tabela própria (ver
-- app/routers/calendario.py). `evento` é o único tipo com CRUD real.
CREATE TABLE IF NOT EXISTS calendar_events (
    id                      TEXT PRIMARY KEY,
    title                   TEXT NOT NULL,
    date                    TEXT NOT NULL,   -- 'YYYY-MM-DD' — data da 1ª ocorrência
    time                    TEXT,            -- 'HH:MM' opcional
    notes                   TEXT,
    recurrence              TEXT NOT NULL DEFAULT 'none',  -- 'none'|'daily'|'weekly'|'monthly'|'yearly'
    recurrence_end          TEXT,            -- 'YYYY-MM-DD' opcional, NULL = sem fim
    reminder_minutes_before INTEGER,         -- NULL = sem lembrete
    color                   TEXT,            -- NULL = usa --accent
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date);

-- ---------------- CARREIRA (perfil profissional interno) ----------------
-- Parte 1 do módulo Carreira: só os dois blocos "campo simples" (área
-- atual/meta + interesses) — sem histórico próprio e sem XP (ver
-- carreira-regras-de-negocio.md, seções 1 e 2). Linha do tempo de
-- posições, formação acadêmica e evolução salarial chegam nas próximas
-- partes, em tabelas próprias.
CREATE TABLE IF NOT EXISTS career_profile (
    id         TEXT PRIMARY KEY,   -- linha única (mesmo padrão de user_profile)
    area_atual TEXT,
    area_meta  TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS career_interests (
    id         TEXT PRIMARY KEY,
    tag        TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Parte 2 do módulo Carreira: linha do tempo de posições (seção 3 do
-- documento de regras de negócio) — CRUD completo, com XP no atributo
-- 'carreira' via register_action na criação (ver app/routers/carreira.py).
-- `end_date` NULL = posição em andamento; múltiplas posições "atuais"
-- (várias linhas com end_date NULL) são permitidas de propósito, sem
-- validação de unicidade. `expected_contract_end`/`expected_salary_review`
-- ainda não alimentam o calendário nesta parte — isso é integração da
-- Parte 5, aqui só os campos já existem pra não precisar migração depois.
CREATE TABLE IF NOT EXISTS career_positions (
    id                     TEXT PRIMARY KEY,
    company                TEXT NOT NULL,
    role                   TEXT NOT NULL,
    area                   TEXT,
    employment_type        TEXT,   -- ex: CLT, PJ, freelancer, estágio — texto livre, sem enum no backend
    start_date             TEXT NOT NULL,  -- 'YYYY-MM-DD'
    end_date               TEXT,           -- 'YYYY-MM-DD', NULL = posição atual
    expected_contract_end  TEXT,           -- 'YYYY-MM-DD' opcional
    expected_salary_review TEXT,           -- 'YYYY-MM-DD' opcional
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_career_positions_start_date ON career_positions(start_date);

-- Parte 3 do módulo Carreira: formação acadêmica (seção 4 do documento de
-- regras de negócio) — CRUD completo, com XP escalonado por `nivel` no
-- atributo 'carreira', creditado só na TRANSIÇÃO pra status='concluido'
-- (criar/editar um registro "em andamento" não credita nada — diferente
-- de career_positions, aqui o marco que importa é a conclusão, não o
-- registro do início; mesmo espírito de milestones em Aprendizado).
-- `xp_awarded` guarda o valor efetivamente creditado (não um valor fixo
-- recalculado depois) pra reabrir o registro (status volta a diferir de
-- 'concluido') estornar exatamente o que foi dado, mesmo se NIVEL_XP
-- mudar no futuro — mesmo padrão de milestones.xp_awarded. Múltiplas
-- formações "em andamento" são permitidas, sem validação de unicidade
-- (mesma filosofia de career_positions com "atual").
CREATE TABLE IF NOT EXISTS career_educations (
    id                 TEXT PRIMARY KEY,
    curso              TEXT NOT NULL,
    instituicao        TEXT NOT NULL,
    nivel              TEXT NOT NULL,   -- 'certificacao'|'tecnico'|'graduacao'|'pos_graduacao'|'mestrado'|'doutorado'
    status             TEXT NOT NULL DEFAULT 'em_andamento',  -- 'em_andamento'|'concluido'|'trancado'
    previsao_conclusao TEXT,            -- 'YYYY-MM-DD' opcional — vira fonte de calendário na Parte 5
    xp_awarded         INTEGER,         -- NULL até concluir; guarda o xp creditado nessa conclusão
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_career_educations_status ON career_educations(status);

-- Parte 4 do módulo Carreira: evolução salarial (seção 5 do documento de
-- regras de negócio) — CRUD completo, com XP no atributo 'carreira'
-- diferenciado por lançamento em tempo real (proporcional ao salto, ver
-- SALARY_XP_REALTIME_* em app/routers/carreira.py) vs. preenchimento
-- retroativo de histórico (valor fixo simbólico) — mesmo critério
-- data=hoje/data!=hoje já usado em career_positions (comentário lá
-- previa essa reutilização). `position_id` é um vínculo OPCIONAL a uma
-- posição da linha do tempo (ON DELETE SET NULL — remover a posição não
-- apaga o histórico salarial, só desvincula, mesmo tratamento de
-- goals.linked_education_id); não há unicidade por posição, múltiplos
-- registros podem apontar pra mesma posição (reajustes dentro do mesmo
-- cargo).
CREATE TABLE IF NOT EXISTS career_salary_records (
    id          TEXT PRIMARY KEY,
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'BRL',
    employment_type TEXT,   -- ex: CLT, PJ — texto livre, sem enum no backend (mesmo padrão de career_positions)
    date        TEXT NOT NULL,  -- 'YYYY-MM-DD'
    reason      TEXT,           -- motivo opcional (ex: "promoção", "reajuste anual")
    position_id TEXT REFERENCES career_positions(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_career_salary_records_date ON career_salary_records(date);

-- ---------------- ÍNDICES ÚTEIS ----------------
CREATE INDEX IF NOT EXISTS idx_action_logs_created_at ON action_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_conta ON transactions(conta_id);
CREATE INDEX IF NOT EXISTS idx_wallet_accounts_bank ON wallet_accounts(bank_id);
CREATE INDEX IF NOT EXISTS idx_email_cache_account ON email_cache(account_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_screen ON dashboard_widgets(screen);