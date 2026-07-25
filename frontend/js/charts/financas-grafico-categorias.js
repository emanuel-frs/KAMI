import * as financasApi from "../api/financas.js";
import { escapeHtml } from "../components/format.js";

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
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[m - 1]} ${y}`;
}
function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando categorias…</div>';
  let month = currentMonthStr();

  async function reload() {
    let summary;
    try {
      summary = await financasApi.getSummary(month);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar categorias: ${err.message}</div>`;
      return;
    }
    draw(summary.top_categories || []);
  }

  function draw(categories) {
    const max = Math.max(1, ...categories.map((c) => c.total));
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <div class="month-nav">
          <button type="button" class="btn sm" data-action="prev-month">‹</button>
          <span class="month-label">${monthLabel(month)}</span>
          <button type="button" class="btn sm" data-action="next-month">›</button>
        </div>
      </div>
      <div class="chart-categorias-list">
        ${categories.length ? categories.map((c) => `
          <div class="cat-row">
            <span class="cat-label">${escapeHtml(c.category)}</span>
            <div class="cat-bar-track"><div class="bar-fill" style="width:${((c.total / max) * 100).toFixed(1)}%;"></div></div>
            <span class="cat-valor">${brl(c.total)}</span>
          </div>`).join("") : `<div class="wallet-empty">nenhum gasto em ${monthLabel(month)}.</div>`}
      </div>
    `;

    el.querySelector('[data-action="prev-month"]').addEventListener("click", () => { month = shiftMonth(month, -1); reload(); });
    el.querySelector('[data-action="next-month"]').addEventListener("click", () => { month = shiftMonth(month, 1); reload(); });
  }

  await reload();
  window.addEventListener("kami:wallet-changed", reload);
}