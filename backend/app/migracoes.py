"""
Migrações idempotentes do banco (antes ficavam em database.py — MAN-02).

Cada `_migrate_*` confere o estado antes de mexer (coluna, tabela, linha)
e pode rodar em todo boot. Quem chama, e em que ordem, continua sendo
`database._init_db`: os nomes são importados lá, então trocar um deles
no módulo `database` (como faz o teste de migração que falha) ainda
vale. Daqui pra `database` só se usa o que está pronto antes desta
importação (new_id, now_iso, local_now, SOM_COLUNAS, NOTIF_COLUNAS), e
sempre na hora da chamada — por isso `from app import database` e não
`from app.database import …` (seria import circular).
"""
import datetime
import re
import sqlite3

from app import database


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
    # ORG-06: texto completo limpo + Message-ID (ver schema.sql). E-mails
    # antigos ficam com NULL e são completados na próxima sincronização
    # que os trouxer de novo (routers/organizacao.py).
    if "body_text" not in cols:
        conn.execute("ALTER TABLE email_cache ADD COLUMN body_text TEXT")
    if "body_cortado" not in cols:
        conn.execute("ALTER TABLE email_cache ADD COLUMN body_cortado INTEGER NOT NULL DEFAULT 0")
    if "message_id" not in cols:
        conn.execute("ALTER TABLE email_cache ADD COLUMN message_id TEXT")
    if "gmail_id" not in cols:
        conn.execute("ALTER TABLE email_cache ADD COLUMN gmail_id TEXT")
    # ORG-06: falha de sincronização gravada na conta (ver EmailAccountOut)
    contas = [r["name"] for r in conn.execute("PRAGMA table_info(email_accounts)").fetchall()]
    for col in ("sync_erro", "sync_erro_desde", "ultimo_sync_ok"):
        if col not in contas:
            conn.execute(f"ALTER TABLE email_accounts ADD COLUMN {col} TEXT")
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
    ganharem geração OPCIONAL de transação real ao marcar como pago (item 6,
    resolvido junto com a unificação do item 1):
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
                    (database.new_id(), acc["account_id"], database.now_iso()),
                )

    conn.execute("DROP TABLE IF EXISTS muted_senders")
    conn.commit()


