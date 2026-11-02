/**
 * Quadro com os números de uma consulta do assistente (IA-07a).
 *
 * O Kami mostra os números do jeito que leu (resumo financeiro, metas,
 * visão do mês) e o modelo só comenta embaixo. Teste do Emanuel no
 * qwen3.5:4b: mesmo com os dados certos na mão, o modelo reescrevia os
 * números e inventava valores. Aqui nada passa pelo modelo.
 *
 * `dados` é o mesmo JSON que foi pro modelo (backend ferramentas.quadro):
 * nomes de campo em inglês, valores crus.
 */
import { escapeHtml, fmtDataCompacta, fmtMesAno, fmtMoeda } from "./format.js";
import { t } from "../i18n.js";

const MAX_METAS = 5;
const SITUACOES = {
  ahead: "adiantada", "on track": "no_ritmo", behind: "atrasada", overdue: "vencida", done: "concluida", "no deadline": "sem_prazo",
};

// tom do valor: as cores do sistema (entra verde, sai vermelho, previsto âmbar)
const linha = (rotulo, valor, extra = "", tom = "") =>
  `<div class="ia-quadro-linha"><dt>${escapeHtml(rotulo)}</dt><dd><span class="ia-quadro-v${tom ? ` ia-quadro-v--${tom}` : ""}">${escapeHtml(valor)}</span>${extra ? ` <span class="ia-quadro-extra">${escapeHtml(extra)}</span>` : ""}</dd></div>`;
const tomDe = (n, positivo = "entra", negativo = "sai") => (n > 0 ? positivo : n < 0 ? negativo : "");

function pct(n) {
  return `${n > 0 ? "+" : ""}${String(n).replace(".", ",")}%`;
}

function previstoTexto(entradas) {
  const pendentes = (entradas || []).filter((e) => e.status === "previsto");
  if (!pendentes.length) return null;
  const total = pendentes.reduce((s, e) => s + (e.amount || 0), 0);
  const datas = pendentes.map((e) => fmtDataCompacta(e.expected_date)).join(", ");
  return [fmtMoeda(total), t("assistente.quadro.em_datas", { datas })];
}

function linhasFinancas(f, entradas) {
  const c = f.conclusions || {};
  const out = [linha(t("assistente.quadro.entrou"), fmtMoeda(f.income || 0), f.income ? "" : t("assistente.quadro.nada_ainda"),
    f.income ? "entra" : "")];
  const maior = c.biggest_category;
  out.push(linha(t("assistente.quadro.saiu"), fmtMoeda(f.expenses || 0),
    maior ? t("assistente.quadro.maior_categoria", { categoria: maior.category, pct: pct(maior.share_of_expenses_pct).replace("+", "") }) : "",
    f.expenses ? "sai" : ""));
  if (f.net_this_month != null) {
    out.push(linha(t("assistente.quadro.resultado"), fmtMoeda(f.net_this_month),
      c.kept_pct_of_income != null ? t("assistente.quadro.da_renda", { pct: pct(c.kept_pct_of_income) }) : "", tomDe(f.net_this_month)));
  }
  if (c.expenses_vs_previous_month_pct != null) {
    // gasto subindo é ruim (vermelho), caindo é bom (verde)
    out.push(linha(t("assistente.quadro.vs_mes_passado"), pct(c.expenses_vs_previous_month_pct), "",
      tomDe(c.expenses_vs_previous_month_pct, "sai", "entra")));
  }
  const previsto = previstoTexto(entradas);
  if (previsto) out.push(linha(t("assistente.quadro.previsto"), previsto[0], previsto[1], "previsto"));
  else if (c.income_still_expected) out.push(linha(t("assistente.quadro.previsto"), fmtMoeda(c.income_still_expected), "", "previsto"));
  if (f.accounts_total_available != null) out.push(linha(t("assistente.quadro.nas_contas"), fmtMoeda(f.accounts_total_available), "", "forte"));
  return out;
}

function valorMeta(g, v) {
  return g.unit === "money" ? fmtMoeda(v || 0) : `${v ?? 0}${g.unit && g.unit !== "count" ? ` ${g.unit}` : ""}`;
}

/** Nome + etiqueta, barra de progresso e uma linha de detalhes (metas e trilhas). */
function blocoComBarra(nome, pctBruto, chave, detalhes) {
  const progresso = Math.max(0, Math.min(100, Number(pctBruto) || 0));
  const etiqueta = chave
    ? `<span class="ia-quadro-tag ia-quadro-tag--${chave}">${escapeHtml(t(`assistente.quadro.situacao.${chave}`))}</span>`
    : "";
  return `<div class="ia-quadro-meta">
    <div class="ia-quadro-meta-cab"><span class="ia-quadro-meta-nome">${escapeHtml(nome)}</span>${etiqueta}</div>
    <div class="ia-quadro-meta-progresso"><div class="ia-quadro-barra"><div class="bar-fill ia-quadro-barra--${chave || "no_ritmo"}" style="width:${progresso}%;"></div></div><span class="ia-quadro-v">${progresso}%</span></div>
    ${detalhes.length ? `<div class="ia-quadro-extra">${escapeHtml(detalhes.join(" · "))}</div>` : ""}
  </div>`;
}

