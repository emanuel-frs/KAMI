import { escapeHtml, fmtMoney } from "../components/format.js";
import { icon } from "../components/icons.js";
import { TYPE_META } from "../components/event-types.js";

/** Modal "vencendo em breve" do Calendário — mesmo padrão singleton de
 * debt-modal.js/subscription-modal.js, só que read-only (sem form): lista
 * os eventos pendentes já calculados por pages/calendario.js e delega a
 * navegação de volta pra quem abriu, via callback `onSelect`. */

const FALLBACK_META = { label: "", color: "var(--text-faint)", icon: "circle-help" };

let modalEl = null;
let onSelectCb = null;

function daysDiff(dateStr, todayStr) {
  const a = new Date(`${dateStr}T00:00:00Z`);
  const b = new Date(`${todayStr}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "cal-alerts-modal";
  wrap.innerHTML = `
    <div class="modal narrow">
      <div class="modal-head">${icon("bell", { size: 13 })}&nbsp;vencendo em breve <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="cal-alerts-list" id="cal-alerts-modal-list"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeCalendarAlertsModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeCalendarAlertsModal(); });
  return wrap;
}

export function closeCalendarAlertsModal() {
  modalEl?.classList.remove("open");
}

/** @param {{ alerts: Array, todayStr: string, onSelect: (info: {module: string, type: string, recordId: string}) => void }} opts */
export function openCalendarAlertsModal({ alerts, todayStr, onSelect } = {}) {
  modalEl = modalEl || buildModal();
  onSelectCb = onSelect;

  const listEl = modalEl.querySelector("#cal-alerts-modal-list");

  if (!alerts?.length) {
    listEl.innerHTML = `<div class="empty-state">nada vencendo nos próximos dias.</div>`;
  } else {
    listEl.innerHTML = alerts
      .map((e) => {
        const meta = TYPE_META[e.type] || { ...FALLBACK_META, label: e.type };
        const diff = daysDiff(e.date, todayStr);
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
        closeCalendarAlertsModal();
        if (module && type && recordId) onSelectCb?.({ module, type, recordId });
      });
    });
  }

  modalEl.classList.add("open");
}
