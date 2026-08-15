import * as financasApi from "../api/financas.js";
import { attachChartTooltip } from "./chart-tooltip.js";

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
function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const MESES_JANELA = 6;
const W = 600;
const H = 150;

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando evolução…</div>';

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
    // acumulado — aproximação da tendência de patrimônio (soma de
    // entrada−saída mês a mês), não é o saldo exato de cada conta.
    let running = 0;
    const points = data.map((d) => (running += d.saldo));

    const minV = Math.min(0, ...points);
    const maxV = Math.max(0, ...points);
    const range = Math.max(1, maxV - minV);
    const stepX = W / (points.length - 1 || 1);

    const coords = points.map((v, i) => [i * stepX, H - ((v - minV) / range) * H]);
    const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${H} L0,${H} Z`;
    const zeroY = H - ((0 - minV) / range) * H;

    const dots = coords.map(([x, y], i) => {
      const tip = escapeAttr(`${monthAbbrev(months[i])}: ${brl(points[i])}`);
      // duas circles sobrepostas: a visível (raio pequeno, só pra manter o
      // desenho fino da linha) e uma invisível bem maior por cima, que é
      // quem realmente recebe o hover — com o widget pequeno, um raio de
      // 3 no viewBox vira poucos pixels reais na tela e fica quase
      // impossível de acertar o mouse nela (ver feedback).
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="chart-dot" data-tip="${tip}"></circle>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" class="chart-dot-hit" data-tip="${tip}"></circle>`;
    }).join("");

    el.innerHTML = `
      <div class="chart-evolucao">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg">
          <line x1="0" y1="${zeroY.toFixed(1)}" x2="${W}" y2="${zeroY.toFixed(1)}" class="chart-grid-line" />
          <path d="${areaPath}" class="chart-area" />
          <path d="${linePath}" class="chart-line" />
          ${dots}
        </svg>
        <div class="chart-fluxo-labels">
          ${months.map((m) => `<span>${monthAbbrev(m)}</span>`).join("")}
        </div>
      </div>
    `;
    attachChartTooltip(el.querySelector(".chart-evolucao"));
  }

  await reload();
  window.addEventListener("kami:wallet-changed", reload);
}