function linhaMeta(g) {
  const partes = [];
  if (g.remaining) partes.push(t("assistente.quadro.falta", { valor: valorMeta(g, g.remaining) }));
  if (g.needed_per_week) partes.push(t("assistente.quadro.por_semana", { valor: valorMeta(g, g.needed_per_week) }));
  if (g.deadline && g.situation !== "done") partes.push(t("assistente.quadro.ate", { data: fmtDataCompacta(g.deadline) }));
  return blocoComBarra(g.title, g.progress_pct, SITUACOES[g.situation], partes);
}

const vazio = (texto) => `<p class="ia-quadro-vazio">${escapeHtml(texto)}</p>`;

// ── visão do mês: um cartão por área, valor à direita (como um extrato) ──
const MAX_NO_CARTAO = 4;

const fila = (rotulo, valor, tom = "") =>
  `<div class="ia-q-fila"><span class="ia-q-rotulo">${escapeHtml(rotulo)}</span><span class="ia-quadro-v${tom ? ` ia-quadro-v--${tom}` : ""}">${escapeHtml(valor)}</span></div>`;

/** Nome à esquerda, % à direita e a barra fina embaixo — metas e trilhas iguais. */
function filaComBarra(nome, pctBruto, chave = null) {
  const progresso = Math.max(0, Math.min(100, Number(pctBruto) || 0));
  const etiqueta = chave
    ? ` <span class="ia-quadro-tag ia-quadro-tag--${chave}">${escapeHtml(t(`assistente.quadro.situacao.${chave}`))}</span>`
    : "";
  return `<div class="ia-q-barra-fila"><div class="ia-q-fila"><span class="ia-q-rotulo ia-q-nome">${escapeHtml(nome)}${etiqueta}</span><span class="ia-quadro-v">${progresso}%</span></div>
    <div class="ia-quadro-barra"><div class="bar-fill ia-quadro-barra--${chave || "no_ritmo"}" style="width:${progresso}%;"></div></div></div>`;
}

/** Lista que rola dentro do cartão quando passa da altura (10 metas não
 *  esticam o quadro); com muitos itens, dá pra rolar pelo teclado. */
const rolavel = (itens, html) =>
  `<div class="ia-q-lista"${itens > MAX_NO_CARTAO ? ` tabindex="0"` : ""}>${html}</div>`;

/** Seta e cor contra o mês anterior: "+20 ↑". */
function contraAnterior(agora, antes, prefixo = "") {
  const tom = antes == null || agora === antes ? "" : agora > antes ? "entra" : "sai";
  return { valor: `${prefixo}${agora ?? 0}${tom === "entra" ? " ↑" : tom === "sai" ? " ↓" : ""}`, tom };
}

function cartaoFinancas(f) {
  const c = f.conclusions || {};
  const filas = [
    fila(t("assistente.quadro.entrou"), fmtMoeda(f.income || 0), f.income ? "entra" : ""),
    fila(t("assistente.quadro.saiu"), fmtMoeda(f.expenses || 0), f.expenses ? "sai" : ""),
  ];
  if (f.net_this_month != null) filas.push(fila(t("assistente.quadro.resultado"), fmtMoeda(f.net_this_month), tomDe(f.net_this_month)));
  if (c.income_still_expected) filas.push(fila(t("assistente.quadro.previsto"), fmtMoeda(c.income_still_expected), "previsto"));
  if (f.accounts_total_available != null) filas.push(fila(t("assistente.quadro.nas_contas"), fmtMoeda(f.accounts_total_available), "forte"));
  return filas.join("");
}

function cartaoMetas(metas) {
  const ativas = metas.filter((g) => g.status === "ativa");
  if (!ativas.length) return null;
  return rolavel(ativas.length, ativas.map((g) => filaComBarra(g.title, g.progress_pct, SITUACOES[g.situation])).join(""));
}

function cartaoHabitos(habitos) {
  if (!habitos.length) return null;
  return rolavel(habitos.length, habitos.map((h) => fila(`${h.done_today ? "✓ " : ""}${h.name}`,
    t("assistente.quadro.habito_resumo", { n: h.streak ?? 0, pct: h.success_30d_pct ?? 0 }), h.streak ? "entra" : "")).join(""));
}

function cartaoAprendizado(a) {
  const trilhas = a.tracks || [];
  if (!trilhas.length && !a.milestones_completed_this_month) return null;
  return fila(t("assistente.quadro.marcos_mes"), String(a.milestones_completed_this_month ?? 0), a.milestones_completed_this_month ? "entra" : "")
    + rolavel(trilhas.length, trilhas.map((tr) => filaComBarra(tr.track, tr.progress_pct)).join(""));
}

