import * as financasApi from "../api/financas.js";
import { escapeHtml, fmtMoeda, mesesCurtos } from "../components/format.js";
import { icon } from "../components/icons.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { t } from "../i18n.js";

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const nomes = mesesCurtos();
  return `${nomes[m - 1]} ${y}`;
}
function brl(v) {
  return fmtMoeda(v);
}

export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("graf.carregando_categorias")}</div>`;
  let month = currentMonthStr();

  async function reload() {
    let summary;
    try {
      summary = await financasApi.getSummary(month);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("graf.erro_categorias", { erro: err.message }))}</div>`;
      return;
    }
    draw(summary.top_categories || []);
  }

  function draw(categories) {
    const max = Math.max(1, ...categories.map((c) => c.total));
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <div class="month-nav">
          <button type="button" class="btn sm" data-action="prev-month">${icon("arrow-left", { size: 11 })}</button>
          <span class="month-label">${monthLabel(month)}</span>
          <button type="button" class="btn sm" data-action="next-month">${icon("arrow-right", { size: 11 })}</button>
        </div>
      </div>
      <div class="chart-categorias-list">
        ${categories.length ? categories.map((c) => `
          <div class="cat-row">
            <div class="cat-top">
              <span class="cat-label" data-tooltip="${escapeHtml(c.category)}">${escapeHtml(c.category)}</span>
              <span class="cat-valor">${brl(c.total)}</span>
            </div>
            <div class="cat-bar-track"><div class="bar-fill" style="width:${((c.total / max) * 100).toFixed(1)}%;"></div></div>
          </div>`).join("") : `<div class="wallet-empty">${t("graf.sem_gasto", { mes: monthLabel(month) })}</div>`}
      </div>
    `;

    el.querySelector('[data-action="prev-month"]').addEventListener("click", () => { month = shiftMonth(month, -1); reload(); });
    el.querySelector('[data-action="next-month"]').addEventListener("click", () => { month = shiftMonth(month, 1); reload(); });
  }

  await reload();
  listenWhileConnected(el, "kami:wallet-changed", reload);
}