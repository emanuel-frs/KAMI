import * as financasApi from "../api/financas.js";

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthAbbrev(monthStr) {
  const [, m] = monthStr.split("-").map(Number);
  return ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][m - 1];
}
function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const MESES_JANELA = 6;
const W = 600;
const H = 150;

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando fluxo…</div>';

  async function reload() {
    const currentMonth = currentMonthStr();
    const months = [];
    for (let i = MESES_JANELA - 1; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));

    let data;
    try {
      data = await Promise.all(months.map((m) => financasApi.getSummary(m)));
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar gráfico: ${err.message}</div>`;
      return;
    }
    draw(months, data);
  }

  function draw(months, data) {
    const maxValue = Math.max(1, ...data.flatMap((d) => [d.total_in, d.total_out]));
    const barGroupW = W / data.length;
    const barW = barGroupW * 0.28;
    const gap = barGroupW * 0.08;

    const bars = data.map((d, i) => {
      const groupX = i * barGroupW;
      const hIn = (d.total_in / maxValue) * H;
      const hOut = (d.total_out / maxValue) * H;
      const xIn = groupX + barGroupW * 0.5 - barW - gap / 2;
      const xOut = groupX + barGroupW * 0.5 + gap / 2;
      return `
        <rect x="${xIn.toFixed(1)}" y="${(H - hIn).toFixed(1)}" width="${barW.toFixed(1)}" height="${hIn.toFixed(1)}" class="cf-bar entrada"><title>${monthAbbrev(months[i])}: entrada ${brl(d.total_in)}</title></rect>
        <rect x="${xOut.toFixed(1)}" y="${(H - hOut).toFixed(1)}" width="${barW.toFixed(1)}" height="${hOut.toFixed(1)}" class="cf-bar saida"><title>${monthAbbrev(months[i])}: saída ${brl(d.total_out)}</title></rect>
      `;
    }).join("");

    const gridLines = [0.25, 0.5, 0.75].map(
      (f) => `<line x1="0" y1="${(H * (1 - f)).toFixed(1)}" x2="${W}" y2="${(H * (1 - f)).toFixed(1)}" class="chart-grid-line" />`
    ).join("");

    el.innerHTML = `
      <div class="chart-fluxo-wrap">
        <div class="chart-legend">
          <span class="legend-item"><span class="legend-dot entrada"></span>entrada</span>
          <span class="legend-item"><span class="legend-dot saida"></span>saída</span>
        </div>
        <div class="chart-fluxo">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg">
          ${gridLines}
          ${bars}
        </svg>
        <div class="chart-fluxo-labels">
          ${months.map((m) => `<span>${monthAbbrev(m)}</span>`).join("")}
        </div>
        </div>
      </div>
    `;
  }

  await reload();
  window.addEventListener("kami:wallet-changed", reload);
}