import * as carreiraApi from "../api/carreira.js";
import { escapeHtml } from "../components/format.js";
import { openSalarioModal } from "../modals/salario-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { icon } from "../components/icons.js";
import { attachChartTooltip } from "../charts/chart-tooltip.js";
import { desenharNaLargura } from "../charts/na-largura.js";

/**
 * Widget "evolução salarial" (seção 5 do documento de regras de
 * negócio, Parte 4 do módulo Carreira) — mesmo padrão de lista de
 * carreira-posicoes.js (sem paginação/filtro). O gráfico fica sozinho
 * no topo (sem bloco de estatísticas, sem rótulo de valor, sem datas
 * cravadas no eixo — só o traço + pontos, com data/valor/motivo de
 * cada registro no tooltip do hover, mesmo mecanismo de
 * chart-tooltip.js) — mantém o widget tão enxuto em altura quanto
 * carreira-posicoes.js (só toolbar + lista logo abaixo), em vez do
 * teto mais alto que o bloco de estatísticas + eixo de texto exigiam
 * antes. Criar é a única ação que credita XP (ver
 * routers/carreira.py); editar/remover passam pelo mesmo modal sem
 * mexer em XP.
 */

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function money(amount, currency) {
  const n = Number(amount) || 0;
  if (currency === "BRL") return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Sem rótulo de valor nem datas cravadas no eixo (ficavam pequenos demais
// pra ler; cada ponto expõe data/valor/motivo no tooltip do hover), então o
// svg só precisa de uma margem mínima pra linha e os pontos não colarem na
// borda.
//
// O svg é desenhado na largura real do widget, em pixels (ver
// charts/na-largura.js): a altura é sempre CHART_H, mesmo num card largo.
const CHART_H = 96;
const CHART_PAD = 8; // margem topo/base/lados pra linha e pontos não colarem na borda

// Mesma base do gráfico de evolução patrimonial de finanças (ver
// financas-grafico-evolucao.js: area + linha + pontos com hit-area de
// hover, .chart-svg/.chart-area/.chart-line/.chart-dot/.chart-dot-hit/
// .chart-tooltip de widget-financas-extra-graficos.css), só que o eixo
// X segue os próprios registros (datas reais) em vez de uma janela fixa
// de N meses — aqui não existe "mês sem registro".
function buildSalarySvg(records, width) {
  const hist = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));
  const values = hist.map((r) => Number(r.amount) || 0);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1, maxV - minV);
  const plotH = CHART_H - CHART_PAD * 2;
  const plotW = Math.max(1, width - CHART_PAD * 2);
  const stepX = plotW / (hist.length - 1 || 1);
  const y = (v) => CHART_PAD + plotH - ((v - minV) / range) * plotH;
  const baseY = CHART_H;

  const coords = values.map((v, i) => [CHART_PAD + (hist.length === 1 ? plotW / 2 : i * stepX), y(v)]);
  const linePath = coords.map(([x, py], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${baseY} L${coords[0][0].toFixed(1)},${baseY} Z`;

  const dots = coords.map(([x, py], i) => {
    const r = hist[i];
    const tip = escapeAttr(`${formatDate(r.date)} · ${money(r.amount, r.currency)}${r.reason ? " · " + r.reason : ""}`);
    return `<circle cx="${x.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" class="chart-dot" data-tip="${tip}"></circle>` +
      `<circle cx="${x.toFixed(1)}" cy="${py.toFixed(1)}" r="12" class="chart-dot-hit" data-tip="${tip}"></circle>`;
  }).join("");

  // aria-hidden: redundante com .cs-list logo abaixo (mesmos dados)
  return `
    <svg viewBox="0 0 ${width} ${CHART_H}" width="${width}" height="${CHART_H}" class="chart-svg" aria-hidden="true">
      <path d="${areaPath}" class="chart-area"></path>
      <path d="${linePath}" class="chart-line"></path>
      ${dots}
    </svg>
  `;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando evolução salarial…</div>';
  let records = [];

  async function reload() {
    try {
      records = await carreiraApi.listCareerSalaryRecords();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar evolução salarial: ${escapeHtml(err.message)}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    el.innerHTML = `
      <div class="cs-widget">
        ${records.length ? '<div class="cs-chart-wrap"></div>' : ""}
        <div class="widget-inline-toolbar">
          <button type="button" class="btn sm" data-action="add-salary">+ registro</button>
        </div>
        <div class="cs-list">
          ${records.length ? records.map((r) => `
            <div class="cs-row" data-record-id="${r.id}">
              <div class="cs-top">
                <span class="cs-amount" data-edit-salary="${r.id}">${money(r.amount, r.currency)}</span>
                <span class="cs-remove" data-remove-salary="${r.id}" data-tooltip="remover registro" aria-label="remover registro">${icon("x", { size: 11 })}</span>
              </div>
              <div class="cs-meta">${formatDate(r.date)}${r.employment_type ? ` · ${escapeHtml(r.employment_type)}` : ""}${r.reason ? ` · ${escapeHtml(r.reason)}` : ""}</div>
            </div>`).join("") : `<div class="wallet-empty">nenhum registro salarial ainda.</div>`}
        </div>
      </div>
    `;

    const chartWrap = el.querySelector(".cs-chart-wrap");
    if (chartWrap) {
      desenharNaLargura(chartWrap, (largura) => buildSalarySvg(records, largura));
      attachChartTooltip(chartWrap);
    }

    el.querySelectorAll("[data-edit-salary]").forEach((el2) => {
      el2.addEventListener("click", () => {
        const id = el2.getAttribute("data-edit-salary");
        const record = records.find((r) => r.id === id);
        if (record) openSalarioModal({ record, onSaved: reload });
      });
    });

    el.querySelectorAll("[data-remove-salary]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal("remover esse registro salarial?", { title: "remover registro", confirmText: "remover", danger: true }))) return;
        await carreiraApi.deleteCareerSalaryRecord(btn.getAttribute("data-remove-salary"));
        await reload();
      });
    });

    el.querySelector('[data-action="add-salary"]').addEventListener("click", () => {
      openSalarioModal({ onSaved: reload });
    });
  }

  await reload();
}