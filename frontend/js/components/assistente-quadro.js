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

const linha = (rotulo, valor, extra = "") =>
  `<div class="ia-quadro-linha"><dt>${escapeHtml(rotulo)}</dt><dd>${escapeHtml(valor)}${extra ? ` <span class="ia-quadro-extra">${escapeHtml(extra)}</span>` : ""}</dd></div>`;

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
  const out = [linha(t("assistente.quadro.entrou"), fmtMoeda(f.income || 0), f.income ? "" : t("assistente.quadro.nada_ainda"))];
  const maior = c.biggest_category;
  out.push(linha(t("assistente.quadro.saiu"), fmtMoeda(f.expenses || 0),
    maior ? t("assistente.quadro.maior_categoria", { categoria: maior.category, pct: pct(maior.share_of_expenses_pct).replace("+", "") }) : ""));
  if (f.net_this_month != null) {
    out.push(linha(t("assistente.quadro.resultado"), fmtMoeda(f.net_this_month),
      c.kept_pct_of_income != null ? t("assistente.quadro.da_renda", { pct: pct(c.kept_pct_of_income) }) : ""));
  }
  if (c.expenses_vs_previous_month_pct != null) {
    out.push(linha(t("assistente.quadro.vs_mes_passado"), pct(c.expenses_vs_previous_month_pct)));
  }
  const previsto = previstoTexto(entradas);
  if (previsto) out.push(linha(t("assistente.quadro.previsto"), previsto[0], previsto[1]));
  else if (c.income_still_expected) out.push(linha(t("assistente.quadro.previsto"), fmtMoeda(c.income_still_expected)));
  if (f.accounts_total_available != null) out.push(linha(t("assistente.quadro.nas_contas"), fmtMoeda(f.accounts_total_available)));
  return out;
}

function valorMeta(g, v) {
  return g.unit === "money" ? fmtMoeda(v || 0) : `${v ?? 0}${g.unit && g.unit !== "count" ? ` ${g.unit}` : ""}`;
}

function linhaMeta(g) {
  const partes = [`${g.progress_pct ?? 0}%`];
  if (SITUACOES[g.situation]) partes.push(t(`assistente.quadro.situacao.${SITUACOES[g.situation]}`));
  if (g.remaining) partes.push(t("assistente.quadro.falta", { valor: valorMeta(g, g.remaining) }));
  if (g.needed_per_week) partes.push(t("assistente.quadro.por_semana", { valor: valorMeta(g, g.needed_per_week) }));
  if (g.deadline && g.situation !== "done") partes.push(t("assistente.quadro.ate", { data: fmtDataCompacta(g.deadline) }));
  return linha(g.title, partes.join(" · "));
}

function linhasMetas(metas) {
  const ativas = (metas || []).filter((g) => g.status === "ativa");
  if (!ativas.length) return [`<p class="ia-quadro-vazio">${escapeHtml(t("assistente.quadro.sem_metas"))}</p>`];
  const out = ativas.slice(0, MAX_METAS).map(linhaMeta);
  if (ativas.length > MAX_METAS) out.push(`<p class="ia-quadro-vazio">${escapeHtml(t("assistente.quadro.mais_metas", { n: ativas.length - MAX_METAS }))}</p>`);
  return out;
}

function corpoDo(nome, d) {
  if (nome === "finance_summary") return { titulo: fmtMesAno(d.month), linhas: linhasFinancas(d, d.expected_income) };
  if (nome === "goals") return { titulo: t("assistente.quadro.metas"), linhas: linhasMetas(d.goals) };
  if (nome === "month_overview") {
    const linhas = [];
    if (d.finances) linhas.push(...linhasFinancas(d.finances));
    if (d.goals) linhas.push(...linhasMetas(d.goals));
    if (d.habits) linhas.push(linha(t("assistente.quadro.habitos"), String(d.habits.length)));
    if (d.progress) linhas.push(linha(t("assistente.quadro.xp"), `+${d.progress.xp_gained ?? 0}`));
    return { titulo: fmtMesAno(d.month), linhas };
  }
  return null;
}

/** O quadro de uma consulta (`{nome, dados}`) ou null. */
export function noQuadro(q) {
  const corpo = q?.dados && corpoDo(q.nome, q.dados);
  if (!corpo?.linhas.length) return null;
  const el = document.createElement("div");
  el.className = "ia-quadro";
  el.innerHTML = `<div class="ia-quadro-titulo">${escapeHtml(corpo.titulo)}</div><dl>${corpo.linhas.join("")}</dl>`;
  return el;
}
