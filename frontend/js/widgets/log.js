// js/widgets/log.js
import { getLog } from "../api/nucleo.js";
import { escapeHtml, fmtRelDate } from "./format.js";

/** Log cronológico — escuta filtro de attributes.js e refresh de registrar.js. */
export async function render(el, widget) {
  el.innerHTML = `
    <div class="field-row" style="margin-bottom:8px;">
      <div class="field">
        <label>período</label>
        <select class="log-period">
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
    <div class="log-list"></div>
  `;

  const listEl = el.querySelector(".log-list");
  const periodEl = el.querySelector(".log-period");
  const filterLabelEl = el.querySelector(".log-filter-label");

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
      listEl.innerHTML = `<div class="empty-state">erro ao carregar log: ${err.message}</div>`;
      return;
    }
    if (!entries.length) {
      listEl.innerHTML = '<div class="empty-state">nada por aqui nesse filtro/período.</div>';
      return;
    }
    listEl.innerHTML = entries
      .map(
        (l) => `
      <div class="log-item">
        <span class="desc">${escapeHtml(l.description)}</span>
        <span class="meta">${fmtRelDate(l.created_at)}</span>
        <span class="tag">+${l.xp_gained}xp</span>
      </div>`
      )
      .join("");
  }

  periodEl.addEventListener("change", () => {
    currentPeriod = periodEl.value;
    load();
  });

  window.addEventListener("kami:nucleo-filter", (e) => {
    currentAttribute = e.detail.attribute;
    filterLabelEl.textContent = currentAttribute === "all" ? "todos" : currentAttribute;
    load();
  });

  window.addEventListener("kami:action-registered", load);

  load();
}