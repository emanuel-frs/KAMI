/**
 * Organização — aba e-mail: contas IMAP, filtros, sincronização e a lista
 * agrupada por dia (ORG-06).
 * MAN-02: saiu de pages/organizacao.js, que continua montando a tela
 * (template, eventos, troca de aba) e guarda o `state` compartilhado.
 */
import * as api from "../api/organizacao.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "../modals/err-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { refreshNotificationBell } from "../components/notification-bell.js";
import { showToast } from "../components/toast.js";
import { emailAccountColor } from "../components/email-account-color.js";
import { grupoDoDia, horaCurta } from "../components/email-texto.js";
import { openEmailLeitor } from "../modals/email-leitor-modal.js";
import { state, rootEl, escapeHtml, escapeAttr, fmtDateTimeBR } from "./organizacao.js";
import { t } from "../i18n.js";

// true depois que a seleção inicial de contas "padrão" já rodou uma vez
// nesta montagem — sem essa guarda, toda vez que loadAccounts() roda de
// novo (ex: depois de um CRUD de conta) a seleção do usuário seria
// resetada pras contas padrão, mesmo que ele já tivesse ligado/desligado
// chips manualmente.
let accountsSelectionInitialized = false;

// MAN-02: unmount (organizacao.js) zera a guarda por aqui — `let`
// importada de outro módulo é só leitura
export function esquecerSelecaoDeContas() {
  accountsSelectionInitialized = false;
}

/* ==================== contas de e-mail ==================== */

export async function loadAccounts() {
  state.accounts = await api.listEmailAccounts();

  // seleção inicial (só na primeira vez, ver accountsSelectionInitialized):
  // contas marcadas como "padrão" (sync_by_default) já vêm ativas na
  // visualização combinada. Se nenhuma for padrão, cai pra todas — nunca
  // fica vazio no primeiro load (decisão da secao 4.1 do plano).
  if (!accountsSelectionInitialized && state.accounts.length) {
    const defaults = state.accounts.filter((a) => a.sync_by_default);
    const initial = defaults.length ? defaults : state.accounts;
    state.selectedAccountIds = new Set(initial.map((a) => a.id));
    accountsSelectionInitialized = true;
  } else {
    // remove ids de contas que não existem mais (ex: conta removida)
    const validIds = new Set(state.accounts.map((a) => a.id));
    state.selectedAccountIds = new Set([...state.selectedAccountIds].filter((id) => validIds.has(id)));
  }
}

function isAccountMuted(accountId) {
  return state.mutedAccounts.some((m) => m.account_id === accountId);
}

export function renderAccounts() {
  const wrap = rootEl.querySelector("#org-accounts");
  if (!wrap) return; // painel fica dentro do modal de gerenciar contas — só existe depois do primeiro mount
  if (!state.accounts.length) {
    wrap.innerHTML = `<div class="empty-state">${t("organizacao_email.nenhuma_conta_cadastrada_ainda")}</div>`;
    return;
  }
  wrap.innerHTML = state.accounts
    .map((a) => {
      const muted = isAccountMuted(a.id);
      const syncing = state.syncingAccounts.has(a.id);
      return `
      <div class="org-account${muted ? " is-muted" : ""}">
        <div class="org-account-info">
          <b>${escapeHtml(a.label)}${a.sync_by_default ? ` ${icon("star", { size: 10, fill: "currentColor" })}` : ""}</b>
          <span class="meta">${escapeHtml(a.username)} · ${escapeHtml(a.imap_host)}:${a.imap_port}${muted ? ` · <span class="email-muted-tag">${icon("bell-off", { size: 9 })} ${t("organizacao_email.silenciada")}</span>` : ""}</span>
          ${syncErroTexto()[a.sync_erro] ? `<span class="org-account-erro">${icon("triangle-alert", { size: 10 })} ${syncErroTexto()[a.sync_erro].motivo}</span>` : ""}
        </div>
        <div class="org-account-actions">
          <span class="icon-btn" data-tooltip="${muted ? t("organizacao_email.reativar_notificacoes_desta_conta") : t("organizacao_email.silenciar_notificacoes_desta_conta")}" aria-label="${muted ? t("organizacao_email.reativar_notificacoes_desta_conta") : t("organizacao_email.silenciar_notificacoes_desta_conta")}" data-mute-account="${a.id}">${icon(muted ? "bell" : "bell-off", { size: 12 })}</span>
          <span class="icon-btn${syncing ? " is-syncing" : ""}" data-tooltip="${syncing ? "sincronizando..." : "sincronizar"}" aria-label="${syncing ? "sincronizando..." : "sincronizar"}" data-sync-account="${syncing ? "" : a.id}">${icon("refresh-cw", { size: 12 })}</span>
          <span class="icon-btn" data-tooltip="${t("geral.editar")}" aria-label="${t("geral.editar")}" data-edit-account="${a.id}">${icon("pencil", { size: 12 })}</span>
          <span class="icon-btn" data-tooltip="${t("geral.remover")}" aria-label="${t("geral.remover")}" data-delete-account="${a.id}">${icon("x")}</span>
        </div>
      </div>`;
    })
    .join("");
}