def _migrate_email_accounts_sync_by_default(conn: sqlite3.Connection) -> None:
    """
    Migração leve pra quem já tinha um kami.db criado antes da coluna
    sync_by_default existir (redesign da aba e-mail). Default 1 pra não quebrar
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


def _migrate_rename_wallet_widget_type(conn: sqlite3.Connection) -> None:
    """
    Renomeia o widget_type 'wallet' pra 'carteira' em dashboard_widgets
    (unificação de nomenclatura — rotas/módulo viraram /api/carteira e
    app/routers/carteira.py, e a chave do catálogo em app/widgets.py
    também virou 'carteira'). Sem essa migration, instalações já
    existentes têm literalmente a string 'wallet' gravada na coluna
    widget_type do sqlite do usuário — o frontend não teria mais como
    resolver esse tipo (COMPONENT_PATHS/WIDGET_CATALOG só conhecem
    'carteira' agora) e o widget de carteira sumiria do dashboard de
    Finanças ao atualizar. Idempotente — UPDATE sem match nenhum é um
    no-op silencioso, então rodar de novo em bancos já migrados não
    faz nada.
    """
    conn.execute("UPDATE dashboard_widgets SET widget_type = 'carteira' WHERE widget_type = 'wallet'")
    conn.commit()


def _migrate_action_logs_referencia(conn: sqlite3.Connection) -> None:
    """
    Adiciona referencia_tipo/referencia_id em action_logs (integridade
    do xp): cada ação gerada automaticamente por um módulo passa a
    apontar pra entidade que a gerou, e desfazer essa entidade estorna
    o log certo (ver app/actions.py::revert_actions). Logs antigos ficam
    com NULL — os módulos mantêm o estorno legado por `xp_awarded` pra
    eles. O índice é criado aqui (e não no schema.sql) porque em bancos
    antigos a coluna só existe depois do ALTER TABLE.
    """
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(action_logs)").fetchall()}
    if "referencia_tipo" not in cols:
        conn.execute("ALTER TABLE action_logs ADD COLUMN referencia_tipo TEXT")
    if "referencia_id" not in cols:
        conn.execute("ALTER TABLE action_logs ADD COLUMN referencia_id TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_action_logs_referencia "
        "ON action_logs(referencia_tipo, referencia_id)"
    )
    conn.commit()


# timestamp sem offset ('2026-10-07T23:30:00' ou com microssegundos) —
# o formato que o antigo database.now_iso() (utcnow) gravava. Datas puras
# ('YYYY-MM-DD', digitadas pelo usuário) não casam e nunca são tocadas.
_NAIVE_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$")

# colunas preenchidas por database.now_iso() que não seguem o padrão de nome *_at
_EXTRA_TIMESTAMP_COLUMNS = {("goal_contributions", "date")}


def _migrate_achievements_chave(conn: sqlite3.Connection) -> None:
    """
    Adiciona achievements.chave — identificador estável de cada conquista
    do seed (antes o seed reconhecia conquistas pelo título, e renomear
    uma no código criava uma duplicata). O preenchimento das linhas
    existentes fica com seed_achievements, que casa pelo título uma vez.
    Índice único criado aqui porque em bancos antigos a coluna só existe
    depois do ALTER TABLE.
    """
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(achievements)").fetchall()}
    if "chave" not in cols:
        conn.execute("ALTER TABLE achievements ADD COLUMN chave TEXT")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_chave ON achievements(chave)"
    )
    conn.commit()


def _migrate_achievements_meta(conn: sqlite3.Connection) -> None:
    """
    Metadados das conquistas (GAM-01): categoria (área da vida, filtro da
    galeria), nivel (bronze/prata/ouro) e secreta. Preenchidos pelo
    seed_achievements logo depois, casando pela chave — bancos antigos
    só ganham as colunas vazias aqui.
    """
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(achievements)").fetchall()}
    if "categoria" not in cols:
        conn.execute("ALTER TABLE achievements ADD COLUMN categoria TEXT")
    if "nivel" not in cols:
        conn.execute("ALTER TABLE achievements ADD COLUMN nivel TEXT")
    if "secreta" not in cols:
        conn.execute("ALTER TABLE achievements ADD COLUMN secreta INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def _migrate_user_profile_efeitos_visuais(conn: sqlite3.Connection) -> None:
    """
    GAM-04: preferência de efeitos visuais da gamificação — 'completo'
    (tela de subida de nível + linhas de xp + avisos), 'sutil' (sem a tela
    cheia) ou 'desligado' (só os avisos, sem animação). Bancos antigos
    nascem em 'completo', o mesmo default do schema.sql.
    """
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()}
    if "efeitos_visuais" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN efeitos_visuais TEXT NOT NULL DEFAULT 'completo'")
    conn.commit()


def _migrate_user_profile_icone_tema(conn: sqlite3.Connection) -> None:
    """ICO-01: ícone do app acompanha a cor de destaque — opcional, desligado (P-08)."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()}
    if "icone_tema" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN icone_tema INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def _migrate_user_profile_sequencia_protecao(conn: sqlite3.Connection) -> None:
    """
    GAM-06: dia a partir do qual a proteção de sequência vale. Nasce NULL
    e é preenchido no primeiro cálculo da sequência (app/sequencia.py) —
    a regra nova não é aplicada no passado, então buracos antigos
    continuam quebrando a sequência como antes. A tabela dias_protegidos
    vem do schema.sql (CREATE TABLE IF NOT EXISTS também cria em banco
    antigo); só a coluna nova de user_profile precisa do ALTER TABLE.
    """
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()}
    if "sequencia_protecao_desde" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN sequencia_protecao_desde TEXT")
    # aviso "sequência salva" (visto ou não) — veio depois da tabela, então
    # banco que já tinha dias_protegidos ganha a coluna aqui
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(dias_protegidos)").fetchall()}
    if "avisado_em" not in cols:
        conn.execute("ALTER TABLE dias_protegidos ADD COLUMN avisado_em TEXT")
    conn.commit()


def _migrate_user_profile_recompensas(conn: sqlite3.Connection) -> None:
    """
    GAM-10: título e tema de terminal escolhidos (recompensas por nível,
    app/recompensas.py). Bancos antigos nascem sem título escolhido (NULL =
    mostra o mais alto liberado) e no tema padrão.
    """
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()}
    if "titulo" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN titulo TEXT")
    if "tema" not in cols:
        conn.execute("ALTER TABLE user_profile ADD COLUMN tema TEXT NOT NULL DEFAULT 'padrao'")
    conn.commit()




def _migrate_user_profile_notif_fora(conn: sqlite3.Connection) -> None:
    """ORG-05: colunas de notificação fora do app (ver database.NOTIF_COLUNAS)."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()}
    for col, tipo in database.NOTIF_COLUNAS.items():
        if col not in cols:
            conn.execute(f"ALTER TABLE user_profile ADD COLUMN {col} {tipo}")
    conn.commit()


def _migrate_user_profile_som(conn: sqlite3.Connection) -> None:
    """GAM-13: colunas de som em user_profile (ver database.SOM_COLUNAS)."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(user_profile)").fetchall()}
    for col, default in database.SOM_COLUNAS.items():
        if col not in cols:
            conn.execute(f"ALTER TABLE user_profile ADD COLUMN {col} INTEGER NOT NULL DEFAULT {default}")
    conn.commit()


