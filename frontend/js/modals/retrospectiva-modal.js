import { getRetrospectiva, listRetrospectivas, markRetrospectivaVista } from "../api/nucleo.js";
import { icon } from "../components/icons.js";
import { xpBar } from "../components/xp-bar.js";

/**
 * Retrospectiva mensal (GAM-12) — o mês que acabou em uma tela ASCII:
 * números do mês com a comparação ↑/↓ com o anterior, xp por atributo em
 * barras de texto, conquistas, melhor sequência e a "ação do mês". O
 * resumo vem pronto e congelado do backend (app/retrospectiva.py); aqui
 * ele só vira texto — o MESMO texto mostrado na tela é o exportado em
 * .txt, por isso `retroText` é uma função pura.
 *
 * Abre sozinha uma vez (startRetrospective, chamado em app.js depois do
 * splash) quando a retrospectiva mais nova ainda não foi vista, e pode ser
 * reaberta pelo botão "retrospectivas" do card de perfil — com ‹ › pra
 * navegar entre os meses guardados. Usa o modal padrão do app
 * (.modal-backdrop): Esc e foco já são tratados por modal-escape.js e
 * modal-accessibility.js.
 */

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const WIDTH = 58;
const ATTRIBUTE_LABELS = { financas: "finanças", organizacao: "organização" };

export function monthLabel(mes) {
  const [year, month] = mes.split("-");
  return `${MONTHS[Number(month) - 1]} de ${year}`;
}

const fmt = (n) => Number(n).toLocaleString("pt-BR");

/** "↑ 18% vs agosto" / "↓ 4" / "=" — comparação com o mês anterior. */
function compare(current, previous, { pct = false } = {}) {
  if (!previous) return current ? "novo" : "";
  const diff = current - previous;
  if (diff === 0) return "=";
  const arrow = diff > 0 ? "↑" : "↓";
  return pct ? `${arrow} ${Math.round((Math.abs(diff) / previous) * 100)}%` : `${arrow} ${Math.abs(diff)}`;
}

function row(label, value, note = "") {
  const dots = ".".repeat(Math.max(2, 20 - label.length));
  return ` ${label} ${dots} ${String(value).padEnd(9)}${note}`.trimEnd();
}

export function retroText(r) {
  const prev = r.anterior ?? {};
  const prevName = MONTHS[Number(prev.mes?.slice(5, 7)) - 1] ?? "mês anterior";
  const title = ` RETROSPECTIVA · ${monthLabel(r.mes).toUpperCase()}`;
  const lines = [
    `┌${"─".repeat(WIDTH)}┐`,
    `│${title.padEnd(WIDTH)}│`,
    `└${"─".repeat(WIDTH)}┘`,
    "",
    row("xp no mês", fmt(r.xp_total), `${compare(r.xp_total, prev.xp_total, { pct: true })} vs ${prevName}`.trim()),
    row("ações", fmt(r.acoes), compare(r.acoes, prev.acoes)),
    row("dias ativos", `${r.dias_ativos}/${r.dias_no_mes}`, compare(r.dias_ativos, prev.dias_ativos)),
    row("melhor sequência", `${r.melhor_sequencia} ${r.melhor_sequencia === 1 ? "dia" : "dias"}`),
    row("missões", fmt(r.missoes), compare(r.missoes, prev.missoes)),
    "",
    " XP POR ATRIBUTO",
  ];
  const attrs = Object.entries(r.xp_por_atributo ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...attrs.map(([, xp]) => xp));
  for (const [name, xp] of attrs) {
    lines.push(` ${(ATTRIBUTE_LABELS[name] ?? name).padEnd(13)} ${xpBar((xp / max) * 100, 20)} ${fmt(xp).padStart(6)}`);
  }
  lines.push("", ` CONQUISTAS DO MÊS (${r.conquistas.length})`);
  if (r.conquistas.length) r.conquistas.forEach((t) => lines.push(`  * ${t}`));
  else lines.push("  nenhuma neste mês");
  lines.push("", " AÇÃO DO MÊS");
  if (r.acao_do_mes) {
    const [, m, d] = r.acao_do_mes.dia.split("-");
    lines.push(`  ${r.acao_do_mes.descricao}`, `  +${r.acao_do_mes.xp} xp · ${d}/${m}`);
  } else {
    lines.push("  —");
  }
  return lines.join("\n");
}

