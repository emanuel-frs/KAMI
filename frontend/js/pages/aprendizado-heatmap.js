/**
 * Aprendizado — mapa de atividade (heatmap) por ano.
 * MAN-02: saiu de pages/aprendizado.js, que continua montando a tela
 * (lista de trilhas, atalhos, montar/desmontar); o estado compartilhado
 * mora em aprendizado-estado.js.
 */
import { escapeHtml, fmtData, mesesCurtos } from "../components/format.js";
import { buildTextAltTable } from "../components/chart-text-alt.js";
import { getLog } from "../api/nucleo.js";
import { estado } from "./aprendizado-estado.js";
import { t } from "../i18n.js";

let heatmapYear = new Date().getFullYear();

async function loadHeatmapEntries() {
  try {
    // ~3 anos de histórico cobrem os 3 tabs de ano exibidos
    estado.heatmapEntries = await getLog({ attribute: 'aprendizado', period_days: 1100 });
  } catch (err) {
    estado.heatmapEntries = [];
  }
}

function buildYearWeeks(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const dec31 = new Date(Date.UTC(year, 11, 31));
  const start = new Date(jan1);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(dec31);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

  const weeks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return { weeks, jan1, dec31 };
}

export async function renderAprHeatmap() {
  const gridEl = estado.containerEl?.querySelector('#apr-heatmap');
  const monthsEl = estado.containerEl?.querySelector('#apr-heatmap-months');
  const yearsEl = estado.containerEl?.querySelector('#apr-heatmap-years');
  if (!gridEl || !monthsEl || !yearsEl) return;

  if (!estado.heatmapEntries) await loadHeatmapEntries();

  const countsByDay = {};
  const milestoneByDay = {};
  estado.heatmapEntries.forEach(l => {
    const key = l.created_at.slice(0, 10);
    countsByDay[key] = (countsByDay[key] || 0) + 1;
    if (l.description && l.description.startsWith('concluiu marco:')) {
      milestoneByDay[key] = (milestoneByDay[key] || []).concat(
        l.description.replace('concluiu marco: ', '')
      );
    }
  });

  const currentYear = new Date().getFullYear();
  const yearsWithData = new Set(
    estado.heatmapEntries.map(l => parseInt(l.created_at.slice(0, 4), 10))
  );
  yearsWithData.add(currentYear);
  const years = [...yearsWithData].sort((a, b) => b - a);

  yearsEl.innerHTML = years.map(y => `
    <button type="button" class="apr-heatmap-year-btn${y === heatmapYear ? ' active' : ''}" data-year="${y}">${y}</button>
  `).join('');
  yearsEl.querySelectorAll('[data-year]').forEach(btn => {
    btn.addEventListener('click', () => {
      heatmapYear = parseInt(btn.dataset.year, 10);
      renderAprHeatmap();
    });
  });

  const { weeks, jan1, dec31 } = buildYearWeeks(heatmapYear);

  // tamanho de célula calculado pra caber exatamente o ano inteiro no
  // espaço disponível, sem precisar de scroll horizontal (o scroll
  // "escondido" via CSS não é confiável no WebKitGTK empacotado —
  // melhor não depender de overflow em primeiro lugar).
  const mainEl = estado.containerEl.querySelector('.apr-heatmap-main');
  const GAP = 3;
  const WEEKDAY_COL = 26; // width da .apr-heatmap-weekdays (20px) + gap da .apr-heatmap-body (6px)
  const available = (mainEl?.clientWidth || 0) - WEEKDAY_COL;
  const rawCell = available > 0
    ? Math.floor((available - (weeks.length - 1) * GAP) / weeks.length)
    : 13;
  const cellSize = Math.max(6, Math.min(13, rawCell));
  mainEl?.style.setProperty('--hm-cell', `${cellSize}px`);

  gridEl.style.gridTemplateColumns = `repeat(${weeks.length}, var(--hm-cell, 13px))`;
  monthsEl.style.gridTemplateColumns = `repeat(${weeks.length}, var(--hm-cell, 13px))`;

  let cellsHtml = '';
  const altRows = []; // item 5 das pendências: equivalente em texto (mesmo padrão de perfil-atividade.js)
  weeks.forEach(week => {
    week.forEach(d => {
      if (d < jan1 || d > dec31) {
        cellsHtml += `<div class="hm-cell-empty"></div>`;
        return;
      }
      const key = d.toISOString().slice(0, 10);
      const c = countsByDay[key] || 0;
      const lvl = c >= 3 ? 3 : c === 2 ? 2 : c === 1 ? 1 : 0;
      const isMilestone = !!milestoneByDay[key];
      const dataStr = fmtData(key);
      const registroStr = c ? t("aprendizado_heatmap.registros", { n: c }) : t("aprendizado_heatmap.sem_registro");
      const marcoStr = isMilestone ? t("aprendizado_heatmap.marco", { marcos: milestoneByDay[key].join('; ') }) : '';
      const tip = `${dataStr} · ${registroStr}` + (marcoStr ? ` · ${marcoStr}` : '');
      cellsHtml += `<div class="hm-cell lvl-${lvl}${isMilestone ? ' milestone' : ''}" data-tooltip="${escapeHtml(tip)}"></div>`;
      // dias sem nenhum registro e sem marco não agregam nada a uma
      // leitura em texto de um ano inteiro (365 linhas "sem registro"
      // seria pior que não ter tabela nenhuma) — só entram os dias com
      // atividade de verdade.
      if (c > 0 || isMilestone) altRows.push([dataStr, registroStr + (marcoStr ? ` · ${marcoStr}` : '')]);
    });
  });
  gridEl.innerHTML = cellsHtml;

  const altEl = estado.containerEl?.querySelector('#apr-heatmap-alt');
  if (altEl) {
    altEl.innerHTML = altRows.length
      ? buildTextAltTable({
          caption: t("aprendizado_heatmap.caption", { ano: heatmapYear }),
          headers: [t("aprendizado_heatmap.col_data"), t("aprendizado_heatmap.col_atividade")],
          rows: altRows,
        })
      : `<p class="sr-only">${t("aprendizado_heatmap.vazio", { ano: heatmapYear })}</p>`;
  }

  let monthsHtml = '';
  let lastMonth = -1;
  weeks.forEach((week, idx) => {
    const marker = week.find(d => d >= jan1 && d <= dec31 && d.getUTCDate() <= 7);
    if (marker) {
      const month = marker.getUTCMonth();
      if (month !== lastMonth) {
        monthsHtml += `<span style="grid-column:${idx + 1};">${mesesCurtos()[month]}</span>`;
        lastMonth = month;
      }
    }
  });
  monthsEl.innerHTML = monthsHtml;
}