def _migrate_missoes_widget(conn: sqlite3.Connection, had_missoes: bool) -> None:
    """
    GAM-07: põe o widget "missões" no topo do Núcleo de quem já tinha um
    layout — só uma vez, na primeira inicialização com a tabela missoes
    (`had_missoes` = a tabela já existia ANTES do schema.sql rodar). Quem
    remover o widget depois não o vê voltar. Instalação nova (layout ainda
    vazio) recebe o widget pelo LAYOUT_PADRAO (app/widgets.py) em _seed_defaults.
    """
    if had_missoes:
        return
    has_layout = conn.execute("SELECT 1 FROM dashboard_widgets WHERE screen = 'nucleo' LIMIT 1").fetchone()
    has_widget = conn.execute("SELECT 1 FROM dashboard_widgets WHERE widget_type = 'missoes' LIMIT 1").fetchone()
    if has_layout and not has_widget:
        conn.execute("UPDATE dashboard_widgets SET position = position + 1 WHERE screen = 'nucleo'")
        conn.execute(
            "INSERT INTO dashboard_widgets (id, screen, widget_type, position, width, height, config_json) "
            "VALUES (?, 'nucleo', 'missoes', 0, 6, NULL, NULL)",
            (database.new_id(),),
        )
    conn.commit()


def migrate_timestamps_to_local(conn: sqlite3.Connection) -> int:
    """
    Converte timestamps legados (UTC sem offset, gravados pelo antigo
    database.now_iso) pra hora local com offset — mesmo formato do database.now_iso atual.
    Varre toda coluna *_at de toda tabela (mais _EXTRA_TIMESTAMP_COLUMNS)
    e só mexe em valores sem offset, então é idempotente: roda a cada
    init_db e também depois de importar um backup antigo (ver
    routers/sistema.py::import_data), sem nunca converter duas vezes.
    Não comita — quem chama decide (o import precisa disso dentro da
    própria transação). Devolve quantos valores foram convertidos.
    """
    converted = 0
    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    ]
    for table in tables:
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        for col in cols:
            if not (col.endswith("_at") or (table, col) in _EXTRA_TIMESTAMP_COLUMNS):
                continue
            rows = conn.execute(
                f"SELECT rowid, {col} FROM {table} WHERE {col} LIKE '____-__-__T%'"
            ).fetchall()
            for rowid, value in rows:
                if not _NAIVE_DATETIME_RE.match(value):
                    continue
                as_utc = datetime.datetime.fromisoformat(value).replace(tzinfo=datetime.timezone.utc)
                conn.execute(
                    f"UPDATE {table} SET {col} = ? WHERE rowid = ?",
                    (as_utc.astimezone().isoformat(), rowid),
                )
                converted += 1
    return converted


def _migrate_debts_quitacao(conn: sqlite3.Connection) -> None:
    """
    P-13 (CONF-04): quitar uma dívida passa a funcionar como pagar uma
    conta fixa — pode lançar a saída real numa conta. `transacao_id`
    guarda essa transação pra desmarcar a quitação devolver o dinheiro.
    Dívidas já marcadas como pagas antes disto ficam com NULL (quitadas
    sem conta), e continuam valendo pra conquista.
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(debts)").fetchall()]
    if "transacao_id" not in cols:
        conn.execute("ALTER TABLE debts ADD COLUMN transacao_id TEXT REFERENCES transactions(id) ON DELETE SET NULL")
    conn.commit()


def _migrate_transacao_referencia(conn: sqlite3.Connection) -> None:
    """
    CONF-07: o xp de um lançamento (action_log "lançou entrada: mercado")
    passou a apontar pra transação (referencia 'transacao'), pra que
    apagar/corrigir o lançamento estorne o xp certo. Os logs antigos não
    tinham vínculo: aqui eles são ligados à transação de mesma descrição,
    na ordem em que os dois foram criados (o log é gravado logo depois da
    transação, e o rowid guarda a ordem de inserção). Log sem par fica sem
    vínculo — apagar aquele lançamento antigo só não estorna o xp dele.
    Idempotente: só olha logs ainda sem referência.
    """
    logs = conn.execute(
        "SELECT id, description FROM action_logs "
        "WHERE source = 'financas' AND referencia_tipo IS NULL AND description LIKE 'lançou %' "
        "ORDER BY created_at, rowid"
    ).fetchall()
    if not logs:
        return
    linked = {
        r["referencia_id"]
        for r in conn.execute("SELECT referencia_id FROM action_logs WHERE referencia_tipo = 'transacao'").fetchall()
    }
    pending: dict = {}
    for tx in conn.execute("SELECT id, type, description FROM transactions ORDER BY rowid").fetchall():
        if tx["id"] not in linked:
            pending.setdefault(f"lançou {tx['type']}: {tx['description']}", []).append(tx["id"])
    for log in logs:
        fila = pending.get(log["description"])
        if fila:
            conn.execute(
                "UPDATE action_logs SET referencia_tipo = 'transacao', referencia_id = ? WHERE id = ?",
                (fila.pop(0), log["id"]),
            )
    conn.commit()
