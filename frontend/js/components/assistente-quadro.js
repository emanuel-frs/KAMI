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

const secao = (titulo) => `<div class="ia-quadro-secao">${escapeHtml(titulo)}</div>`;
const vazio = (texto) => `<p class="ia-quadro-vazio">${escapeHtml(texto)}</p>`;

function linhasHabitos(habitos) {
  if (!habitos.length) return [vazio(t("assistente.quadro.sem_habitos"))];
  return habitos.map((h) => linha(h.name,
    [t("assistente.quadro.sequencia", { n: h.streak ?? 0 }), t("assistente.quadro.trinta_dias", { pct: h.success_30d_pct ?? 0 })].join(" · "),
    h.done_today ? t("assistente.quadro.feito_hoje") : "", h.streak ? "entra" : ""));
}

function linhasAprendizado(a) {
  const out = [linha(t("assistente.quadro.marcos_mes"), String(a.milestones_completed_this_month ?? 0), "",
    a.milestones_completed_this_month ? "entra" : "")];
  const trilhas = a.tracks || [];
  if (!trilhas.length) out.push(vazio(t("assistente.quadro.sem_trilhas")));
  for (const tr of trilhas.slice(0, MAX_METAS)) out.push(blocoComBarra(tr.track, tr.progress_pct, null, []));
  return out;
}

/** Valor do mês com o do mês anterior ao lado (seta pra cima/baixo). */
function comAnterior(rotulo, agora, antes, prefixo = "") {
  const extra = antes == null ? "" : t("assistente.quadro.mes_anterior", { valor: `${prefixo}${antes}` });
  const tom = antes == null || agora === antes ? "" : agora > antes ? "entra" : "sai";
  const seta = tom === "entra" ? " ↑" : tom === "sai" ? " ↓" : "";
  return linha(rotulo, `${prefixo}${agora ?? 0}${seta}`, extra, tom);
}

function linhasProgresso(p) {
  const ant = p.previous_month || {};
  const out = [
    comAnterior(t("assistente.quadro.xp"), p.xp_gained ?? 0, ant.xp_gained, "+"),
    comAnterior(t("assistente.quadro.dias_ativos"), p.active_days ?? 0, ant.active_days),
    linha(t("assistente.quadro.missoes"), String(p.missions_completed ?? 0)),
  ];
  const conquistas = p.achievements_unlocked || [];
  if (conquistas.length) out.push(linha(t("assistente.quadro.conquistas"), String(conquistas.length), conquistas.join(", "), "previsto"));
  return out;
}

function linhasMetas(metas) {
  const ativas = (metas || []).filter((g) => g.status === "ativa");
  if (!ativas.length) return [vazio(t("assistente.quadro.sem_metas"))];
  const out = ativas.slice(0, MAX_METAS).map(linhaMeta);
  if (ativas.length > MAX_METAS) out.push(vazio(t("assistente.quadro.mais_metas", { n: ativas.length - MAX_METAS })));
  return out;
}

function corpoDo(nome, d) {
  if (nome === "finance_summary") return { titulo: fmtMesAno(d.month), linhas: linhasFinancas(d, d.expected_income) };
  if (nome === "goals") return { titulo: t("assistente.quadro.metas"), linhas: linhasMetas(d.goals) };
  if (nome === "month_overview") {
    // uma seção por área liberada (as desligadas nem chegam aqui)
    const linhas = [];
    if (d.finances) linhas.push(secao(t("assistente.quadro.secao.financas")), ...linhasFinancas(d.finances));
    if (d.goals) linhas.push(secao(t("assistente.quadro.metas")), ...linhasMetas(d.goals));
    if (d.habits) linhas.push(secao(t("assistente.quadro.habitos")), ...linhasHabitos(d.habits));
    if (d.learning) linhas.push(secao(t("assistente.quadro.secao.aprendizado")), ...linhasAprendizado(d.learning));
    if (d.progress) linhas.push(secao(t("assistente.quadro.secao.progresso")), ...linhasProgresso(d.progress));
    return { titulo: fmtMesAno(d.month), linhas };
  }
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
  if (!corpo?.linhas.length) return null;
  const el = document.createElement("div");
  el.className = "ia-quadro";
  el.innerHTML = `<div class="ia-quadro-titulo">${escapeHtml(corpo.titulo)}</div><div class="ia-quadro-corpo">${agrupar(corpo.linhas)}</div>`;
  return el;
}
