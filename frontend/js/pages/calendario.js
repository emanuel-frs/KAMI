import { listEvents, rescheduleEvento, deleteEvento } from "../api/calendario.js";
import { escapeHtml, fmtMoney } from "../components/format.js";
import { icon } from "../components/icons.js";
import { setPendingFocus } from "../components/pending-focus.js";
import { TYPE_META } from "../components/event-types.js";
import { openCalendarioEventoModal } from "../modals/calendario-evento-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { store } from "../state/store.js";
import { maybeStartCalendarioTips, replayCalendarioTips } from "./calendario-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";
import { announce } from "../components/a11y.js";
import { registerScreenShortcuts, clearScreenShortcuts } from "../components/shortcuts.js";

const FALLBACK_META = { label: "", color: "var(--text-faint)", icon: "circle-help" };

/** Badge colorido (cor do tipo) com o ícone SVG do tipo dentro — reaproveitado
 * na grade do mês, no filtro do dia, na lista de eventos e na legenda, só
 * variando o tamanho do ícone via `size`. */
function typeBadge(type, size = 14) {
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

// eventos manuais ("evento") têm id agregado "evento:{id_real}:{data}"
// (ver _evento_events em app/routers/calendario.py — o mês sozinho não
// basta pra ser único quando a recorrência gera várias ocorrências no
// mesmo mês). O objeto cru esperado pelo modal (calendario-evento-modal.js)
// usa o id real, sem o pedaço de data.
function isEventoEvent(e) {
  return e.type === "evento";
}

function eventoRecordId(e) {
  return e.id.split(":")[1] || "";
}

function toEventoRecord(e) {
  return {
    id: eventoRecordId(e),
    title: e.title,
    date: e.date,
    time: e.time,
    notes: e.notes,
    recurrence: e.recurrence,
    recurrence_end: e.recurrence_end,
    reminder_minutes_before: e.reminder_minutes_before,
  };
}

const STATUS_LABELS = {
  aberta: "aberta",
  pendente: "pendente",
  paga: "paga",
  ativa: "ativa",
  concluida: "concluída",
};

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const WEEKDAY_LONG_LABELS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MONTH_LABELS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// ─── estado ──────────────────────────────────────────────────────────────
let containerEl = null;
let shortcutsToken = null;
let viewYear = 0;
let viewMonth = 0; // 1-12
let selectedDate = null; // 'YYYY-MM-DD'
let eventsByDate = new Map();
let loadToken = 0;
let activeFilters = new Set(); // tipos selecionados para filtrar; vazio = todos

let resizeObserver = null;
let unsubscribeProfile = null;
let currentReplayFn = null;
let focusedDate = null; // "cursor" da grade, independente do dia selecionado (setas movem isto)
let wantsGridFocus = false; // true quando a navegação por teclado disparou o redesenho (setas/PageUp/PageDown)

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

// ─── eventos manuais: criar/editar ────────────────────────────────────────
function handleNewEventClick() {
  openCalendarioEventoModal({
    date: selectedDate || undefined,
    onSaved: async () => {
      await loadMonth();
    },
  });
}

function handleEditEventoClick(evtRow) {
  openCalendarioEventoModal({
    event: toEventoRecord(evtRow),
    onSaved: async () => {
      await loadMonth();
    },
    onDeleted: async () => {
      await loadMonth();
    },
  });
}

// ─── eventos manuais: reagendar via drag-and-drop ─────────────────────────
async function handleEventoDrop(eventoId, newDate) {
  if (!eventoId) return;
  try {
    await rescheduleEvento(eventoId, newDate);
  } catch (err) {
    showErrorModal(err.message, "erro ao reagendar evento");
    return;
  }
  await loadMonth();
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
        return `<span class="cal-chip" style="--type-color:${meta.color}" data-tooltip="${escapeHtml(tip)}">${icon(meta.icon, { size: 14 })}</span>`;
      })
      .join("")
      + (milestoneEvts.length
        ? `<span class="cal-chip milestone" style="--type-color:${MILESTONE_META.color}" data-tooltip="${escapeHtml(
            milestoneEvts.length > 1
              ? `${milestoneEvts.length} marcos concluídos`
              : `marco concluído: ${milestoneName(milestoneEvts[0])}`
          )}">${icon(MILESTONE_META.icon, { size: 14 })}</span>`
        : "");

    const dow = new Date(Date.UTC(viewYear, viewMonth - 1, day)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;

    const dow2 = new Date(Date.UTC(viewYear, viewMonth - 1, day)).getUTCDay();
    const ariaLabel = `${WEEKDAY_LONG_LABELS[dow2]}, ${day} de ${MONTH_LABELS[viewMonth - 1]}` +
      (isToday ? " — hoje" : "") +
      (dayEvents.length ? `, ${dayEvents.length} evento${dayEvents.length === 1 ? "" : "s"}` : ", sem eventos");
    html += `
      <div class="cal-day${isToday ? " today" : ""}${isSelected ? " selected" : ""}${dayEvents.length ? " has-events" : ""}${isWeekend ? " weekend" : ""}" data-date="${dateStr}"
        role="button" tabindex="-1" aria-label="${escapeHtml(ariaLabel)}"${isToday ? ' aria-current="date"' : ""}>
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
  updateGridRovingTabindex();

  // depois de um redesenho disparado pela navegação por teclado (setas,
  // PageUp/PageDown, Home/End), o foco some com o innerHTML — devolve pro
  // dia que virou o "cursor" da grade. Cliques e outros redesenhos não
  // mexem no foco (senão selecionar com o mouse puxaria o foco de volta
  // pra grade sem o usuário ter pedido).
  if (wantsGridFocus) {
    wantsGridFocus = false;
    gridEl.querySelector(`[data-date="${focusedDate}"]`)?.focus();
  }

  gridEl.querySelectorAll(".cal-day:not(.cal-day-filler)").forEach((cell) => {
    cell.addEventListener("click", () => {
      selectedDate = cell.dataset.date;
      focusedDate = cell.dataset.date;
      activeFilters.clear();
      renderGrid();
      renderDayPanel();
    });

    // alvo de drop pra reagendar um evento manual arrastado do painel
    // do dia (ver dragstart em renderDayPanel) — só reage a algo sendo
    // arrastado de verdade (classList "drag-over" só entra via dragenter).
    cell.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
    });
    cell.addEventListener("dragenter", () => cell.classList.add("drag-over"));
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (ev) => {
      ev.preventDefault();
      cell.classList.remove("drag-over");
      const eventoId = ev.dataTransfer.getData("text/plain");
      const newDate = cell.dataset.date;
      if (eventoId && newDate) handleEventoDrop(eventoId, newDate);
    });
  });
}

// ─── grade: cursor de teclado (roving tabindex + setas) ─────────────────
// Só o dia "focado no momento" (focusedDate, se estiver visível — senão o
// selecionado, senão hoje, senão o dia 1) entra na ordem de Tab; os outros
// ~34 ficam com tabindex="-1" e são alcançados pelas setas. Sem isso, tabular
// até o painel do dia custaria uma volta por cada célula da grade.
function updateGridRovingTabindex() {
  const gridEl = containerEl?.querySelector("#cal-grid");
  if (!gridEl) return;
  const cells = [...gridEl.querySelectorAll(".cal-day:not(.cal-day-filler)")];
  if (!cells.length) return;
  const wanted =
    cells.find((c) => c.dataset.date === focusedDate) ||
    cells.find((c) => c.dataset.date === selectedDate) ||
    cells.find((c) => c.classList.contains("today")) ||
    cells[0];
  cells.forEach((c) => (c.tabIndex = c === wanted ? 0 : -1));
}

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

function addDays(dateStr, delta) {
  const { y, m, d } = parseDateStr(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Move o cursor por dias (setas) ou meses (PageUp/PageDown), cruzando de
 * mês quando preciso — troca de mês recarrega os eventos (loadMonth), então
 * o foco só volta depois que a grade nova terminar de desenhar (ver
 * `wantsGridFocus` em renderGrid). Mover dentro do mesmo mês não recarrega
 * nada: só troca o "cursor" e foca a célula, sem redesenhar a grade. */
function moveGridCursor(newDate) {
  const { y, m } = parseDateStr(newDate);
  focusedDate = newDate;
  if (y === viewYear && m === viewMonth) {
    updateGridRovingTabindex();
    containerEl.querySelector(`#cal-grid [data-date="${newDate}"]`)?.focus();
    return;
  }
  wantsGridFocus = true;
  viewYear = y;
  viewMonth = m;
  loadMonth();
}

