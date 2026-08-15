// Gráfico de progresso de uma meta ao longo do tempo — "queda de quanto
// falta" por contribuição (item 3.3 do ALINHAMENTO.md). Mesmo estilo
// hand-rolled SVG dos gráficos de Finanças (reaproveita .chart-svg/
// .chart-area/.chart-line/.chart-dot/.chart-fluxo-labels de
// widget-financas-extra-graficos.css — nenhuma classe nova de SVG aqui).
//
// Diferente dos gráficos de Finanças (janela fixa de meses), aqui o eixo X
// é por contribuição, não por mês — decisão de manter simples: cada evento
// é uma contribuição real, e metas normalmente não têm contribuições
// densas o bastante pra justificar agregação mensal.
//
// Y = valor restante pra bater a meta (target - acumulado, nunca negativo).
// remaining=target (início) fica embaixo (y=H), remaining=0 (concluída)
// fica em cima (y=0) — a linha "cai" da base até o topo conforme a meta
// avança, ilustrando literalmente a queda de "quanto falta".

import { attachChartTooltip } from "./chart-tooltip.js";

function fmtDateShort(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtRemaining(v, unit) {
  if (unit === "money") {
    return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const W = 400;
const H = 90;
const WINDOW = 6; // últimas N contribuições — gráfico simples, não o histórico inteiro
// (mesmo tamanho de janela do MESES_JANELA dos gráficos de Finanças; aqui
// cabe melhor ainda porque o card de meta é bem mais estreito que um widget)

export function renderProgressChart(el, goal, contributions) {
  if (!contributions.length) {
    el.innerHTML = `<div class="goal-progress-empty">sem contribuições ainda — o gráfico aparece após a primeira.</div>`;
    return;
  }

  const asc = [...contributions].sort((a, b) => new Date(a.date) - new Date(b.date));

  // remaining após cada contribuição, sobre o histórico completo (senão a
  // janela abaixo perderia o efeito de contribuições fora dela)
  let cumulative = 0;
  const full = asc.map((c) => {
    cumulative += c.amount;
    return { date: c.date, remaining: Math.max(0, goal.target_value - cumulative) };
  });

  const windowed = full.slice(-WINDOW);
  const startRemaining = full.length > windowed.length
    ? full[full.length - windowed.length - 1].remaining
    : goal.target_value;

  const points = [
    { label: "início", remaining: startRemaining },
    ...windowed.map((p) => ({ label: fmtDateShort(p.date), remaining: p.remaining })),
  ];

  const maxV = Math.max(goal.target_value, 1);
  const stepX = W / (points.length - 1 || 1);
  // y direto (sem inverter min/max) — remaining alto = embaixo, remaining
  // baixo = em cima, então a linha desce/sobe visualmente conforme cai
  const coords = points.map((p, i) => [i * stepX, (p.remaining / maxV) * H]);

  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${H} L0,${H} Z`;

  const dots = coords.map(([x, y], i) => {
    const tip = escapeAttr(`${points[i].label}: falta ${fmtRemaining(points[i].remaining, goal.unit)}`);
    // círculo invisível maior por cima, mesmo esquema dos gráficos de
    // Finanças (chart-tooltip.js) — o raio de 2.5 do ponto visível é
    // pequeno demais pra acertar o mouse com o card estreito.
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" class="chart-dot" data-tip="${tip}"></circle>` +
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" class="chart-dot-hit" data-tip="${tip}"></circle>`;
  }).join("");

  const labelsHtml = points.map((p) => `<span>${p.label}</span>`).join("");

  el.innerHTML = `
    <div class="chart-progresso">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg">
        <path d="${areaPath}" class="chart-area" />
        <path d="${linePath}" class="chart-line" />
        ${dots}
      </svg>
      <div class="chart-fluxo-labels">${labelsHtml}</div>
    </div>
  `;
  attachChartTooltip(el.querySelector(".chart-progresso"));
}