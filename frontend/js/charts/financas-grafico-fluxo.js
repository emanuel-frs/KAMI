import * as financasApi from "../api/financas.js";
import { attachChartTooltip } from "./chart-tooltip.js";
import { buildTextAltTable } from "../components/chart-text-alt.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { escapeHtml, fmtMoeda, mesesCurtos } from "../components/format.js";
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
function monthAbbrev(monthStr) {
  const [, m] = monthStr.split("-").map(Number);
  return mesesCurtos()[m - 1];
}
function brl(v) {
  return fmtMoeda(v, { inteiro: true });
}
function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const MESES_JANELA = 6;
const W = 600;
const H = 150;

export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("graf.carregando_fluxo")}</div>`;

  async function reload() {
    const currentMonth = currentMonthStr();
    const months = [];
    for (let i = MESES_JANELA - 1; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));

    let data;
    try {
      data = await Promise.all(months.map((m) => financasApi.getSummary(m)));
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("graf.erro", { erro: err.message }))}</div>`;
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
      const tipIn = escapeAttr(t("graf.tip_entrada", { mes: monthAbbrev(months[i]), valor: brl(d.total_in) }));
      const tipOut = escapeAttr(t("graf.tip_saida", { mes: monthAbbrev(months[i]), valor: brl(d.total_out) }));
      return `
        <rect x="${xIn.toFixed(1)}" y="${(H - hIn).toFixed(1)}" width="${barW.toFixed(1)}" height="${hIn.toFixed(1)}" class="cf-bar entrada" data-tip="${tipIn}"></rect>
        <rect x="${xOut.toFixed(1)}" y="${(H - hOut).toFixed(1)}" width="${barW.toFixed(1)}" height="${hOut.toFixed(1)}" class="cf-bar saida" data-tip="${tipOut}"></rect>
      `;
    }).join("");

    const gridLines = [0.25, 0.5, 0.75].map(
      (f) => `<line x1="0" y1="${(H * (1 - f)).toFixed(1)}" x2="${W}" y2="${(H * (1 - f)).toFixed(1)}" class="chart-grid-line" />`
    ).join("");

    el.innerHTML = `
      <div class="chart-fluxo-wrap">
        <div class="chart-legend" aria-hidden="true">
          <span class="legend-item"><span class="legend-dot entrada"></span>${t("graf.entrada")}</span>
          <span class="legend-item"><span class="legend-dot saida"></span>${t("graf.saida")}</span>
        </div>
        <div class="chart-fluxo">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg" aria-hidden="true">
          ${gridLines}
          ${bars}
        </svg>
        <div class="chart-fluxo-labels" aria-hidden="true">
          ${months.map((m) => `<span>${monthAbbrev(m)}</span>`).join("")}
        </div>
        </div>
        ${buildTextAltTable({
          caption: t("graf.fluxo_caption"),
          headers: [t("graf.mes"), t("graf.col_entrada"), t("graf.col_saida")],
          rows: data.map((d, i) => [monthAbbrev(months[i]), brl(d.total_in), brl(d.total_out)]),
        })}
      </div>
    `;
    attachChartTooltip(el.querySelector(".chart-fluxo-wrap"));
  }

  await reload();
  listenWhileConnected(el, "kami:wallet-changed", reload);
}