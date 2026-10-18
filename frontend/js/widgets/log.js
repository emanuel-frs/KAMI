// js/widgets/log.js
import { deleteAction, getLog } from "../api/nucleo.js";
import { icon } from "../components/icons.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { escapeHtml, fmtRelDate } from "../components/format.js";
import { enhanceSelect } from "../components/custom-select.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { listenWhileConnected } from "../components/window-listener.js";

/** Log cronológico — escuta filtro de attributes.js e refresh de registrar.js. */
export async function render(el, widget) {
  el.innerHTML = `
    <div class="field-row" style="margin-bottom:8px;">
      <div class="field">
        <label for="log-period">período</label>
        <select class="log-period" id="log-period">
          <option value="all">tudo</option>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="90">90 dias</option>
        </select>
      </div>
      <div class="field">
        <label>filtro</label>
        <span class="log-filter-label" style="display:block; font-size:12px; color:var(--text-bright); padding:6px 0;">todos</span>
      </div>
    </div>
    <div class="log-list log-list--recent"></div>
  `;

  const listEl = el.querySelector(".log-list");
  const periodEl = el.querySelector(".log-period");
  const filterLabelEl = el.querySelector(".log-filter-label");

  enhanceSelect(periodEl);

  let currentAttribute = "all";
  let currentPeriod = "all";

  async function load() {
    listEl.innerHTML = '<div class="empty-state">carregando…</div>';
    let entries;
    try {
      const params = {};
      if (currentPeriod !== "all") params.period_days = currentPeriod;
      if (currentAttribute !== "all") params.attribute = currentAttribute;
      entries = await getLog(params);
    } catch (err) {
      listEl.innerHTML = `<div class="empty-state">erro ao carregar log: ${escapeHtml(err.message)}</div>`;
      return;
    }
    const focusId = consumePendingFocus("acao");
    if (!entries.length) {
      listEl.innerHTML = '<div class="empty-state">nada por aqui nesse filtro/período.</div>';
      return;
    }
    listEl.innerHTML = entries
      .map(
        (l) => `
      <div class="log-item" data-id="${l.id}">
        <span class="desc">${escapeHtml(l.description)}</span>
        <span class="meta">${fmtRelDate(l.created_at)}</span>
        <span class="tag">+${l.xp_gained}xp</span>
        ${l.source === "form"
          ? `<button type="button" class="icon-btn danger" data-delete-action="${escapeHtml(l.id)}" data-tooltip="apagar ação" aria-label="apagar ação">${icon("trash-2", { size: 10 })}</button>`
          : `<span class="log-action-slot" aria-hidden="true"></span>`}
      </div>`
      )
      .join("");

    if (focusId) focusRow(listEl.querySelector(`[data-id="${focusId}"]`), "acao");

    // CONF-07: só ações registradas à mão — as automáticas (lançamento,
    // marco, pagamento...) se desfazem na origem, que estorna o xp junto
    listEl.querySelectorAll("[data-delete-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const entry = entries.find((x) => x.id === btn.dataset.deleteAction);
        if (!entry) return;
        const ok = await showConfirmModal(
          `apagar "${entry.description}"? os ${entry.xp_gained} de xp dessa ação saem.`,
          { title: "apagar ação", confirmText: "apagar", danger: true },
        );
        if (!ok) return;
        try {
          await deleteAction(entry.id);
        } catch (err) {
          showErrorModal(err.message, "erro ao apagar");
          return;
        }
        load();
      });
    });
  }

  periodEl.addEventListener("change", () => {
    currentPeriod = periodEl.value;
    load();
  });

  listenWhileConnected(el, "kami:nucleo-filter", (e) => {
    currentAttribute = e.detail.attribute;
    filterLabelEl.textContent = currentAttribute === "all" ? "todos" : currentAttribute;
    load();
  });

  listenWhileConnected(el, "kami:action-registered", load);

  load();
}