function onGridKeydown(e) {
  const cell = e.target.closest(".cal-day:not(.cal-day-filler)");
  if (!cell) return;
  const date = cell.dataset.date;
  const DELTA = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (e.key in DELTA) {
    e.preventDefault();
    moveGridCursor(addDays(date, DELTA[e.key]));
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    const { y, m, d } = parseDateStr(date);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo … 6=sábado, mesma base da grade
    moveGridCursor(addDays(date, e.key === "Home" ? -dow : 6 - dow));
  } else if (e.key === "PageUp" || e.key === "PageDown") {
    e.preventDefault();
    const { y, m, d } = parseDateStr(date);
    const dir = e.key === "PageUp" ? -1 : 1;
    let ny = y, nm = m + dir;
    if (nm > 12) { nm = 1; ny += 1; } else if (nm < 1) { nm = 12; ny -= 1; }
    const clampedDay = Math.min(d, daysInMonth(ny, nm));
    moveGridCursor(`${ny}-${pad2(nm)}-${pad2(clampedDay)}`);
  } else if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
    e.preventDefault();
    selectedDate = date;
    focusedDate = date;
    wantsGridFocus = true; // Enter/Espaço só troca a seleção — o cursor tem que continuar na grade
    renderGrid();
    renderDayPanel();
  }
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
  // quem está no teclado tem o foco na grade, não no painel — sem isso não
  // saberia que o painel ao lado mudou de conteúdo até tabular até lá.
  announce(`${fmtSelectedDateLabel(selectedDate)}: ${dayEvents.length ? `${dayEvents.length} evento${dayEvents.length === 1 ? "" : "s"}` : "nenhum evento"}.`);

  if (!dayEvents.length) {
    filtersEl.innerHTML = "";
    activeFilters.clear();
    listEl.innerHTML = `
      <div class="empty-state">nenhum evento nesse dia.</div>
      <button type="button" class="btn sm cal-day-quick-add" id="cal-day-quick-add">${icon("plus", { size: 11 })}&nbsp;adicionar evento</button>
    `;
    listEl.querySelector("#cal-day-quick-add").addEventListener("click", handleNewEventClick);
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
        return `<button type="button" class="cal-filter-btn${isActive ? " active" : ""}" data-type="${escapeHtml(type)}">${typeBadge(type, 14)}${escapeHtml(meta.label)}</button>`;
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
      const recordId = e.id.split(":")[1] || "";
      const draggableAttr = isEventoEvent(e) ? ` draggable="true" data-evento-id="${escapeHtml(recordId)}"` : "";
      return `
        <div class="cal-event-row${isEventoEvent(e) ? " cal-event-row-evento" : ""}" data-module="${escapeHtml(e.module)}" data-type="${escapeHtml(e.type)}" data-record-id="${escapeHtml(recordId)}"${draggableAttr}>
          <div class="cal-event-row-main">
            <span class="cal-event-dot${milestone ? " milestone" : ""}" style="--type-color:${meta.color}">${icon(meta.icon, { size: 20 })}</span>
            <span class="cal-event-type">${escapeHtml(meta.label)}</span>
            ${e.time ? `<span class="cal-event-time">${icon("clock", { size: 10 })}${escapeHtml(e.time)}</span>` : ""}
            <span class="cal-event-title" data-tooltip="${escapeHtml(title)}">${escapeHtml(title)}</span>
            ${statusHtml}
            ${amountHtml}
            ${xpHtml}
            ${isEventoEvent(e) ? `<span class="cal-event-edit-hint">${icon("pencil", { size: 10 })}</span>` : ""}
          </div>
          ${categoriesHtml}
          ${isEventoEvent(e) && e.notes ? `<div class="cal-event-notes">${escapeHtml(e.notes)}</div>` : ""}
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".cal-event-row").forEach((row) => {
    row.addEventListener("click", () => {
      const { type, recordId } = row.dataset;
      if (type === "evento") {
        const evtRow = dayEvents.find((e) => e.type === "evento" && eventoRecordId(e) === recordId);
        if (evtRow) handleEditEventoClick(evtRow);
        return;
      }
      const page = row.dataset.module;
      if (!page) return;
      if (type && recordId) setPendingFocus(type, recordId);
      document.querySelector(`.nav-link[data-page="${page}"]`)?.click();
    });

    // eventos manuais são arrastáveis pra outro dia da grade (drop
    // tratado no listener "drop" dentro de renderGrid, que chama
    // handleEventoDrop) — os demais tipos (conta_fixa, dívida, meta...)
    // pertencem a outros módulos, então reagendar por aqui não faria
    // sentido, só o "evento" tem essa liberdade.
    if (row.draggable) {
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", row.dataset.eventoId);
        ev.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
    }
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
  focusedDate = `${year}-${pad2(month)}-01`;
  activeFilters.clear();
  goToMonth(year, month);
}

function goToToday() {
  const t = todayParts();
  selectedDate = `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
  focusedDate = selectedDate;
  goToMonth(t.year, t.month);
}

