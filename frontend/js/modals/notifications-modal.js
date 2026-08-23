import { escapeHtml, fmtMoney, fmtRelDate } from "../components/format.js";
import { icon } from "../components/icons.js";
import { TYPE_META } from "../components/event-types.js";
import { fetchPendingAlerts, todayStr } from "../components/calendar-alerts.js";
import { listEmailCache, listEmailAccounts, markEmailRead, muteAccount } from "../api/organizacao.js";
import { setPendingFocus } from "../components/pending-focus.js";
import { navigateTo } from "../components/navigate.js";
import { accountColor } from "../components/account-color.js";

/**
 * Modal unificado de notificações (notificações v2.1) — substitui DOIS
 * componentes anteriores:
 *
 *   1. modals/calendar-alerts-modal.js (lista "vencendo em breve" do
 *      Calendário, aberta pelo próprio sino da tela de calendário).
 *   2. o popover de e-mail de components/notification-bell.js (sino do
 *      rodapé da sidebar) — que cortava na tela em telas menores por
 *      usar posicionamento tipo tooltip (`position: absolute` ancorado
 *      no botão) em vez de um modal de verdade centralizado.
 *
 * Os dois sinos (sidebar + calendário) agora abrem ESTE modal — mesmo
 * conteúdo nos dois lugares, só o botão que abre é diferente. O modal
 * busca seus próprios dados toda vez que abre (calendário +
 * e-mail/contas), então funciona igual não importa de onde foi aberto.
 *
 * Seção de e-mail: só lista NÃO LIDOS (ler um e-mail em Organização
 * some daqui na próxima vez que abrir — não precisa de lógica extra
 * pra isso, é reflexo direto do filtro is_read=false), e começa
 * recolhida ("você tem N novos e-mails"), expandindo pro bloco
 * scrollável ao clicar — mesmo padrão visual da lista antiga do
 * popover (classes .nbell-* de notification-bell.css, reaproveitadas
 * aqui de propósito pra não duplicar CSS).
 */

const FALLBACK_META = { label: "", color: "var(--text-faint)", icon: "circle-help" };
const MAX_EMAIL_ITEMS = 12;

let modalEl = null;
let alerts = [];
let emails = [];
let accounts = [];
let emailsExpanded = false;

function daysDiff(dateStr, today) {
  const a = new Date(`${dateStr}T00:00:00Z`);
  const b = new Date(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

function emailInitial(sender) {
  const name = (sender || "?").split("@")[0].replace(/[._-]/g, " ").trim();
  return (name.charAt(0) || "?").toUpperCase();
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "notifications-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">${icon("bell", { size: 13 })}&nbsp;notificações <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="notif-section">
          <div class="notif-section-head">
            ${icon("calendar-days", { size: 12 })}
            <span>vencendo em breve</span>
          </div>
          <div class="cal-alerts-list" id="notif-alerts-list"></div>
        </div>
        <div class="notif-section" id="notif-email-section"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeNotificationsModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeNotificationsModal(); });
  return wrap;
}