export function openManageAccountsModal() {
  renderAccounts();
  rootEl.querySelector("#manage-accounts-modal").classList.add("open");
}
export function closeManageAccountsModal() {
  rootEl.querySelector("#manage-accounts-modal").classList.remove("open");
}

/* ==================== chips de conta (visualização combinada) ==================== */

export function renderAccountChips() {
  renderSyncAlerts();
  const wrap = rootEl.querySelector("#org-account-chips");
  if (!wrap) return;
  if (!state.accounts.length) {
    wrap.innerHTML = `<div class="empty-state">${t("organizacao_email.nenhuma_conta_cadastrada_clique_em")}</div>`;
    return;
  }
  wrap.innerHTML = state.accounts
    .map((a) => {
      const on = state.selectedAccountIds.has(a.id);
      const color = emailAccountColor(a.id);
      return `
      <span class="email-account-chip${on ? " on" : ""}" data-account-chip="${a.id}" style="--chip-color:${color};" data-tooltip="${on ? t("organizacao_email.remover_da_visualizacao") : t("organizacao_email.adicionar_a_visualizacao")}" aria-label="${on ? t("organizacao_email.remover_da_visualizacao") : t("organizacao_email.adicionar_a_visualizacao")}">
        <span class="email-account-chip-dot"></span>
        ${escapeHtml(a.label)}
        <span class="email-account-star${a.sync_by_default ? " on" : ""}" data-toggle-default="${a.id}" data-tooltip="${a.sync_by_default ? t("organizacao_email.conta_padrao_clique_pra_desmarcar") : t("organizacao_email.marcar_como_conta_padrao_selecao")}" aria-label="${a.sync_by_default ? t("organizacao_email.conta_padrao_clique_pra_desmarcar") : t("organizacao_email.marcar_como_conta_padrao_selecao")}">${icon("star", { size: 10, fill: a.sync_by_default ? "currentColor" : "none" })}</span>
      </span>`;
    })
    .join("");
}

// ORG-06: o que dizer pra cada falha gravada na conta (sync_erro, ver
// EmailAccountOut no backend). Só falhas que a pessoa resolve — queda de
// rede não chega aqui.
const syncErroTexto = () => ({
  senha: { motivo: t("organizacao_email.a_senha_de_app_salva"), acao: t("organizacao_email.informar_a_senha") },
  login: { motivo: t("organizacao_email.o_servidor_recusou_o_login"), acao: t("organizacao_email.editar_conta") },
});