function cartaoProgresso(p) {
  const ant = p.previous_month || {};
  const xp = contraAnterior(p.xp_gained ?? 0, ant.xp_gained, "+");
  const dias = contraAnterior(p.active_days ?? 0, ant.active_days);
  const filas = [fila(t("assistente.quadro.xp"), xp.valor, xp.tom), fila(t("assistente.quadro.dias_ativos"), dias.valor, dias.tom),
    fila(t("assistente.quadro.missoes"), String(p.missions_completed ?? 0))];
  const conquistas = p.achievements_unlocked || [];
  if (conquistas.length) filas.push(fila(t("assistente.quadro.conquistas"), String(conquistas.length), "previsto"));
  return filas.join("");
}

/** Cartões das áreas liberadas (as desligadas nem chegam aqui); as sem
 *  nada no mês viram uma linha só no fim, sem ocupar cartão. */
function corpoMes(d) {
  const areas = [
    ["financas", d.finances && cartaoFinancas(d.finances), d.finances],
    ["metas", d.goals && cartaoMetas(d.goals), d.goals],
    ["habitos", d.habits && cartaoHabitos(d.habits), d.habits],
    ["aprendizado", d.learning && cartaoAprendizado(d.learning), d.learning],
    ["progresso", d.progress && cartaoProgresso(d.progress), d.progress],
  ].filter(([, , veio]) => veio);
  const cheias = areas.filter(([, html]) => html);
  const vazias = areas.filter(([, html]) => !html).map(([chave]) => t(`assistente.quadro.secao.${chave}`));
  return `<div class="ia-q-grade">${cheias.map(([chave, html]) =>
    `<section class="ia-q-cartao ia-q-cartao--${chave}"><h4 class="ia-q-area">${escapeHtml(t(`assistente.quadro.secao.${chave}`))}</h4>${html}</section>`).join("")}</div>`
    + (vazias.length ? `<p class="ia-quadro-vazio ia-q-vazias">${escapeHtml(t("assistente.quadro.sem_registros", { areas: vazias.join(", ") }))}</p>` : "");
}

/** "4 ativas · 1 no ritmo · 3 sem prazo · falta R$ 187,50" — contado pelo Kami. */
function resumoMetas(r) {
  if (!r?.active) return [];
  const partes = [t("assistente.quadro.ativas", { n: r.active })];
  for (const [campo, chave] of [["on_track", "no_ritmo"], ["ahead", "adiantada"], ["behind", "atrasada"], ["overdue", "vencida"], ["no_deadline", "sem_prazo"]]) {
    if (r[campo]) partes.push(`${r[campo]} ${t(`assistente.quadro.situacao.${chave}`)}`);
  }
  if (r.money_remaining_total) partes.push(t("assistente.quadro.falta", { valor: fmtMoeda(r.money_remaining_total) }));
  return [`<p class="ia-q-resumo">${escapeHtml(partes.join(" · "))}</p>`];
}

function linhasMetas(metas) {
  const ativas = (metas || []).filter((g) => g.status === "ativa");
  if (!ativas.length) return [vazio(t("assistente.quadro.sem_metas"))];
  return [`<div class="ia-q-lista ia-q-lista--alta"${ativas.length > MAX_METAS ? ` tabindex="0"` : ""}>${ativas.map(linhaMeta).join("")}</div>`];
}

function corpoDo(nome, d) {
  if (nome === "finance_summary") return { titulo: fmtMesAno(d.month), linhas: linhasFinancas(d, d.expected_income) };
  if (nome === "goals") return { titulo: t("assistente.quadro.metas"), linhas: [...resumoMetas(d.summary), ...linhasMetas(d.goals)] };
  if (nome === "month_overview") return { titulo: fmtMesAno(d.month), html: corpoMes(d) };
  return null;
}

/** Linhas dt/dd seguidas vão num <dl>; metas e avisos ficam fora dele. */
function agrupar(linhas) {
  let html = "";
  let aberto = false;
  for (const l of linhas) {
    const ehLinha = l.startsWith('<div class="ia-quadro-linha">');
    if (ehLinha && !aberto) html += "<dl>";
    if (!ehLinha && aberto) html += "</dl>";
    aberto = ehLinha;
    html += l;
  }
  return aberto ? `${html}</dl>` : html;
}

/** O quadro de uma consulta (`{nome, dados}`) ou null. */
export function noQuadro(q) {
  const corpo = q?.dados && corpoDo(q.nome, q.dados);
  if (!corpo || (!corpo.html && !corpo.linhas?.length)) return null;
  const el = document.createElement("div");
  el.className = `ia-quadro ia-quadro--${q.nome}`;
  el.innerHTML = `<div class="ia-quadro-titulo">${escapeHtml(corpo.titulo)}</div><div class="ia-quadro-corpo">${corpo.html ?? agrupar(corpo.linhas)}</div>`;
  return el;
}