function renderAlerts() {
  const listEl = modalEl.querySelector("#notif-alerts-list");
  const today = todayStr();

  if (!alerts.length) {
    listEl.innerHTML = `<div class="empty-state">nada vencendo nos próximos dias.</div>`;
    return;
  }

  listEl.innerHTML = alerts
    .map((e) => {
      const meta = TYPE_META[e.type] || { ...FALLBACK_META, label: e.type };
      const diff = daysDiff(e.date, today);
      const dueLabel = diff < 0
        ? `atrasado (${Math.abs(diff)}d)`
        : diff === 0
        ? "vence hoje"
        : diff === 1
        ? "vence amanhã"
        : `vence em ${diff}d`;
      const amountHtml = e.amount != null ? `<span class="cal-alert-amount">${fmtMoney(e.amount)}</span>` : "";
      const recordId = e.id.split(":")[1] || "";
      return `
        <div class="cal-alert-item${diff < 0 ? " overdue" : ""}" data-module="${escapeHtml(e.module)}" data-type="${escapeHtml(e.type)}" data-record-id="${escapeHtml(recordId)}">
          <span class="cal-alert-dot" style="--type-color:${meta.color}">${icon(meta.icon, { size: 11 })}</span>
          <span class="cal-alert-title">${escapeHtml(e.title)}</span>
          ${amountHtml}
          <span class="cal-alert-due">${dueLabel}</span>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".cal-alert-item").forEach((row) => {
    row.addEventListener("click", () => {
      const { module, type, recordId } = row.dataset;
      if (!module || !type || !recordId) return;
      closeNotificationsModal();
      setPendingFocus(type, recordId);
      navigateTo(module);
    });
  });
}

function unreadEmails() {
  return emails.filter((e) => !e.is_read);
}

function renderEmailSection() {
  const wrap = modalEl.querySelector("#notif-email-section");

  if (!accounts.length) {
    wrap.innerHTML = `
      <div class="notif-section-head">${icon("mail", { size: 12 })}<span>e-mails</span></div>
      <div class="empty-state">nenhuma conta conectada — configure em organização pra receber notificações de e-mail aqui.</div>
    `;
    return;
  }

  const unread = unreadEmails();

  if (!unread.length) {
    wrap.innerHTML = `
      <div class="notif-section-head">${icon("mail", { size: 12 })}<span>e-mails</span></div>
      <div class="empty-state">tudo em dia — nenhum e-mail novo.</div>
    `;
    return;
  }

  const items = unread.slice(0, MAX_EMAIL_ITEMS);
  const summaryLabel = `você tem ${unread.length} novo${unread.length === 1 ? "" : "s"} e-mail${unread.length === 1 ? "" : "s"}`;

  wrap.innerHTML = `
    <div class="notif-email-summary" id="notif-email-toggle" data-tooltip="${emailsExpanded ? "recolher" : "expandir"}">
      <span class="notif-email-summary-label">${icon("mail", { size: 13 })} ${summaryLabel}</span>
      <span class="notif-actions">
        <span class="icon-btn" data-action="notif-mark-all" data-tooltip="marcar todos como lidos">${icon("check", { size: 12 })}</span>
        <span class="notif-chevron${emailsExpanded ? " open" : ""}">${icon("chevron-down", { size: 12 })}</span>
      </span>
    </div>
    <div class="nbell-list${emailsExpanded ? "" : " collapsed"}" id="notif-email-list">
      ${items.map(emailItemHtml).join("")}
    </div>
  `;

  wrap.querySelector("#notif-email-toggle").addEventListener("click", (e) => {
    if (e.target.closest('[data-action="notif-mark-all"]')) return;
    emailsExpanded = !emailsExpanded;
    renderEmailSection();
  });
  wrap.querySelector('[data-action="notif-mark-all"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    onMarkAll();
  });
  wrap.querySelectorAll(".nbell-item").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="notif-mute-account"]')) return;
      onEmailClick(row.dataset.id);
    });
  });
  wrap.querySelectorAll('[data-action="notif-mute-account"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onMuteAccount(btn.dataset.accountId);
    });
  });
}

function emailItemHtml(e) {
  return `
    <div class="nbell-item unread" data-id="${e.id}" data-tooltip="marcar como lida e abrir">
      <span class="nbell-dot" aria-hidden="true"></span>
      <span class="nbell-avatar" style="--chip-color:${accountColor(e.account_id)};">${emailInitial(e.sender)}</span>
      <span class="nbell-main">
        <span class="nbell-top">
          <span class="nbell-subject">${escapeHtml(e.subject || "(sem assunto)")}</span>
          <span class="nbell-time">${fmtRelDate(e.received_at)}</span>
        </span>
        <span class="nbell-sender">${escapeHtml(e.sender)}</span>
        ${e.body_preview ? `<span class="nbell-preview">${escapeHtml(e.body_preview)}</span>` : ""}
      </span>
      <span class="icon-btn nbell-mute" data-action="notif-mute-account" data-account-id="${escapeHtml(e.account_id)}" data-tooltip="silenciar esta conta">${icon("bell-off", { size: 12 })}</span>
    </div>`;
}

function onEmailClick(cacheId) {
  const email = emails.find((e) => e.id === cacheId);
  if (!email) return;
  closeNotificationsModal();
  navigateTo("organizacao", { tab: "email", accountId: email.account_id, focusEmailId: email.id });
}

function onMarkAll() {
  const toMark = unreadEmails();
  if (!toMark.length) return;
  toMark.forEach((e) => (e.is_read = true));
  renderEmailSection();
  Promise.all(toMark.map((e) => markEmailRead(e.id))).catch((err) =>
    console.error("notifications-modal: falha ao marcar todos como lidos:", err)
  );
}

function onMuteAccount(accountId) {
  if (!accountId) return;
  // otimista — some da lista na hora, recarrega de verdade se a chamada falhar.
  emails = emails.filter((e) => e.account_id !== accountId);
  renderEmailSection();
  muteAccount(accountId).catch((err) => {
    console.error("notifications-modal: falha ao silenciar conta:", err);
    loadEmailData().then(renderEmailSection);
  });
}

async function loadCalendarData() {
  try {
    alerts = await fetchPendingAlerts();
  } catch (err) {
    console.error("notifications-modal: falha ao buscar alertas do calendário:", err);
    alerts = [];
  }
}

async function loadEmailData() {
  try {
    const [c, a] = await Promise.all([
      listEmailCache({ exclude_muted: true }),
      listEmailAccounts(),
    ]);
    emails = c;
    accounts = a;
  } catch (err) {
    console.error("notifications-modal: falha ao carregar e-mails:", err);
    emails = [];
    accounts = [];
  }
}

export function closeNotificationsModal() {
  modalEl?.classList.remove("open");
}

export async function openNotificationsModal() {
  modalEl = modalEl || buildModal();
  emailsExpanded = false;
  modalEl.classList.add("open");

  modalEl.querySelector("#notif-alerts-list").innerHTML = `<div class="empty-state">carregando…</div>`;
  modalEl.querySelector("#notif-email-section").innerHTML = `<div class="empty-state">carregando…</div>`;

  await Promise.all([loadCalendarData(), loadEmailData()]);
  renderAlerts();
  renderEmailSection();
}

/** Contagem combinada pra badges externas (sino da sidebar, etc.) —
 * recarrega os dois conjuntos de dados sem precisar o modal estar
 * aberto. */
export async function fetchNotificationsCount() {
  await Promise.all([loadCalendarData(), loadEmailData()]);
  return { alerts: alerts.length, emails: unreadEmails().length };
}