/**
 * Faixa de aviso no topo da aba de e-mail, uma linha por conta com
 * problema. Antes a sincronização automática (a cada 5 min) falhava só
 * no console: com as senhas apagadas, o Emanuel ficou uma tarde inteira
 * sem e-mail novo sem saber. O botão abre a edição da conta; salvar uma
 * senha nova tira o aviso na hora (o backend limpa sync_erro).
 */
function renderSyncAlerts() {
  const wrap = rootEl?.querySelector("#org-email-alertas");
  if (!wrap) return;
  const comErro = state.accounts.filter((a) => syncErroTexto()[a.sync_erro]);
  wrap.innerHTML = comErro
    .map((a) => {
      const erro = syncErroTexto()[a.sync_erro];
      const desde = a.sync_erro_desde ? t("organizacao_email.desde", { quando: fmtDateTimeBR(a.sync_erro_desde) }) : "";
      return `
      <div class="email-alerta" role="alert">
        <span class="email-alerta-icone" aria-hidden="true">${icon("triangle-alert", { size: 13 })}</span>
        <span class="email-alerta-texto">${t("organizacao_email.nao_sincroniza", { conta: `<b>${escapeHtml(a.label)}</b>`, desde: escapeHtml(desde), motivo: erro.motivo })}</span>
        <button type="button" class="btn sm warn" data-edit-account="${a.id}">${erro.acao}</button>
      </div>`;
    })
    .join("");
}

export function toggleAccountChip(accountId) {
  if (state.selectedAccountIds.has(accountId)) {
    state.selectedAccountIds.delete(accountId);
  } else {
    state.selectedAccountIds.add(accountId);
  }
  renderAccountChips();
  loadEmailsForSelectedAccounts().then(renderEmails);
}

// clique na estrela do chip — alterna sync_by_default direto, sem
// precisar abrir o modal de editar conta (ajuste pedido: dava pra ver
// qual conta é padrão só entrando em editar uma por uma). Independente
// de toggleAccountChip (que liga/desliga a conta da visualização) —
// bindEvents() já garante isso checando a estrela ANTES do chip.
export async function handleToggleDefaultAccount(accountId) {
  const acc = state.accounts.find((a) => a.id === accountId);
  if (!acc) return;
  const next = !acc.sync_by_default;
  acc.sync_by_default = next; // otimista — sem esperar o round-trip pra já refletir no chip/no modal
  renderAccountChips();
  renderAccounts();
  try {
    await api.updateEmailAccount(accountId, { sync_by_default: next });
  } catch (err) {
    acc.sync_by_default = !next; // desfaz se a chamada falhar
    renderAccountChips();
    renderAccounts();
    showErrorModal(err?.message || t("organizacao_email.falha_ao_atualizar_a_conta"), "erro");
  }
}

export function setEmailFilter(filter) {
  state.emailFilter = filter;
  rootEl.querySelectorAll("#org-email-filter [data-filter]").forEach((el) => {
    el.classList.toggle("on", el.dataset.filter === filter);
  });
  renderEmails();
}

/* ==================== sincronizar (botão do topo) ==================== */

export function renderSyncButton() {
  const btn = rootEl.querySelector("#org-email-sync-btn");
  if (!btn) return;
  const manualSyncing = [...state.selectedAccountIds].some((id) => state.syncingAccounts.has(id));
  const syncing = manualSyncing || state.schedulerSyncing;
  btn.classList.toggle("is-syncing", syncing);
  btn.disabled = syncing;
  btn.dataset.tooltip = syncing ? "sincronizando..." : "sincronizar";
}