// ─── legenda ─────────────────────────────────────────────────────────────
function renderLegend() {
  const typeItems = Object.entries(TYPE_META)
    .map(([type, m]) => `<span class="cal-legend-item">${typeBadge(type, 14)}${escapeHtml(m.label)}</span>`)
    .join("");
  const milestoneItem = `<span class="cal-legend-item"><span class="cal-chip milestone" style="--type-color:${MILESTONE_META.color}">${icon(MILESTONE_META.icon, { size: 14 })}</span>${escapeHtml(MILESTONE_META.label)}</span>`;
  return typeItems + milestoneItem;
}

// ─── montagem / desmontagem ──────────────────────────────────────────────
export async function mount(container) {
  containerEl = container;

  // Registrado ANTES do innerHTML/primeiro await, mesmo motivo do
  // dashboard.js: as ações não dependem de nada assíncrono (chamam
  // handleNewEventClick/goToToday direto, que por sua vez buscam os
  // elementos quando rodam, não agora), então não precisa de `when`.
  shortcutsToken = registerScreenShortcuts({
    name: "calendário",
    actions: [
      // "N" de "novo", mesma tecla de "nova trilha"/"novo widget" nas
      // outras telas (aprendizado.js, dashboard.js).
      { code: "KeyN", label: "novo evento", run: () => handleNewEventClick() },
      // "T" de "today/hoje" — pula pro mês/dia atual sem PageUp/PageDown repetido.
      { code: "KeyT", label: "ir para hoje", run: () => goToToday() },
    ],
    hints: [
      { combos: [["←"], ["→"], ["↑"], ["↓"]], label: "na grade: mover o cursor entre os dias" },
      { combos: [["Home"], ["End"]], label: "na grade: ir ao primeiro/último dia da semana" },
      { combos: [["Page Up"], ["Page Down"]], label: "na grade: mês anterior/próximo" },
      { combos: [["Enter"], ["Espaço"]], label: "na grade: selecionar o dia focado" },
    ],
  });

  const t = todayParts();
  viewYear = t.year;
  viewMonth = t.month;
  selectedDate = `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
  focusedDate = selectedDate;

  container.innerHTML = `
    <div class="cal-toolbar">
      <div class="cal-nav">
        <button type="button" class="btn icon-btn-square" id="cal-prev" data-tooltip="mês anterior">${icon("arrow-left", { size: 13 })}</button>
        <div class="cal-month-label" id="cal-month-label"></div>
        <button type="button" class="btn icon-btn-square" id="cal-next" data-tooltip="próximo mês">${icon("arrow-right", { size: 13 })}</button>
      </div>
      <div class="cal-toolbar-actions">
        <button type="button" class="btn sm" id="cal-new-event-btn">${icon("plus", { size: 12 })}&nbsp;novo evento</button>
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
  container.querySelector("#cal-new-event-btn").addEventListener("click", handleNewEventClick);
  container.querySelector("#cal-grid").addEventListener("keydown", onGridKeydown);

  await loadMonth();

  maybeStartCalendarioTips();
  unsubscribeProfile = store.subscribe("profile", () => maybeStartCalendarioTips());

  // etapa 6: expõe o replay pro botão de ajuda global (screen-tips-registry.js)
  currentReplayFn = () => replayCalendarioTips();
  registerScreenTipsReplay(currentReplayFn);
}

export function unmount() {
  cancelActiveTipSequence();
  clearScreenShortcuts(shortcutsToken);
  shortcutsToken = null;
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  if (currentReplayFn) clearScreenTipsReplay(currentReplayFn);
  currentReplayFn = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  containerEl = null;
  eventsByDate = new Map();
  selectedDate = null;
  activeFilters.clear();
  loadToken++;
}