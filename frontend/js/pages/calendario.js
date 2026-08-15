import { listEvents } from "../api/calendario.js";
import { escapeHtml, fmtMoney } from "../components/format.js";
import { icon } from "../components/icons.js";
import { setPendingFocus } from "../components/pending-focus.js";
import { TYPE_META } from "../components/event-types.js";
import { openCalendarAlertsModal } from "../modals/calendar-alerts-modal.js";

const FALLBACK_META = { label: "", color: "var(--text-faint)", icon: "circle-help" };

/** Badge colorido (cor do tipo) com o ícone SVG do tipo dentro — reaproveitado
 * na grade do mês, no filtro do dia, na lista de eventos e na legenda, só
 * variando o tamanho do ícone via `size`. */
function typeBadge(type, size = 10) {
  const meta = TYPE_META[type] || { ...FALLBACK_META, label: type };
  return `<span class="cal-chip" style="--type-color:${meta.color}">${icon(meta.icon, { size })}</span>`;
}

// marcos concluídos chegam como um evento comum do tipo "acao", só que
// com a description prefixada — mesma convenção que o heatmap de
// Aprendizado já usa pra destacar esses dias (ver pages/aprendizado.js).
// Aqui a gente reaproveita a checagem pra dar um tratamento visual
// diferenciado (estrelinha âmbar) sem precisar de nada novo no backend.
const MILESTONE_PREFIX = "concluiu marco:";
const MILESTONE_META = { label: "marco", color: "var(--amber)", icon: "star" };

function isMilestoneEvent(e) {
  return e.type === "acao" && typeof e.title === "string" && e.title.startsWith(MILESTONE_PREFIX);
}

function milestoneName(e) {
  return e.title.slice(MILESTONE_PREFIX.length).trim();
}

const STATUS_LABELS = {
  aberta: "aberta",
  pendente: "pendente",
  paga: "paga",
  ativa: "ativa",
  concluida: "concluída",
};

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTH_LABELS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// ─── alertas "vencendo em breve" ────────────────────────────────────────
// janela de antecedência pra considerar algo "vencendo em breve" (dias).
const ALERT_WINDOW_DAYS = 7;

// só entram no alerta os tipos com um estado "em aberto" reconhecível.
// conta_fixa agora segue o mesmo padrão de instância mensal + status
// pendente/paga que assinatura já tinha (item 1 do mapa de problemas).
function isPendingAlertEvent(e) {
  switch (e.type) {
    case "divida":
      return e.status !== "paga";
    case "assinatura":
    case "conta_fixa":
      return e.status === "pendente";
    case "meta":
      return e.status !== "concluida";
    default:
      return false;
  }
}

// ─── estado ──────────────────────────────────────────────────────────────
let containerEl = null;
let viewYear = 0;
let viewMonth = 0; // 1-12
let selectedDate = null; // 'YYYY-MM-DD'
let eventsByDate = new Map();
let loadToken = 0;
let activeFilters = new Set(); // tipos selecionados para filtrar; vazio = todos

let resizeObserver = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthStr(year, month) {
  return `${year}-${pad2(month)}`;
}

function todayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstWeekday(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

// ─── carregamento ────────────────────────────────────────────────────────
async function loadMonth() {
  const gridEl = containerEl.querySelector("#cal-grid");
  const token = ++loadToken;
  gridEl.classList.add("loading");
  try {
    const events = await listEvents(monthStr(viewYear, viewMonth));
    if (token !== loadToken) return;
    eventsByDate = new Map();
    for (const evt of events) {
      const list = eventsByDate.get(evt.date) || [];
      list.push(evt);
      eventsByDate.set(evt.date, list);
    }
  } catch (err) {
    if (token !== loadToken) return;
    eventsByDate = new Map();
    gridEl.innerHTML = `<div class="empty-state">erro ao carregar eventos: ${escapeHtml(err.message)}</div>`;
    gridEl.classList.remove("loading");
    renderDayPanel();
    return;
  }
  gridEl.classList.remove("loading");
  renderGrid();
  renderDayPanel();
}

// ─── alertas: carregamento ────────────────────────────────────────────────
// reaproveita o mesmo GET /calendario/events já usado pra grade — só que
// sempre relativo a "hoje" (independe do mês que está sendo navegado), por
// isso busca os meses separadamente em vez de usar `eventsByDate`. O modal
// em si (render + interação) mora em modals/calendar-alerts-modal.js.
let pendingAlerts = [];

async function loadAlerts() {
  const t = todayParts();
  const windowEndDate = new Date(Date.UTC(t.year, t.month - 1, t.day + ALERT_WINDOW_DAYS));
  const windowEndStr = `${windowEndDate.getUTCFullYear()}-${pad2(windowEndDate.getUTCMonth() + 1)}-${pad2(windowEndDate.getUTCDate())}`;

  const months = new Set([
    monthStr(t.year, t.month),
    monthStr(windowEndDate.getUTCFullYear(), windowEndDate.getUTCMonth() + 1),
  ]);

  let events;
  try {
    const results = await Promise.all([...months].map((m) => listEvents(m)));
    events = results.flat();
  } catch (err) {
    pendingAlerts = [];
    renderAlertsBadge();
    return;
  }

  pendingAlerts = events
    .filter((e) => isPendingAlertEvent(e) && e.date <= windowEndStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  renderAlertsBadge();
}

function renderAlertsBadge() {
  const badgeEl = containerEl?.querySelector("#cal-alerts-badge");
  if (!badgeEl) return;
  if (pendingAlerts.length) {
    badgeEl.textContent = pendingAlerts.length > 9 ? "9+" : String(pendingAlerts.length);
    badgeEl.hidden = false;
  } else {
    badgeEl.hidden = true;
  }
}

function handleAlertsBtnClick() {
  const t = todayParts();
  const todayStr = `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
  openCalendarAlertsModal({
    alerts: pendingAlerts,
    todayStr,
    onSelect: ({ module, type, recordId }) => {
      setPendingFocus(type, recordId);
      document.querySelector(`.nav-link[data-page="${module}"]`)?.click();
    },
  });
}

// ─── render: grade do mês ───────────────────────────────────────────────
function renderGrid() {
  const gridEl = containerEl.querySelector("#cal-grid");
  const labelEl = containerEl.querySelector("#cal-month-label");
  labelEl.textContent = `${MONTH_LABELS[viewMonth - 1]} ${viewYear}`;

  const today = todayParts();
  const isCurrentMonth = today.year === viewYear && today.month === viewMonth;
  const total = daysInMonth(viewYear, viewMonth);
  const offset = firstWeekday(viewYear, viewMonth);

  let html = "";
  for (let i = 0; i < offset; i++) {
    html += `<div class="cal-day cal-day-filler"></div>`;
  }

  for (let day = 1; day <= total; day++) {
    const dateStr = `${viewYear}-${pad2(viewMonth)}-${pad2(day)}`;
    const dayEvents = eventsByDate.get(dateStr) || [];
    const isToday = isCurrentMonth && day === today.day;
    const isSelected = dateStr === selectedDate;

    // eventos de marco concluído saem do grupo "acao" comum e formam seu
    // próprio grupo, pra virarem uma estrelinha à parte na grade.
    const grouped = new Map();
    const milestoneEvts = [];
    for (const e of dayEvents) {
      if (isMilestoneEvent(e)) {
        milestoneEvts.push(e);
        continue;
      }
      if (!grouped.has(e.type)) grouped.set(e.type, []);
      grouped.get(e.type).push(e);
    }
    const chips = [...grouped.entries()]
      .map(([type, evts]) => {
        const meta = TYPE_META[type] || { ...FALLBACK_META, label: type };
        const tip = evts.length > 1 ? `${meta.label} (${evts.length})` : `${meta.label}: ${evts[0].title}`;
        return `<span class="cal-chip" style="--type-color:${meta.color}" data-tooltip="${escapeHtml(tip)}">${icon(meta.icon, { size: 9 })}</span>`;
      })
      .join("")
      + (milestoneEvts.length
        ? `<span class="cal-chip milestone" style="--type-color:${MILESTONE_META.color}" data-tooltip="${escapeHtml(
            milestoneEvts.length > 1
              ? `${milestoneEvts.length} marcos concluídos`
              : `marco concluído: ${milestoneName(milestoneEvts[0])}`
          )}">${icon(MILESTONE_META.icon, { size: 9 })}</span>`
        : "");

    html += `
      <div class="cal-day${isToday ? " today" : ""}${isSelected ? " selected" : ""}${dayEvents.length ? " has-events" : ""}" data-date="${dateStr}">
        <div class="cal-day-num">${day}</div>
        <div class="cal-day-chips">${chips}</div>
      </div>
    `;
  }

  const totalCells = offset + total;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i = 0; i < trailing; i++) {
    html += `<div class="cal-day cal-day-filler"></div>`;
  }

  gridEl.innerHTML = html;

  gridEl.querySelectorAll(".cal-day:not(.cal-day-filler)").forEach((cell) => {
    cell.addEventListener("click", () => {
      selectedDate = cell.dataset.date;
      activeFilters.clear();
      renderGrid();
      renderDayPanel();
    });
  });
}