export async function handleSyncSelectedAccounts() {
  const ids = [...state.selectedAccountIds];
  if (!ids.length) return;
  // decisão #4 do plano: sincroniza as contas SELECIONADAS no momento
  // (chips ativos), não necessariamente as marcadas como padrão.
  ids.forEach((id) => state.syncingAccounts.add(id));
  renderSyncButton();

  let results;
  try {
    results = await Promise.all(
      ids.map((id) =>
        api.syncEmailAccount(id).catch((err) => {
          console.error(`falha ao sincronizar conta ${id}:`, err);
          return null;
        })
      )
    );
  } finally {
    ids.forEach((id) => state.syncingAccounts.delete(id));
    renderSyncButton();
  }

  await Promise.all([loadAccounts(), loadEmailsForSelectedAccounts()]);
  renderAccountChips();
  renderEmails();

  // antes dizia "concluída — nenhum e-mail novo" mesmo com todas as
  // contas falhando; agora a falha aparece (e a faixa diz o porquê)
  const n = results.reduce((sum, r) => sum + (r?.new_messages ?? 0), 0);
  const falhas = results.filter((r) => r === null).length;
  showToast({
    title: falhas ? t("organizacao_email.contas_falharam", { n: falhas }) : t("organizacao_email.sincronizacao_concluida"),
    message: falhas
      ? t("organizacao_email.veja_o_aviso_no_topo")
      : n > 0 ? `${n} novo${n === 1 ? "" : "s"} e-mail${n === 1 ? "" : "s"}` : t("organizacao_email.nenhum_e_mail_novo"),
    iconName: falhas ? "triangle-alert" : "refresh-cw",
    variant: falhas ? "erro" : undefined,
  });
  refreshNotificationBell().catch((err) => console.error("falha ao atualizar o sino de notificações:", err));
}

export function openAccountModal(accountId) {
  const modal = rootEl.querySelector("#account-modal");
  const hint = rootEl.querySelector("#acc-password-hint");
  const syncByDefaultInput = rootEl.querySelector("#acc-sync-by-default");
  if (accountId) {
    const acc = state.accounts.find((a) => a.id === accountId);
    rootEl.querySelector("#acc-edit-id").value = acc.id;
    rootEl.querySelector("#acc-label").value = acc.label;
    rootEl.querySelector("#acc-host").value = acc.imap_host;
    rootEl.querySelector("#acc-port").value = acc.imap_port;
    rootEl.querySelector("#acc-username").value = acc.username;
    rootEl.querySelector("#acc-password").value = "";
    syncByDefaultInput.checked = !!acc.sync_by_default;
    // ORG-06: veio do aviso "a senha não pode ser usada" — manter a atual
    // não resolve nada, então o campo já diz isso e recebe o foco
    const senhaRuim = acc.sync_erro === "senha";
    hint.textContent = senhaRuim
      ? t("organizacao_email.a_senha_salva_nao_funciona")
      : t("organizacao_email.deixe_em_branco_pra_manter");
    hint.classList.toggle("is-erro", senhaRuim);
    // modal-accessibility.js põe o foco em [data-autofocus] ao abrir
    rootEl.querySelector("#acc-password").toggleAttribute("data-autofocus", senhaRuim);
  } else {
    rootEl.querySelector("#acc-edit-id").value = "";
    ["acc-label", "acc-host", "acc-username", "acc-password"].forEach((id) => (rootEl.querySelector("#" + id).value = ""));
    rootEl.querySelector("#acc-port").value = 993;
    syncByDefaultInput.checked = true;
    hint.textContent = "";
    hint.classList.remove("is-erro");
    rootEl.querySelector("#acc-password").removeAttribute("data-autofocus");
  }
  modal.classList.add("open");
}

export function closeAccountModal() {
  rootEl.querySelector("#account-modal").classList.remove("open");
}