let modalEl = null;
let months = [];
let index = 0;
let current = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "retrospectiva-modal";
  wrap.innerHTML = `
    <div class="modal retro-modal" role="dialog" aria-modal="true" aria-labelledby="retro-title">
      <div class="modal-head"><span class="modal-head-title" id="retro-title">retrospectiva</span> <button type="button" class="close" data-action="close" aria-label="fechar">${icon("x")}</button></div>
      <div class="modal-body">
        <pre class="retro-pre" tabindex="0"></pre>
      </div>
      <div class="retro-actions">
        <button type="button" class="btn sm" data-action="prev" aria-label="mês anterior">‹ anterior</button>
        <button type="button" class="btn sm" data-action="next" aria-label="próximo mês">próximo ›</button>
        <span class="retro-spacer"></span>
        <button type="button" class="btn sm" data-action="export">${icon("download", { size: 11 })} exportar .txt</button>
      </div>
    </div>`;
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeRetrospectivaModal));
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeRetrospectivaModal();
  });
  // a lista vem da mais nova pra mais antiga: "anterior" = índice maior
  wrap.querySelector('[data-action="prev"]').addEventListener("click", () => show(index + 1));
  wrap.querySelector('[data-action="next"]').addEventListener("click", () => show(index - 1));
  wrap.querySelector('[data-action="export"]').addEventListener("click", exportTxt);
  document.body.appendChild(wrap);
  return wrap;
}

function exportTxt() {
  if (!current) return;
  const blob = new Blob([`${retroText(current)}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kami-retrospectiva-${current.mes}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function show(i) {
  if (i < 0 || i >= months.length) return;
  index = i;
  const pre = modalEl.querySelector(".retro-pre");
  const title = modalEl.querySelector("#retro-title");
  modalEl.querySelector('[data-action="prev"]').disabled = index >= months.length - 1;
  modalEl.querySelector('[data-action="next"]').disabled = index <= 0;
  try {
    current = await getRetrospectiva(months[index].mes);
  } catch (err) {
    current = null;
    pre.textContent = `erro ao carregar a retrospectiva: ${err.message}`;
    return;
  }
  title.textContent = `retrospectiva · ${monthLabel(current.mes)}`;
  pre.textContent = retroText(current);
  if (!months[index].vista) {
    months[index].vista = true;
    markRetrospectivaVista(current.mes).catch(() => {});
  }
}

/** Abre na retrospectiva mais nova (ou num aviso, se ainda não há nenhuma). */
export async function openRetrospectivaModal() {
  modalEl = modalEl || buildModal();
  try {
    months = await listRetrospectivas();
  } catch (err) {
    months = [];
  }
  modalEl.classList.add("open");
  if (!months.length) {
    current = null;
    modalEl.querySelector("#retro-title").textContent = "retrospectiva";
    modalEl.querySelector(".retro-pre").textContent =
      " nenhuma retrospectiva ainda — a primeira aparece quando o mês virar.";
    modalEl.querySelectorAll('[data-action="prev"], [data-action="next"], [data-action="export"]').forEach((b) => (b.disabled = true));
    return;
  }
  modalEl.querySelector('[data-action="export"]').disabled = false;
  await show(0);
}

export function closeRetrospectivaModal() {
  modalEl?.classList.remove("open");
}

/** Abre sozinha uma vez, quando a retrospectiva mais nova ainda não foi vista. */
export async function startRetrospective() {
  let list;
  try {
    list = await listRetrospectivas();
  } catch {
    return;
  }
  if (list.length && !list[0].vista) await openRetrospectivaModal();
}
