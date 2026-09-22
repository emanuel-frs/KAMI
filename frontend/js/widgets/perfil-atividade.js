// js/widgets/perfil-atividade.js
import { getLog } from "../api/nucleo.js";
import { escapeHtml } from "../components/format.js";
import { buildTextAltTable } from "../components/chart-text-alt.js";

/**
 * Contribution graph — atividade dos últimos ~PERIOD_DAYS dias,
 * somando ações de TODOS os atributos (diferente do heatmap que já
 * existe dentro da página de aprendizado, que só olha o atributo
 * "aprendizado" — aqui é uma visão geral pro perfil, não de uma área
 * específica).
 *
 * getLog() sem `attribute` já devolve de todas as áreas; o único
 * cuidado é o `limit` — o endpoint tem um limit=100 default (pensado
 * pra lista curta de "log recente"), que sozinho não dá nem pra
 * preencher ~14 semanas se a pessoa registra bastante coisa por dia.
 * Por isso pedimos um limit bem mais alto aqui.
 */

const PERIOD_DAYS = 98; // 14 semanas completas
const LIMIT = 1000;

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

// segunda-feira como início da semana (convenção local) — só afeta o
// alinhamento visual das colunas, não a contagem em si
function buildWeeks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (PERIOD_DAYS - 1));
  const startWeekday = (start.getDay() + 6) % 7; // 0=seg .. 6=dom
  start.setDate(start.getDate() - startWeekday);

  const days = [];
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

// níveis de intensidade — limiares arbitrários (ajuste aqui se quiser
// outra sensibilidade); é sobre AÇÕES REGISTRADAS no dia, não XP, pra
// não deixar uma ação de alto impacto sozinha parecer um dia "cheio"
function levelFor(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

const MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando atividade…</div>';

  let entries;
  try {
    entries = await getLog({ period_days: PERIOD_DAYS + 7, limit: LIMIT });
  } catch (err) {
    el.innerHTML = `<div class="empty-state">erro ao carregar atividade: ${err.message}</div>`;
    return;
  }

  const counts = new Map();
  for (const e of entries) {
    const key = e.created_at.slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const weeks = buildWeeks();
  const todayKey = dateKey(new Date());

  let lastMonth = -1;
  const monthLabels = weeks
    .map((week) => {
      const first = week[0];
      const m = first.getMonth();
      const label = m !== lastMonth ? MONTH_ABBR[m] : "";
      lastMonth = m;
      return `<span class="pa-month">${label}</span>`;
    })
    .join("");

  // linhas da tabela sr-only (item 5 das pendências) — só os dias já
  // passados/hoje, na ordem cronológica (a varredura visual é por
  // coluna/semana, que não é uma ordem de leitura útil em texto).
  const altRows = [];

  const cells = weeks
    .map((week) =>
      week
        .map((day) => {
          const key = dateKey(day);
          if (day > new Date()) return '<span class="pa-cell pa-empty"></span>';
          const count = counts.get(key) || 0;
          const lvl = levelFor(count);
          const isToday = key === todayKey;
          const dataStr = day.toLocaleDateString("pt-BR");
          const tip = count === 0 ? `${dataStr} — sem ações` : `${dataStr} — ${count} ${count === 1 ? "ação" : "ações"}`;
          altRows.push([dataStr, count === 0 ? "sem ações" : `${count} ${count === 1 ? "ação" : "ações"}`]);
          return `<span class="pa-cell pa-lvl${lvl}${isToday ? " pa-today" : ""}" data-tooltip="${escapeHtml(tip)}"></span>`;
        })
        .join("")
    )
    .join("");

  const totalActions = entries.length;

  el.innerHTML = `
    <div class="pa-wrap">
      <div class="pa-months" aria-hidden="true">${monthLabels}</div>
      <div class="pa-grid" aria-hidden="true" style="grid-template-columns: repeat(${weeks.length}, 1fr);">${cells}</div>
      <div class="pa-legend" aria-hidden="true">
        <span>${totalActions} ações nos últimos ${PERIOD_DAYS} dias</span>
        <span class="pa-scale">
          menos
          <i class="pa-swatch pa-lvl0"></i><i class="pa-swatch pa-lvl1"></i><i class="pa-swatch pa-lvl2"></i><i class="pa-swatch pa-lvl3"></i><i class="pa-swatch pa-lvl4"></i>
          mais
        </span>
      </div>
      <p class="sr-only">${totalActions} ações nos últimos ${PERIOD_DAYS} dias.</p>
      ${buildTextAltTable({
        caption: `Atividade diária dos últimos ${PERIOD_DAYS} dias`,
        headers: ["Data", "Ações"],
        rows: altRows,
      })}
    </div>`;
}