// ─── render: painel do dia selecionado ──────────────────────────────────
function fmtSelectedDateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} de ${MONTH_LABELS[m - 1]}`;
}

function renderDayPanel() {
  const headEl = containerEl.querySelector("#cal-day-panel-head");
  const filtersEl = containerEl.querySelector("#cal-day-filters");
  const listEl = containerEl.querySelector("#cal-day-events");

  if (!selectedDate) {
    headEl.textContent = "selecione um dia";
    filtersEl.innerHTML = "";
    listEl.innerHTML = `<div class="empty-state">clique em um dia do calendário pra ver os detalhes.</div>`;
    return;
  }

  headEl.textContent = fmtSelectedDateLabel(selectedDate);
  const dayEvents = eventsByDate.get(selectedDate) || [];

  if (!dayEvents.length) {
    filtersEl.innerHTML = "";
    activeFilters.clear();
    listEl.innerHTML = `<div class="empty-state">nenhum evento nesse dia.</div>`;
    return;
  }

  // tipos presentes nesse dia
  const typesPresent = [...new Set(dayEvents.map((e) => e.type))];

  // limpa filtros de tipos que não existem mais nesse dia
  for (const f of activeFilters) {
    if (!typesPresent.includes(f)) activeFilters.delete(f);
  }

  // renderiza botões de filtro apenas quando há mais de 1 tipo
  if (typesPresent.length > 1) {
    filtersEl.innerHTML = typesPresent
      .map((type) => {
        const meta = TYPE_META[type] || { ...FALLBACK_META, label: type };
        const isActive = activeFilters.has(type);
        return `<button type="button" class="cal-filter-btn${isActive ? " active" : ""}" data-type="${escapeHtml(type)}">${typeBadge(type, 9)}${escapeHtml(meta.label)}</button>`;
      })
      .join("");

    filtersEl.querySelectorAll(".cal-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type;
        if (activeFilters.has(type)) {
          activeFilters.delete(type);
        } else {
          activeFilters.add(type);
        }
        renderDayPanel();
      });
    });
  } else {
    filtersEl.innerHTML = "";
    activeFilters.clear();
  }

  // aplica filtro ativo (vazio = exibe todos)
  const visibleEvents = activeFilters.size
    ? dayEvents.filter((e) => activeFilters.has(e.type))
    : dayEvents;

  if (!visibleEvents.length) {
    listEl.innerHTML = `<div class="empty-state">nenhum evento para o filtro selecionado.</div>`;
    return;
  }

  listEl.innerHTML = visibleEvents
    .map((e) => {
      const milestone = isMilestoneEvent(e);
      const meta = milestone ? MILESTONE_META : (TYPE_META[e.type] || { ...FALLBACK_META, label: e.type });
      const title = milestone ? milestoneName(e) : e.title;
      const statusHtml = e.status
        ? `<span class="cal-event-status">${escapeHtml(STATUS_LABELS[e.status] || e.status)}</span>`
        : "";
      const amountHtml = e.amount != null ? `<span class="cal-event-amount">${fmtMoney(e.amount)}</span>` : "";
      const xpHtml = e.xp != null ? `<span class="cal-event-xp">+${e.xp} xp</span>` : "";
      const categoriesHtml = e.categories?.length
        ? `<div class="cal-event-categories">${e.categories.map((c) => `<span class="cal-event-category-tag">${escapeHtml(c)}</span>`).join("")}</div>`
        : "";
      // e.id vem como "tipo:id_do_registro" ou "tipo:id_do_registro:mes"
      // (conta_fixa/assinatura/parcela têm o mês grudado pra ficarem
      // únicos por mês — o id real do registro é sempre o 2º pedaço).
      const recordId = e.id.split(":")[1] || "";
      return `
        <div class="cal-event-row" data-module="${escapeHtml(e.module)}" data-type="${escapeHtml(e.type)}" data-record-id="${escapeHtml(recordId)}">
          <div class="cal-event-row-main">
            <span class="cal-event-dot${milestone ? " milestone" : ""}" style="--type-color:${meta.color}">${icon(meta.icon, { size: 11 })}</span>
            <span class="cal-event-type">${escapeHtml(meta.label)}</span>
            <span class="cal-event-title">${escapeHtml(title)}</span>
            ${statusHtml}
            ${amountHtml}
            ${xpHtml}
          </div>
          ${categoriesHtml}
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".cal-event-row").forEach((row) => {
    row.addEventListener("click", () => {
      const page = row.dataset.module;
      if (!page) return;
      const { type, recordId } = row.dataset;
      if (type && recordId) setPendingFocus(type, recordId);
      document.querySelector(`.nav-link[data-page="${page}"]`)?.click();
    });
  });
}