export async function handleSaveAccount() {
  const editId = rootEl.querySelector("#acc-edit-id").value;
  const label = rootEl.querySelector("#acc-label").value.trim();
  const imap_host = rootEl.querySelector("#acc-host").value.trim();
  const imap_port = parseInt(rootEl.querySelector("#acc-port").value, 10) || 993;
  const username = rootEl.querySelector("#acc-username").value.trim();
  const app_password = rootEl.querySelector("#acc-password").value;
  const sync_by_default = rootEl.querySelector("#acc-sync-by-default").checked;

  if (!label || !imap_host || !username || (!editId && !app_password)) {
    showErrorModal(t("organizacao_email.preencha_apelido_host_usuario_e"), t("geral.atencao"));
    return;
  }

  if (editId) {
    const payload = { label, imap_host, imap_port, username, sync_by_default };
    if (app_password) payload.app_password = app_password;
    await api.updateEmailAccount(editId, payload);
  } else {
    await api.createEmailAccount({ label, imap_host, imap_port, username, app_password, sync_by_default });
  }
  closeAccountModal();
  await loadAccounts();
  renderAccounts();
  renderAccountChips();
  await loadEmailsForSelectedAccounts();
  renderEmails();
}

export async function handleDeleteAccount(accountId) {
  const ok = await showConfirmModal(t("organizacao_email.remover_esta_conta_o_cache"), {
    title: t("organizacao_email.remover_conta"),
    confirmText: t("geral.remover"),
    danger: true,
  });
  if (!ok) return;
  await api.deleteEmailAccount(accountId);
  state.selectedAccountIds.delete(accountId);
  await loadAccounts();
  renderAccounts();
  renderAccountChips();
  await loadEmailsForSelectedAccounts();
  renderEmails();
  renderSyncButton();
}

export async function handleSyncAccount(accountId) {
  if (state.syncingAccounts.has(accountId)) return; // já sincronizando essa conta — ignora clique duplicado
  state.syncingAccounts.add(accountId);
  renderAccounts(); // trava o botão, gira o ícone e troca o tooltip pra "sincronizando..." (data-sync-account/is-syncing)
  renderSyncButton();

  let result;
  try {
    result = await api.syncEmailAccount(accountId);
  } catch (err) {
    showErrorModal(err?.message || t("organizacao_email.falha_ao_sincronizar_confira_host"), t("organizacao_email.falha_ao_sincronizar"));
    loadAccounts().then(() => rootEl && (renderAccountChips(), renderAccounts())).catch(() => {});
    return;
  } finally {
    state.syncingAccounts.delete(accountId);
    renderAccounts();
    renderSyncButton();
  }

  // conta sincronizada individualmente entra na visualização combinada
  // mesmo que não estivesse ativa antes — sem isso o resultado do sync
  // some (não aparece em lugar nenhum até a pessoa ligar o chip manualmente).
  state.selectedAccountIds.add(accountId);
  await Promise.all([loadAccounts(), loadEmailsForSelectedAccounts()]);
  renderAccountChips();
  renderAccounts();
  renderEmails();

  // feedback visível de que o sync rodou de verdade (antes não tinha
  // nenhum — clicar em sincronizar não dava pra saber se achou algo
  // novo ou se falhou silenciosamente) + atualiza o badge do sino, que
  // só era atualizado pelo sync automático em segundo plano, não pelo
  // clique manual aqui.
  const n = result?.new_messages ?? 0;
  showToast({
    title: t("organizacao_email.sincronizacao_concluida"),
    message: n > 0 ? `${n} novo${n === 1 ? "" : "s"} e-mail${n === 1 ? "" : "s"}` : t("organizacao_email.nenhum_e_mail_novo"),
    iconName: "refresh-cw",
  });
  refreshNotificationBell().catch((err) => console.error("falha ao atualizar o sino de notificações:", err));
}

/* ==================== e-mails (cache) ==================== */

// mescla os e-mails de todas as contas em state.selectedAccountIds
// (opção "mais simples" recomendada na secao 3.2 do plano: uma consulta
// por conta via Promise.all, em vez de mudar o contrato de /email-cache
// pra aceitar múltiplos account_id) e ordena por received_at desc.
export async function loadEmailsForSelectedAccounts() {
  const ids = [...state.selectedAccountIds];
  if (!ids.length) {
    state.emails = [];
    return;
  }
  const lists = await Promise.all(ids.map((id) => api.listEmailCache({ account_id: id })));
  state.emails = lists.flat().sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
}

