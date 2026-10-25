import { escapeHtml, fmtMoney, fmtRelDate, fmtDataCompacta } from "../components/format.js";
import { icon } from "../components/icons.js";
import { typeMeta } from "../components/event-types.js";
import { fetchPendingAlerts, todayStr } from "../components/calendar-alerts.js";
import { listEmailCache, listEmailAccounts, markEmailRead, muteAccount } from "../api/organizacao.js";
import { refreshMutedAccounts } from "../pages/organizacao.js";
import { setPendingFocus } from "../components/pending-focus.js";
import { refreshNotificationBell } from "../components/notification-bell.js";
import { navigateTo } from "../components/navigate.js";
import { emailAccountColor } from "../components/email-account-color.js";
import { store } from "../state/store.js";
import { listEntrada } from "../api/entrada.js";
import { listPendentes, adiarLembrete, dispensarLembrete } from "../api/lembretes.js";
import { noSino, marcarAvisada, estadoAtualizacao, atualizarAgora, verNovidades, pularVersao, comoAtualiza } from "../components/atualizacao.js";
import { adiamentos, fecharAvisoDoLembrete } from "../components/lembretes-agendador.js";
import { noIdiomaAtual } from "../i18n.js";

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
      <div class="modal-head">${icon("bell", { size: 13 })}&nbsp;notificações <button type="button" class="close" data-action="close" aria-label="fechar">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="notif-section" id="notif-atualizacao-section" hidden></div>
        <div class="notif-section" id="notif-lembretes-section" hidden></div>
        <div class="notif-section" id="notif-alerts-section">
          <div class="notif-section-head">
            ${icon("calendar-days", { size: 12 })}
            <span>vencendo em breve</span>
          </div>
          <div class="cal-alerts-list" id="notif-alerts-list"></div>
        </div>
        <div class="notif-section" id="notif-entrada-section" hidden></div>
        <div class="notif-section" id="notif-email-section"></div>
        <div class="empty-state" id="notif-all-disabled" hidden>nenhum tipo de notificação está ativo — ajuste em configurações &gt; notificações.</div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeNotificacoesModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeNotificacoesModal(); });
  wrap.querySelector("#notif-lembretes-section").addEventListener("click", onLembreteClick);
  wrap.querySelector("#notif-atualizacao-section").addEventListener("click", onAtualizacaoClick);
  window.addEventListener("kami:atualizacao", () => modalEl?.classList.contains("open") && renderAtualizacao());
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
      const meta = typeMeta()[e.type] || { ...FALLBACK_META, label: e.type };
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
          <span class="cal-alert-dot" style="--type-color:${meta.color}">${icon(meta.icon, { size: 18 })}</span>
          <span class="cal-alert-title" data-tooltip="${escapeHtml(e.title)}">${escapeHtml(e.title)}</span>
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
      closeNotificacoesModal();
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
      <span class="nbell-avatar" style="--chip-color:${emailAccountColor(e.account_id)};">${emailInitial(e.sender_name || e.sender)}</span>
      <span class="nbell-main">
        <span class="nbell-top">
          <span class="nbell-subject" data-tooltip="${escapeHtml(e.subject || "(sem assunto)")}">${escapeHtml(e.subject || "(sem assunto)")}</span>
          <span class="nbell-time">${fmtRelDate(e.received_at)}</span>
        </span>
        <span class="nbell-sender"${e.sender_email ? ` data-tooltip="${escapeHtml(e.sender_email)}"` : ""}>${escapeHtml(e.sender_name || e.sender)}</span>
        ${e.body_preview ? `<span class="nbell-preview">${escapeHtml(e.body_preview)}</span>` : ""}
      </span>
      <span class="icon-btn nbell-mute" data-action="notif-mute-account" data-account-id="${escapeHtml(e.account_id)}" data-tooltip="silenciar esta conta">${icon("bell-off", { size: 12 })}</span>
    </div>`;
}

function onEmailClick(cacheId) {
  const email = emails.find((e) => e.id === cacheId);
  if (!email) return;
  closeNotificacoesModal();
  navigateTo("organizacao", { tab: "email", accountId: email.account_id, focusEmailId: email.id });
}

function onMarkAll() {
  const toMark = unreadEmails();
  if (!toMark.length) return;
  const ids = toMark.map((e) => e.id);
  toMark.forEach((e) => (e.is_read = true));
  renderEmailSection();
  // propaga pro store — a tela de organização, se já estiver montada,
  // marca os mesmos e-mails como lidos na hora (mesmo padrão de
  // store.set/store.subscribe usado em accent_color/nome/avatar do
  // perfil, ver settings-modal.js + widgets/profile.js), sem precisar
  // recarregar/reabrir a tela.
  store.set("emailsMarkedRead", ids);
  Promise.all(toMark.map((e) => markEmailRead(e.id)))
    .then(() => refreshNotificationBell())
    .catch((err) =>
      console.error("notifications-modal: falha ao marcar todos como lidos:", err)
    );
}

function onMuteAccount(accountId) {
  if (!accountId) return;
  // otimista — some da lista na hora, recarrega de verdade se a chamada falhar.
  emails = emails.filter((e) => e.account_id !== accountId);
  renderEmailSection();
  muteAccount(accountId)
    // tela de Organização pode estar aberta atrás deste modal — sem
    // isso ela só refletia o silenciamento no próximo mount() (sair e
    // entrar de novo na tela). O badge do sino também precisa recontar,
    // já que e-mails da conta agora silenciada saem da contagem.
    .then(() => Promise.all([refreshMutedAccounts(), refreshNotificationBell()]))
    .catch((err) => {
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

// ── ORG-05: lembretes pendentes (sempre — como a caixa de entrada) ─────

function quandoLembrete(l) {
  const [dia, hora] = (l.pendente_quando || "").split("T");
  if (!dia) return "";
  return `${dia === todayStr() ? "hoje" : fmtDataCompacta(dia)} às ${hora}`;
}

async function renderLembretes() {
  const el = modalEl.querySelector("#notif-lembretes-section");
  let lista = [];
  try {
    lista = await listPendentes();
  } catch {
    el.hidden = true;
    return;
  }
  el.hidden = !lista.length;
  if (!lista.length) return;
  modalEl.querySelector("#notif-all-disabled").hidden = true;
  el.innerHTML = `
    <div class="notif-section-head">${icon("bell-ring", { size: 12 })}<span>lembretes</span></div>
    <div class="notif-lembretes">${lista
      .map(
        (l) => `
      <div class="notif-lembrete" data-lembrete-id="${l.id}">
        <div class="notif-lembrete-texto">
          <span class="notif-lembrete-titulo">${escapeHtml(l.titulo)}</span>
          <span class="notif-lembrete-quando">${escapeHtml(quandoLembrete(l))}${l.atrasado ? ' · <span class="notif-lembrete-passou">passou com o kami fechado</span>' : ""}${l.vinculo ? ` · ${escapeHtml(l.vinculo.nome)}` : ""}</span>
        </div>
        <div class="notif-lembrete-acoes">
          ${adiamentos().map((a, i) => `<button type="button" class="btn sm" data-adiar="${i}" aria-label="adiar ${a.rotulo}: ${escapeHtml(l.titulo)}">adiar ${a.rotulo}</button>`).join("")}
          <button type="button" class="btn sm" data-dispensar aria-label="ok, dispensar: ${escapeHtml(l.titulo)}">ok</button>
        </div>
      </div>`,
      )
      .join("")}</div>`;
}

async function onLembreteClick(e) {
  const linha = e.target.closest("[data-lembrete-id]");
  if (!linha) return;
  const id = linha.dataset.lembreteId;
  const adiar = e.target.closest("[data-adiar]");
  try {
    if (adiar) await adiarLembrete(id, adiamentos()[Number(adiar.dataset.adiar)].quanto);
    else if (e.target.closest("[data-dispensar]")) await dispensarLembrete(id);
    else return;
  } catch {
    return; // o client já mostrou o erro
  }
  fecharAvisoDoLembrete(id);
  window.dispatchEvent(new CustomEvent("kami:lembretes-mudaram"));
  await renderLembretes();
}

// DIST-01: versão nova do kami (components/atualizacao.js). Só avisa:
// instalar é sempre a pessoa que pede.
function renderAtualizacao() {
  const el = modalEl.querySelector("#notif-atualizacao-section");
  const { disponivel, instalando } = estadoAtualizacao();
  el.hidden = !noSino().mostrar;
  if (el.hidden) return;
  modalEl.querySelector("#notif-all-disabled").hidden = true;
  const { versao, atual, data, instalavel } = disponivel;
  el.innerHTML = `
    <div class="notif-section-head">${icon("download", { size: 12 })}<span>versão nova do kami</span></div>
    <div class="notif-lembretes">
      <div class="notif-lembrete">
        <div class="notif-lembrete-texto">
          <span class="notif-lembrete-titulo">versão ${escapeHtml(versao)} disponível</span>
          <span class="notif-lembrete-quando">você está na ${escapeHtml(atual)}${data ? ` · publicada em ${escapeHtml(fmtDataCompacta(data))}` : ""} · ${escapeHtml(comoAtualiza())}</span>
        </div>
        <div class="notif-lembrete-acoes">
          <button type="button" class="btn sm" data-atualizacao="novidades">ver novidades</button>
          ${instalavel ? `<button type="button" class="btn sm primary" data-atualizacao="agora"${instalando ? " disabled" : ""}>${instalando ? "atualizando…" : "atualizar agora"}</button>` : ""}
          <button type="button" class="btn sm" data-atualizacao="pular">pular esta versão</button>
        </div>
      </div>
    </div>`;
}

async function onAtualizacaoClick(e) {
  const acao = e.target.closest("[data-atualizacao]")?.dataset.atualizacao;
  if (acao === "novidades") verNovidades();
  else if (acao === "agora") {
    closeNotificacoesModal();
    await atualizarAgora();
  } else if (acao === "pular") {
    try {
      await pularVersao();
    } catch {
      return; // o client já mostrou o erro
    }
    renderAtualizacao();
  }
}

export function closeNotificacoesModal() {
  modalEl?.classList.remove("open");
}

export async function openNotificacoesModal() {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  emailsExpanded = false;
  modalEl.classList.add("open");

  // configurações > notificações (settings-modal.js) filtra por tipo —
  // seção desmarcada nem é buscada, some do modal por completo. Lê do
  // store (populado no boot e mantido em sync por quem grava o
  // perfil) em vez de um fetch próprio; `!== false` trata undefined
  // (perfil ainda não carregou) como ligado, mesmo default do schema.
  const profile = store.get("profile");
  const showAlerts = profile?.notif_alerts_enabled !== false;
  const showEmail = profile?.notif_email_enabled !== false;

  const alertsSectionEl = modalEl.querySelector("#notif-alerts-section");
  const emailSectionEl = modalEl.querySelector("#notif-email-section");
  const allDisabledEl = modalEl.querySelector("#notif-all-disabled");
  alertsSectionEl.hidden = !showAlerts;
  emailSectionEl.hidden = !showEmail;
  allDisabledEl.hidden = showAlerts || showEmail;

  if (showAlerts) alertsSectionEl.querySelector("#notif-alerts-list").innerHTML = `<div class="empty-state">carregando…</div>`;
  if (showEmail) emailSectionEl.innerHTML = `<div class="empty-state">carregando…</div>`;

  renderLembretes();
  renderAtualizacao();
  marcarAvisada(); // DIST-01: viu no sino → não conta mais no badge

  // ORG-02: caixa de entrada (sempre — não é um tipo de aviso que se desliga)
  const entradaEl = modalEl.querySelector("#notif-entrada-section");
  listEntrada()
    .then((itens) => {
      entradaEl.hidden = !itens.length;
      if (!itens.length) return;
      entradaEl.innerHTML = `
        <div class="notif-email-summary" data-action="abrir-entrada">
          <span class="notif-email-summary-label">${icon("download", { size: 13 })} ${itens.length} ${itens.length === 1 ? "item" : "itens"} na caixa de entrada</span>
          <span class="notif-entrada-ir">abrir ${icon("arrow-right", { size: 11 })}</span>
        </div>`;
      entradaEl.querySelector("[data-action=abrir-entrada]").addEventListener("click", () => {
        closeNotificacoesModal();
        navigateTo("organizacao", { tab: "entrada" });
      });
      // o "nenhum tipo ativo" não vale se tem coisa na entrada
      if (itens.length) allDisabledEl.hidden = true;
    })
    .catch(() => (entradaEl.hidden = true));

  await Promise.all([
    showAlerts ? loadCalendarData() : Promise.resolve((alerts = [])),
    showEmail ? loadEmailData() : Promise.resolve((emails = []) && (accounts = [])),
  ]);
  if (showAlerts) renderAlerts();
  if (showEmail) renderEmailSection();
}
