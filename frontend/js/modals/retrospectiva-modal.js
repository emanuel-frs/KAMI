import { getRetrospectiva, listRetrospectivas, markRetrospectivaVista } from "../api/nucleo.js";
import { icon } from "../components/icons.js";
import { escapeHtml, fmtDataCurta } from "../components/format.js";
import { fxAllows } from "../components/fx.js";
import { showToast } from "../components/toast.js";
import { textoDoRegistro, tituloConquista } from "../components/textos-sistema.js";

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

/** "↑ 18%" / "↓ 4" / "=" / "novo" — comparação com o mês anterior. */
function compare(current, previous, { pct = false } = {}) {
  if (!previous) return current ? "novo" : "";
  const diff = current - previous;
  if (diff === 0) return "=";
  const arrow = diff > 0 ? "↑" : "↓";
  return pct ? `${arrow} ${Math.round((Math.abs(diff) / previous) * 100)}%` : `${arrow} ${Math.abs(diff)}`;
}

// classe de cor do pedaço da comparação (subiu = destaque, caiu = âmbar)
const trendClass = (note) => (note.startsWith("↑") || note === "novo" ? "up" : note.startsWith("↓") ? "down" : "dim");

/*
 * O resumo é montado UMA vez como linhas de pedaços [texto, classe]: o
 * .txt usa só o texto (retroText), a tela pinta cada pedaço com a classe
 * (retroHtml, css/retrospectiva.css). Assim o arquivo e a tela nunca
 * divergem. Classes (prefixo rt-, porque .r-meta já existe em
 * carteira.css): frame, title, label, dots, value, up, down, dim,
 * section, bar-on, bar-off, bullet, item, meta.
 */
function row(label, value, note = "", noteSuffix = "") {
  const dots = ".".repeat(Math.max(2, 20 - label.length));
  const parts = [[" "], [label, "label"], [` ${dots} `, "dots"], [String(value).padEnd(9), "value"]];
  if (note) parts.push([note, trendClass(note)]);
  if (noteSuffix) parts.push([noteSuffix, "dim"]);
  return parts;
}

// I18N: retrospectiva gravada antes da tradução guarda só o título (string)
const tituloDaRetrospectiva = (c) =>
  typeof c === "string" ? c : tituloConquista({ key: c.chave, title: c.titulo });

const textoDaAcao = (a) => textoDoRegistro({ description: a.descricao, description_key: a.chave, description_vars: a.vars });

function bar(pct, cells = 20) {
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return [["[", "dim"], ["#".repeat(filled), "bar-on"], ["-".repeat(cells - filled), "bar-off"], ["]", "dim"]];
}

export function retroLines(r) {
  const prev = r.anterior ?? {};
  const prevName = MONTHS[Number(prev.mes?.slice(5, 7)) - 1] ?? "mês anterior";
  const title = ` RETROSPECTIVA · ${monthLabel(r.mes).toUpperCase()}`;
  const xpNote = compare(r.xp_total, prev.xp_total, { pct: true });
  const lines = [
    // moldura em ASCII puro: a fonte do app não tem os caracteres de caixa
    // (┌─┐) e o fallback do navegador tem outra largura — a caixa não fechava
    [[`+${"-".repeat(WIDTH)}+`, "frame"]],
    [["|", "frame"], [title.padEnd(WIDTH), "title"], ["|", "frame"]],
    [[`+${"-".repeat(WIDTH)}+`, "frame"]],
    [],
    row("xp no mês", fmt(r.xp_total), xpNote, xpNote && xpNote !== "novo" ? ` vs ${prevName}` : ""),
    row("ações", fmt(r.acoes), compare(r.acoes, prev.acoes)),
    row("dias ativos", `${r.dias_ativos}/${r.dias_no_mes}`, compare(r.dias_ativos, prev.dias_ativos)),
    row("melhor sequência", `${r.melhor_sequencia} ${r.melhor_sequencia === 1 ? "dia" : "dias"}`),
    row("missões", fmt(r.missoes), compare(r.missoes, prev.missoes)),
    [],
    [[" XP POR ATRIBUTO", "section"]],
  ];
  const attrs = Object.entries(r.xp_por_atributo ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...attrs.map(([, xp]) => xp));
  for (const [name, xp] of attrs) {
    lines.push([[" "], [(ATTRIBUTE_LABELS[name] ?? name).padEnd(13), "label"], [" "], ...bar((xp / max) * 100), [` ${fmt(xp).padStart(6)}`, "value"]]);
  }
  lines.push([], [[` CONQUISTAS DO MÊS (${r.conquistas.length})`, "section"]]);
  if (r.conquistas.length) r.conquistas.forEach((c) => lines.push([["  * ", "bullet"], [tituloDaRetrospectiva(c), "item"]]));
  else lines.push([["  nenhuma neste mês", "dim"]]);
  lines.push([], [[" AÇÃO DO MÊS", "section"]]);
  if (r.acao_do_mes) {
    lines.push([["  "], [textoDaAcao(r.acao_do_mes), "item"]], [["  "], [`+${r.acao_do_mes.xp} xp`, "up"], [` · ${fmtDataCurta(r.acao_do_mes.dia)}`, "meta"]]);
  } else {
    lines.push([["  —", "dim"]]);
  }
  return lines;
}

/** Texto puro (o mesmo da tela) — é o que vai pro .txt. */
export function retroText(r) {
  return retroLines(r)
    .map((parts) => parts.map(([text]) => text).join("").trimEnd())
    .join("\n");
}

/** A mesma coisa pintada: uma <span class="retro-line"> por linha, pedaços coloridos. */
export function retroHtml(r) {
  return retroLines(r)
    .map((parts, i) => {
      const inner = parts
        .map(([text, cls]) => (cls ? `<span class="rt-${cls}">${escapeHtml(text)}</span>` : escapeHtml(text)))
        .join("");
      return `<span class="retro-line" style="--i:${i}">${inner || " "}</span>`;
    })
    .join(""); // cada linha já é um bloco (css/retrospectiva.css)
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
  const filename = `kami-retrospectiva-${current.mes}.txt`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  // sem isto não dava pra saber se o arquivo tinha sido salvo (pedido no teste)
  const btn = modalEl.querySelector('[data-action="export"]');
  btn.innerHTML = `${icon("check", { size: 11 })} exportado`;
  setTimeout(() => {
    btn.innerHTML = `${icon("download", { size: 11 })} exportar .txt`;
  }, 2500);
  showToast({
    title: "retrospectiva exportada",
    message: `salva como ${filename} — confira sua pasta de downloads`,
    iconName: "download",
    duration: 6000,
  });
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
  // GAM-15: com efeitos "completo", as linhas entram uma depois da outra
  pre.classList.toggle("animated", fxAllows("completo"));
  pre.innerHTML = retroHtml(current);
  // garantia: se a animação não rodar (janela em segundo plano etc.), o
  // texto não pode ficar invisível — mesmo cuidado do liga-CRT em fx.js
  setTimeout(() => pre.classList.remove("animated"), 900);
  if (!months[index].vista) {
    months[index].vista = true;
    // marcar como vista é só pra não reabrir sozinha; se falhar, o pior é
    // ela abrir de novo no próximo mês (CONF-01: silêncio de propósito)
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