export async function loadMutedAccounts() {
  state.mutedAccounts = await api.listMutedAccounts();
}

// atualiza os números entre parênteses nos botões de filtro (tudo/não
// lidos/silenciados) a partir do mesmo cache state.emails usado pra
// montar a lista — sem round-trip novo ao backend, mesma lógica de
// filtragem usada logo abaixo.
function renderEmailFilterCounts() {
  const countAllEl = rootEl.querySelector("#org-email-filter-count-all");
  if (!countAllEl) return;

  const emails = state.emails || [];
  const countAll = emails.length;
  const countUnread = emails.filter((e) => !e.is_read && !e.is_muted).length;
  const countMuted = emails.filter((e) => e.is_muted).length;

  countAllEl.textContent = `(${countAll})`;
  rootEl.querySelector("#org-email-filter-count-unread").textContent = `(${countUnread})`;
  rootEl.querySelector("#org-email-filter-count-muted").textContent = `(${countMuted})`;
}

export function renderEmails() {
  renderEmailFilterCounts();

  const wrap = rootEl.querySelector("#org-emails");
  if (!wrap) return;

  if (!state.selectedAccountIds.size) {
    wrap.innerHTML = `<div class="empty-state">${t("organizacao_email.nenhuma_conta_selecionada_ligue_um")}</div>`;
    return;
  }
  if (!state.emails.length) {
    wrap.innerHTML = `<div class="empty-state">${t("organizacao_email.vazio", { icone: icon("refresh-cw", { size: 10 }) })}</div>`;
    return;
  }

  // filtro (substitui o antigo único checkbox "mostrar silenciados" por
  // um seletor de 3 estados, ver secao 4.2 do plano): "all" mostra tudo
  // (inclusive silenciado), "unread" só não lidos e não silenciados,
  // "muted" só os de conta silenciada.
  let visible = state.emails;
  if (state.emailFilter === "unread") {
    visible = visible.filter((e) => !e.is_read && !e.is_muted);
  } else if (state.emailFilter === "muted") {
    visible = visible.filter((e) => e.is_muted);
  }

  // busca client-side (assunto/remetente/prévia), sobre o cache já
  // carregado — decisão #3 do plano: sem round-trip novo ao backend.
  const q = state.emailQuery.trim().toLowerCase();
  if (q) {
    visible = visible.filter((e) =>
      (e.subject || "").toLowerCase().includes(q) ||
      (e.sender || "").toLowerCase().includes(q) ||
      (e.body_preview || "").toLowerCase().includes(q)
    );
  }

  // ordem que o leitor percorre com ← → (mesmo filtro/busca da tela)
  state.visibleEmailIds = visible.map((e) => e.id);

  if (!visible.length) {
    wrap.innerHTML = `<div class="empty-state">${t("organizacao_email.nenhum_e_mail_corresponde_a")}</div>`;
    return;
  }

  // ORG-06 (P-29): agrupado por dia — hoje, ontem, esta semana, este mês
  // e depois por mês. A lista já vem em ordem decrescente de data, então
  // cada grupo novo só aparece quando a chave muda.
  const agora = new Date();
  let grupoAtual = null;
  wrap.innerHTML = visible
    .map((e) => {
      const grupo = grupoDoDia(e.received_at, agora);
      const cabecalho = grupo.chave !== grupoAtual ? `<div class="email-grupo">${escapeHtml(grupo.rotulo)}</div>` : "";
      grupoAtual = grupo.chave;
      return cabecalho + emailItemHtml(e, agora);
    })
    .join("");
}

/** Linha da lista: remetente (nome em destaque, endereço menor) e hora
 * em cima, assunto, prévia limpa (sem URL — ver app/email_texto.py).
 * Não lido = ponto na cor de destaque + texto mais claro. Sem tooltip na
 * prévia: o texto inteiro está a um clique, no leitor. */