// ─── navegação de mês ────────────────────────────────────────────────────
function goToMonth(year, month) {
  viewYear = year;
  viewMonth = month;
  loadMonth();
}

function shiftMonth(delta) {
  let month = viewMonth + delta;
  let year = viewYear;
  if (month > 12) {
    month = 1;
    year += 1;
  } else if (month < 1) {
    month = 12;
    year -= 1;
  }
  selectedDate = null;
  activeFilters.clear();
  goToMonth(year, month);
}

function goToToday() {
  const t = todayParts();
  selectedDate = `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
  goToMonth(t.year, t.month);
}

// ─── legenda ─────────────────────────────────────────────────────────────
function renderLegend() {
  const typeItems = Object.entries(TYPE_META)
    .map(([type, m]) => `<span class="cal-legend-item">${typeBadge(type, 9)}${escapeHtml(m.label)}</span>`)
    .join("");
  // marco não é um "tipo" próprio (é uma "acao" com description prefixada,
  // ver isMilestoneEvent), então não vem do TYPE_META — entra à parte aqui
  // só pra deixar a estrelinha documentada na legenda.
  const milestoneItem = `<span class="cal-legend-item"><span class="cal-chip milestone" style="--type-color:${MILESTONE_META.color}">${icon(MILESTONE_META.icon, { size: 9 })}</span>${escapeHtml(MILESTONE_META.label)}</span>`;
  return typeItems + milestoneItem;
}

// ─── montagem / desmontagem ──────────────────────────────────────────────
export async function mount(container) {
  containerEl = container;
  const t = todayParts();
  viewYear = t.year;
  viewMonth = t.month;
  selectedDate = `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;

  container.innerHTML = `
    <div class="cal-toolbar">
      <div class="cal-nav">
        <button type="button" class="btn icon-btn-square" id="cal-prev" data-tooltip="mês anterior">${icon("arrow-left", { size: 13 })}</button>
        <div class="cal-month-label" id="cal-month-label"></div>
        <button type="button" class="btn icon-btn-square" id="cal-next" data-tooltip="próximo mês">${icon("arrow-right", { size: 13 })}</button>
      </div>
      <div class="cal-toolbar-actions">
        <button type="button" class="btn icon-btn-square" id="cal-alerts-btn" data-tooltip="vencendo em breve">
          ${icon("bell", { size: 13 })}
          <span class="cal-alerts-badge" id="cal-alerts-badge" hidden></span>
        </button>
        <button type="button" class="btn sm" id="cal-today-btn">hoje</button>
      </div>
    </div>

    <div class="cal-body">
      <div class="cal-grid-wrap">
        <div class="cal-weekdays">
          ${WEEKDAY_LABELS.map((w) => `<div>${w}</div>`).join("")}
        </div>
        <div class="cal-grid" id="cal-grid"></div>
      </div>

      <div class="cal-day-panel">
        <div class="card-head" id="cal-day-panel-head">selecione um dia</div>
        <div class="cal-day-filters" id="cal-day-filters"></div>
        <div class="cal-day-events" id="cal-day-events"></div>
      </div>
    </div>

    <div class="cal-legend">${renderLegend()}</div>
  `;

  container.querySelector("#cal-prev").addEventListener("click", () => shiftMonth(-1));
  container.querySelector("#cal-next").addEventListener("click", () => shiftMonth(1));
  container.querySelector("#cal-today-btn").addEventListener("click", goToToday);
  container.querySelector("#cal-alerts-btn").addEventListener("click", handleAlertsBtnClick);

  await Promise.all([loadMonth(), loadAlerts()]);
}

export function unmount() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  containerEl = null;
  eventsByDate = new Map();
  selectedDate = null;
  activeFilters.clear();
  pendingAlerts = [];
  loadToken++;
}