function emailItemHtml(e, agora) {
  const color = emailAccountColor(e.account_id);
  const nome = e.sender_name || e.sender || "?";
  const endereco = e.sender_email && e.sender_email !== nome ? e.sender_email : "";
  const estado = e.is_muted ? "silenciado" : e.is_read ? "lido" : t("organizacao_email.nao_lido");
  return `
      <div class="email-item${e.is_read ? "" : " unread"}${e.is_muted ? " is-muted" : ""}" data-open-email="${e.id}" aria-label="${escapeAttr(`${estado}: ${e.subject || t("organizacao_email.sem_assunto")}, de ${nome}`)}">
        <span class="email-dot" aria-hidden="true"></span>
        <div class="email-avatar" style="--chip-color:${color};" data-tooltip="${escapeAttr(t("email.conta_tooltip", { conta: accountLabel(e.account_id) }))}">${escapeHtml(nome.trim().charAt(0).toUpperCase() || "?")}</div>
        <div class="email-main">
          <div class="email-top">
            <span class="email-from"><span class="email-from-name">${escapeHtml(nome)}</span>${endereco ? ` <span class="email-from-addr">${escapeHtml(endereco)}</span>` : ""}</span>
            ${e.is_muted ? `<span class="email-tag">${t("organizacao_email.silenciado")}</span>` : ""}
            <span class="email-meta">${escapeHtml(horaCurta(e.received_at, agora))}</span>
          </div>
          <div class="email-subject">${escapeHtml(e.subject || t("organizacao_email.sem_assunto"))}</div>
          ${e.body_preview ? `<div class="email-preview">${escapeHtml(e.body_preview)}</div>` : ""}
        </div>
      </div>`;
}

function accountLabel(accountId) {
  return state.accounts.find((a) => a.id === accountId)?.label || "?";
}

/** Abre o leitor (modals/email-leitor-modal.js). Percorre a lista na
 * ordem visível; se o e-mail pedido não está nela (veio do sino com um
 * filtro que o esconde), abre só ele. */
export function openEmailModal(cacheId) {
  if (!state.emails.some((e) => e.id === cacheId)) return;
  const ids = state.visibleEmailIds?.includes(cacheId) ? state.visibleEmailIds : [cacheId];
  openEmailLeitor({
    ids: [...ids],
    index: ids.indexOf(cacheId),
    resumo: (id) => state.emails.find((e) => e.id === id),
    conta: (accountId) => ({ label: accountLabel(accountId), color: emailAccountColor(accountId) }),
    onLido: (id, lido) => {
      const email = state.emails.find((e) => e.id === id);
      if (email) email.is_read = lido;
      if (rootEl) renderEmails();
      // some/volta no sino na hora — sem isso ele continuaria contando
      // um e-mail que já foi lido aqui (ou não contaria o desmarcado)
      refreshNotificationBell().catch((err) => console.error("falha ao atualizar o sino de notificações:", err));
    },
  });
}

/**
 * Alterna o silenciamento da CONTA inteira (não mais por remetente
 * individual — ver EmailCacheOut.is_muted/muted_accounts no backend e
 * o botão em renderAccounts). Precisa do id da linha em muted_accounts
 * pra dessilenciar (o DELETE é por id, não por account_id), por isso
 * state.mutedAccounts é recarregado junto — sem isso não existe forma
 * de reverter.
 */
export async function handleToggleMuteAccount(accountId) {
  const entry = state.mutedAccounts.find((m) => m.account_id === accountId);

  if (entry) {
    await api.unmuteAccount(entry.id);
  } else {
    await api.muteAccount(accountId);
  }

  const reloads = [loadMutedAccounts()];
  if (state.selectedAccountIds.has(accountId)) reloads.push(loadEmailsForSelectedAccounts());
  await Promise.all(reloads);
  renderAccounts();
  renderEmails();
  refreshNotificationBell().catch((err) => console.error("falha ao atualizar o sino de notificações:", err));
}
