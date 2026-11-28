/**
 * Cartão da proposta de ações do assistente (IA-05a, P-123/P-124).
 *
 * O modelo só propõe (backend/app/assistente/acoes.py); quem grava é o
 * clique aqui. Cada item vem com uma caixa de marcar e os campos
 * editáveis na própria linha; item com problema vem desmarcado e com o
 * motivo (o mesmo erro que a tela de origem daria). "aplicar marcados"
 * manda as escolhas + edições; depois disso o cartão trava e oferece
 * "desfazer" — que pergunta antes se a pessoa mexeu em algum item depois.
 *
 * Linhas com `data-item` (não `data-i`: esse é o índice da mensagem no
 * painel, e o painel acha a mensagem por ele).
 *
 * O estado mora no objeto da proposta (`p`), não no DOM: o painel
 * redesenha as mensagens inteiras a cada resposta, e o cartão volta igual.
 *   p = {mensagem_id, itens, estado, aplicados?, lote_id?, marcados?, erros?, confirmando?,
 *        contas?, conta_id?, forma?}
 *
 * F2 (IA-05b): lançamentos usam a conta e a forma do topo do cartão (uma
 * pro lote, P-136); marco e meta do plano dependem da trilha (`depende`)
 * — desmarcar a trilha desmarca e trava os dois (P-138); item com `aviso`
 * (parece repetido, P-129) pode ir, mas vem desmarcado.
 *
 * Edições (2026-11): item com `acao` (alterar, apagar, concluir, reabrir,
 * ordenar) mexe numa coisa que já existe. Alterar mostra os mesmos campos
 * da criação, já com o depois, e uma linha com o antes; os outros mostram
 * só o resumo da coisa (e a nova ordem, no ordenar).
 */
import { aplicarProposta, desfazerLote, descartarProposta, getLote } from "../api/assistente.js";
import { ApiError, varsLegiveis } from "../api/client.js";
import { announce } from "./a11y.js";
import { escapeHtml, fmtData, fmtMoeda } from "./format.js";
import { ATRIBUTOS, diasCurtos, rotuloFrequencia } from "./habito-linha.js";
import { nomeAtributo } from "./textos-sistema.js";
import { localeAtual, t, tOu } from "../i18n.js";

const REPETE_LEMBRETE = () => [
  ["nao", t("lembrete.nao_repete")], ["diario", t("lembrete.todo_dia")], ["dias", t("lembrete.dias_da_semana")],
  ["mensal", t("lembrete.todo_mes")], ["anual", t("lembrete.todo_ano")],
];
const REPETE_EVENTO = () => [
  ["none", t("calendario_evento.nao_repete")], ["daily", t("calendario_evento.diariamente")],
  ["weekly", t("calendario_evento.semanalmente")], ["monthly", t("calendario_evento.mensalmente")],
  ["yearly", t("calendario_evento.anualmente")],
];
const TIPO_LANCAMENTO = () => [["saida", t("transacao.saida")], ["entrada", t("transacao.entrada")]];
const FORMA = () => [["saldo", t("transacao.saldo")], ["credito", t("transacao.credito")]];
const TIPOS_META = ["livre", "financeira", "saude", "leitura", "habito"];
const PESOS = () => [["baixo", t("metas.baixo")], ["medio", t("metas.medio")], ["alto", t("metas.alto")], ["epico", t("metas.epico")]];
// problemas que dependem da conta/forma do topo: trocar lá limpa (o backend confere de novo)
// (pelo fim da chave — a chave inteira começa com a palavra que a catraca
// de textos soltos procura)
const DA_CONTA = [".escolha_a_conta", ".escolha_a_forma", ".conta_sem_saldo"];
const STATUS_TRILHA = () => ["ativa", "pausada", "parada"].map((k) => [k, t(`assistente.proposta.status.${k}`)]);
const STATUS_HABITO = () => ["ativo", "pausado", "arquivado"].map((k) => [k, t(`assistente.proposta.status.${k}`)]);
const FREQUENCIA = () => [
  ["diario", t("habito.todo_dia")], ["dias", t("habito.dias_fixos_da_semana")], ["semana", t("habito.x_vezes_por_semana")],
];

function marcados(p) {
  if (!p.marcados) p.marcados = p.itens.map((item) => !item.problema && !item.aviso);
  return p.marcados;
}

/** Dependente (marco/meta do plano) cuja trilha está desmarcada. */
function semTrilha(p, item) {
  return item.depende != null && !marcados(p)[item.depende];
}

function nomeConta(c) {
  return `${c.banco} · ${c.nome}`;
}

// valor no formato do idioma (vírgula em pt), sem separador de milhar —
// campo de texto (um type=number recusa "99,9")
const valorTexto = (n) =>
  Number.isFinite(n) ? new Intl.NumberFormat(localeAtual(), { maximumFractionDigits: 2, useGrouping: false }).format(n) : "";
const lerValor = (texto) => Number(String(texto).trim().replace(/\s/g, "").replace(",", ".")) || 0;

function campoValor(i, campo, rotulo, valor, travado) {
  return `<label class="ia-prop-campo"><span>${escapeHtml(rotulo)}</span>
    <input type="text" inputmode="decimal" id="${id(i, campo)}" data-campo="${campo}" value="${escapeHtml(valorTexto(valor))}" ${travado ? "disabled" : ""}></label>`;
}

function msgErro(chave, vars) {
  // "falta preencher: {campo}" — o campo vem pela chave interna; aqui vira o rótulo
  const v = vars?.campo ? { ...vars, campo: rotuloCampo({ chave: vars.campo }) } : vars;
  return tOu(chave, t("assistente.proposta.problema"), varsLegiveis(v));
}

// ── 2.1.0: campos descritos pelo backend (entidades.py) ──────────────────
// item.campos = [{chave, tipo, opcoes?, rotulo?}] — o mesmo desenho pra
// contas fixas, assinaturas, renda, carreira, conquistas, transferências…

const rotuloCampo = (c) => tOu(`assistente.proposta.campo.${c.rotulo || c.chave}`, c.rotulo || c.chave);
const rotuloOpcao = (c, v) => (v === "" ? "—" : tOu(`assistente.proposta.opcao.${c.chave}.${v}`, v));
const SIM_NAO = () => [["true", t("assistente.proposta.sim")], ["false", t("assistente.proposta.nao")]];
const comTipo = (html, chave, tipo) => html.replace(`data-campo="${chave}"`, `data-campo="${chave}" data-tipo="${tipo}"`);

function camposGenericos(p, item, i, travado) {
  const d = item.dados;
  return item.campos.filter((c) => valeCampo(c, d)).map((c, k) => {
    const r = rotuloCampo(c);
    const v = d[c.chave];
    let html;
    if (c.tipo === "valor") html = campoValor(i, c.chave, r, v, travado);
    else if (c.tipo === "inteiro" || c.tipo === "dia") html = campoTipo(i, c.chave, r, "number", v ? String(v) : "", travado);
    else if (c.tipo === "data") html = campoTipo(i, c.chave, r, "date", v, travado);
    // AAAA-MM em texto: o seletor de mês nativo não existe no WebKitGTK e sai fora do visual no Chromium
    else if (c.tipo === "mes") html = campoTipo(i, c.chave, r, "text", v, travado).replace("<input ", '<input placeholder="AAAA-MM" maxlength="7" ');
    else if (c.tipo === "escolha") html = campoEscolha(i, c.chave, r, c.opcoes.map((o) => [o, rotuloOpcao(c, o)]), v, travado);
    else if (c.tipo === "sim_nao") html = campoEscolha(i, c.chave, r, SIM_NAO(), String(v !== false), travado);
    else if (c.tipo === "conta") {
      html = campoEscolha(i, c.chave, r, [["", "—"], ...(p.contas || []).map((x) => [x.id, nomeConta(x)])], v || "", travado);
    } else if (c.tipo === "atributo") {
      html = campoEscolha(i, c.chave, r, [["", "—"], ...ATRIBUTOS.map((a) => [a, nomeAtributo(a)])], v || "", travado);
    } else {
      html = campoTexto(i, c.chave, r, v, { max: 200, area: c.tipo === "area", travado });
      if (k > 0 && c.tipo === "texto") html = html.replace("ia-prop-campo--largo", "");
    }
    return comTipo(html, c.chave, c.tipo);
  }).join("");
}

// campo que depende de outro (renda: o dia só vale com "dia fixo") some quando não se aplica
const valeCampo = (c, d) => !c.quando || Object.entries(c.quando).every(([k, vs]) => vs.includes(d[k]));

/** Os campos do backend, formatados como nas telas: [principal, detalhes...]. */
function resumoGenerico(p, campos, d) {
  const fmt = (c) => {
    const v = d[c.chave];
    if (v === "" || v == null || (["inteiro", "valor", "dia"].includes(c.tipo) && !v)) return "";
    if (c.tipo === "valor") return fmtMoeda(v);
    if (c.tipo === "data") return fmtData(v);
    if (c.tipo === "dia") return t("assistente.proposta.dia_n", { n: v });
    if (c.tipo === "escolha") return rotuloOpcao(c, v);
    if (c.tipo === "sim_nao") return v === false ? t("assistente.proposta.inativa") : "";
    if (c.tipo === "conta") { const x = (p.contas || []).find((y) => y.id === v); return x ? nomeConta(x) : ""; }
    if (c.tipo === "atributo") return nomeAtributo(v);
    if (c.tipo === "inteiro") return `${rotuloCampo(c)}: ${v}`;
    return String(v);
  };
  const partes = campos.filter((c) => valeCampo(c, d)).map(fmt);
  // sem o primeiro (transferência sem descrição): o primeiro que houver vira o principal
  const k = partes.findIndex(Boolean);
  return k > 0 ? [partes[k], ...partes.slice(0, k), ...partes.slice(k + 1)] : partes;
}

// ── campos de cada tipo ──────────────────────────────────────────────────

function id(i, campo) {
  return `ia-prop-${i}-${campo}`;
}

function campoTexto(i, campo, rotulo, valor, { max = 200, area = false, travado } = {}) {
  const attrs = `id="${id(i, campo)}" data-campo="${campo}" maxlength="${max}" ${travado ? "disabled" : ""}`;
  const input = area
    ? `<textarea ${attrs} rows="3">${escapeHtml(valor || "")}</textarea>`
    : `<input type="text" ${attrs} value="${escapeHtml(valor || "")}">`;
  return `<label class="ia-prop-campo ia-prop-campo--largo"><span>${escapeHtml(rotulo)}</span>${input}</label>`;
}

function campoTipo(i, campo, rotulo, tipo, valor, travado) {
  return `<label class="ia-prop-campo"><span>${escapeHtml(rotulo)}</span>
    <input type="${tipo}" id="${id(i, campo)}" data-campo="${campo}" value="${escapeHtml(valor || "")}" ${travado ? "disabled" : ""}></label>`;
}

function campoEscolha(i, campo, rotulo, opcoes, valor, travado) {
  return `<label class="ia-prop-campo"><span>${escapeHtml(rotulo)}</span>
    <select id="${id(i, campo)}" data-campo="${campo}" ${travado ? "disabled" : ""}>
      ${opcoes.map(([v, r]) => `<option value="${escapeHtml(v)}" ${v === valor ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
    </select></label>`;
}

function campoDias(i, dias, travado) {
  return `<div class="ia-prop-campo ia-prop-campo--largo" role="group" aria-label="${escapeHtml(t("habito.dias"))}">
    <span>${escapeHtml(t("habito.dias"))}</span>
    <div class="hb-dias">${diasCurtos().map((d, k) => `<label class="hb-dia"><input type="checkbox" data-campo="dias_semana" value="${k}" ${dias.includes(k) ? "checked" : ""} ${travado ? "disabled" : ""}> ${escapeHtml(d)}</label>`).join("")}</div>
  </div>`;
}

function campos(p, item, i, travado) {
  if (item.campos) return camposGenericos(p, item, i, travado);
  const d = item.dados;
  if (item.tipo === "lancamento") {
    return campoTexto(i, "descricao", t("transacao.descricao"), d.descricao, { travado })
      + campoValor(i, "valor", t("transacao.valor"), d.valor, travado)
      + campoEscolha(i, "tipo", t("transacao.tipo"), TIPO_LANCAMENTO(), d.tipo, travado)
      + campoTexto(i, "categoria", t("transacao.categoria"), d.categoria, { max: 60, travado }).replace("ia-prop-campo--largo", "")
      + campoTipo(i, "data", t("assistente.proposta.campo.data"), "date", d.data, travado);
  }
  if (item.tipo === "link") {
    return campoTexto(i, "titulo", t("assistente.proposta.campo.titulo"), d.titulo, { travado })
      + campoTexto(i, "url", t("assistente.proposta.campo.url"), d.url, { max: 500, travado })
      + campoTexto(i, "categoria", t("assistente.proposta.campo.categoria"), d.categoria, { max: 60, travado }).replace("ia-prop-campo--largo", "");
  }
  if (item.tipo === "meta") {
    // aprendizado e acadêmica progridem sozinhas: tipo e alvo não se mexem
    const plano = d.tipo === "aprendizado" || d.tipo === "academica";
    return campoTexto(i, "titulo", t("assistente.proposta.campo.titulo"), d.titulo, { travado })
      + (plano ? "" : campoEscolha(i, "tipo", t("metas.tipo"), TIPOS_META.map((k) => [k, t(`metas.${k}`)]), d.tipo, travado))
      + (plano ? "" : campoValor(i, "alvo", t("metas.alvo"), d.alvo, travado))
      + (plano || d.tipo === "financeira" ? "" : campoTexto(i, "rotulo", t("metas.unidade_opcional"), d.rotulo, { max: 30, travado }).replace("ia-prop-campo--largo", ""))
      + campoTipo(i, "prazo", t("metas.prazo_opcional"), "date", d.prazo, travado)
      + campoEscolha(i, "peso", t("metas.peso_xp"), PESOS(), d.peso, travado)
      + (d.tipo === "financeira" && p.contas?.length
        ? campoEscolha(i, "conta_id", t("assistente.proposta.campo.conta_meta"), [["", "—"], ...p.contas.map((c) => [c.id, nomeConta(c)])], d.conta_id, travado)
        : "");
  }
  if (item.tipo === "trilha") {
    return campoTexto(i, "nome", t("assistente.proposta.campo.titulo"), d.nome, { max: 120, travado })
      + campoTexto(i, "objetivo", t("assistente.proposta.campo.objetivo"), d.objetivo, { max: 500, area: true, travado })
      + (d.status ? campoEscolha(i, "status", t("assistente.proposta.campo.situacao"), STATUS_TRILHA(), d.status, travado) : "");
  }
  if (item.tipo === "marco") {
    return campoTexto(i, "titulo", t("assistente.proposta.campo.titulo"), d.titulo, { travado })
      + (d.data !== undefined ? campoTipo(i, "data", t("assistente.proposta.campo.data_opcional"), "date", d.data, travado) : "")
      + (d.descricao ? campoTexto(i, "descricao", t("assistente.proposta.campo.texto"), d.descricao, { max: 2000, area: true, travado }) : "");
  }
  if (item.tipo === "tarefa") return campoTexto(i, "texto", t("assistente.proposta.campo.tarefa"), d.texto, { max: 500, travado });
  if (item.tipo === "nota") {
    return campoTexto(i, "titulo", t("assistente.proposta.campo.titulo"), d.titulo, { travado })
      + campoTexto(i, "conteudo", t("assistente.proposta.campo.texto"), d.conteudo, { max: 20000, area: true, travado });
  }
  if (item.tipo === "lembrete") {
    return campoTexto(i, "titulo", t("assistente.proposta.campo.titulo"), d.titulo, { travado })
      + campoTipo(i, "data", t("assistente.proposta.campo.data"), "date", d.data, travado)
      + campoTipo(i, "hora", t("assistente.proposta.campo.hora"), "time", d.hora, travado)
      + campoEscolha(i, "repeticao", t("assistente.proposta.campo.repete"), REPETE_LEMBRETE(), d.repeticao, travado)
      + (d.repeticao === "dias" ? campoDias(i, d.dias_semana, travado) : "");
  }
  if (item.tipo === "evento") {
    return campoTexto(i, "titulo", t("assistente.proposta.campo.titulo"), d.titulo, { travado })
      + campoTipo(i, "data", t("assistente.proposta.campo.data"), "date", d.data, travado)
      + campoTipo(i, "hora", t("assistente.proposta.campo.hora"), "time", d.hora, travado)
      + campoEscolha(i, "repeticao", t("assistente.proposta.campo.repete"), REPETE_EVENTO(), d.repeticao, travado)
      + (d.repeticao && d.repeticao !== "none" && d.ate !== undefined ? campoTipo(i, "ate", t("assistente.proposta.campo.ate"), "date", d.ate, travado) : "")
      + (d.aviso !== undefined ? campoTipo(i, "aviso", t("assistente.proposta.campo.aviso"), "number", d.aviso === "" ? "" : String(d.aviso), travado) : "")
      + (d.notas ? campoTexto(i, "notas", t("assistente.proposta.campo.texto"), d.notas, { max: 2000, area: true, travado }) : "");
  }
  // hábito
  return campoTexto(i, "nome", t("assistente.proposta.campo.titulo"), d.nome, { max: 120, travado })
    + campoEscolha(i, "frequencia", t("habito.frequencia"), FREQUENCIA(), d.frequencia, travado)
    + (d.status ? campoEscolha(i, "status", t("assistente.proposta.campo.situacao"), STATUS_HABITO(), d.status, travado) : "")
    + campoEscolha(i, "atributo", t("assistente.proposta.campo.atributo"), ATRIBUTOS.map((a) => [a, nomeAtributo(a)]), d.atributo, travado)
    + (d.frequencia === "dias" ? campoDias(i, d.dias_semana, travado) : "")
    + (d.frequencia === "semana" ? campoTipo(i, "vezes_semana", t("habito.quantas_vezes_por_semana"), "number", String(d.vezes_semana), travado) : "");
}

// ── depois de fechada (retorno do teste da F1): cada item vira uma linha
//    de informação, não um formulário travado ─────────────────────────────

function quando(data, hora) {
  return [data ? fmtData(data) : "", hora || ""].filter(Boolean).join(" ");
}

function rotuloDe(opcoes, valor) {
  return opcoes.find(([v]) => v === valor)?.[1] ?? valor;
}

/** [principal, detalhes...] do item, no formato das telas. `d` = o depois
 *  (ou o antes, pra linha "antes:" de uma edição). */
function resumo(item, d = item.dados, p = null) {
  // campos do backend: os do "depois" (criar/alterar) ou os da coisa (pagar, apagar…)
  const lista = d === item.dados ? item.campos || item.campos_antes
    : item.campos_antes || (item.acao === "alterar" ? item.campos : null);
  if (lista) return resumoGenerico(p, lista, d);
  if (item.tipo === "tarefa") {
    return item.acao ? [d.texto, t(d.feita ? "assistente.proposta.tarefa_feita" : "assistente.proposta.tarefa_aberta")] : [d.texto];
  }
  if (item.tipo === "link") return [d.titulo, d.url, d.categoria];
  if (item.tipo === "nota") {
    const linha = (d.conteudo || "").split("\n").map((l) => l.replace(/^[-*#>\s[\]x]+/, "").trim()).find(Boolean);
    return [d.titulo || linha || "", ...(d.titulo && linha ? [linha] : [])];
  }
  if (item.tipo === "lembrete") {
    const rep = d.repeticao === "dias" ? d.dias_semana.map((k) => diasCurtos()[k]).join(", ") : rotuloDe(REPETE_LEMBRETE(), d.repeticao);
    return [d.titulo, quando(d.data, d.hora), rep];
  }
  if (item.tipo === "evento") {
    return [d.titulo, quando(d.data, d.hora), rotuloDe(REPETE_EVENTO(), d.repeticao),
      d.ate && d.repeticao !== "none" ? t("assistente.proposta.ate_dia", { data: fmtData(d.ate) }) : "",
      d.aviso !== "" && d.aviso != null ? t("assistente.proposta.aviso_min", { n: d.aviso }) : ""];
  }
  if (item.tipo === "lancamento") {
    const sinal = d.tipo === "entrada" ? "+" : "−";
    return [d.descricao, `${sinal} ${fmtMoeda(d.valor)}`, d.categoria, quando(d.data)];
  }
  if (item.tipo === "meta") {
    const alvo = d.tipo === "aprendizado" ? "" : d.tipo === "financeira" ? fmtMoeda(d.alvo) : `${d.alvo}${d.rotulo ? ` ${d.rotulo}` : ""}`;
    return [d.titulo, t(`metas.${d.tipo}`), alvo, d.prazo ? fmtData(d.prazo) : ""];
  }
  const status = d.status ? t(`assistente.proposta.status.${d.status}`) : "";
  if (item.tipo === "trilha") return [d.nome, d.objetivo, status];
  if (item.tipo === "marco") return [d.titulo, d.data ? fmtData(d.data) : "", status];
  return [d.nome, rotuloFrequencia(d), nomeAtributo(d.atributo), status];
}

/** "alterar · trilha" (item que cria não tem `acao`: fica só o tipo, como antes). */
// concluir/reabrir de dinheiro diz o que é: pagar, receber, desmarcar
const PAGA = new Set(["conta_fixa", "assinatura", "divida"]);

function rotuloAcao(item) {
  if (item.acao === "concluir" && (PAGA.has(item.tipo) || item.tipo === "renda")) {
    return t(item.tipo === "renda" ? "assistente.proposta.acao.receber" : "assistente.proposta.acao.pagar");
  }
  if (item.acao === "reabrir" && (PAGA.has(item.tipo) || item.tipo === "renda")) return t("assistente.proposta.acao.despagar");
  return t(`assistente.proposta.acao.${item.acao}`);
}

function rotuloTipo(item) {
  const tipo = t(`assistente.proposta.tipo.${item.tipo}`);
  return item.acao ? `${rotuloAcao(item)} · ${tipo}` : tipo;
}

/** Pagar, receber, contribuir e transferir mexem no saldo: o cartão avisa. */
function mexeNoDinheiro(item) {
  return (item.acao === "concluir" && (PAGA.has(item.tipo) || item.tipo === "renda"))
    || item.acao === "contribuir" || (!item.acao && item.tipo === "transferencia");
}

/** Só o que muda, na linha "antes:" de uma edição. */
function textoAntes(p, item) {
  const antes = resumo(item, item.antes, p);
  const depois = resumo(item, item.dados, p);
  const mudou = antes.filter((v, k) => v && v !== depois[k]);
  return (mudou.length ? mudou : antes.filter(Boolean)).join(" · ");
}

/** O corpo de um item que mexe no que existe e não é "alterar". */
function htmlAlvo(p, item) {
  if (item.acao === "ordenar") {
    return `<div class="ia-prop-ordem"><span>${escapeHtml(item.extra?.nome || "")} — ${escapeHtml(t("assistente.proposta.nova_ordem"))}</span>
      <ol>${item.dados.ordem.map((m) => `<li>${escapeHtml(m.titulo)}</li>`).join("")}</ol></div>`;
  }
  const [principal, ...detalhes] = resumo(item, item.antes, p);
  return `<p class="ia-prop-alvo"><span class="ia-prop-principal">${escapeHtml(principal || "—")}</span>${
    detalhes.filter(Boolean).length ? `<span class="ia-prop-detalhe">${detalhes.filter(Boolean).map(escapeHtml).join(" · ")}</span>` : ""}</p>
    ${item.acao === "excluir" ? `<p class="ia-prop-entrada">${escapeHtml(t("assistente.proposta.vai_apagar"))}</p>` : ""}`;
}

/** Como a coisa fica depois do item (pro resumo da proposta fechada). */
function depoisDe(item) {
  if (item.acao === "concluir" || item.acao === "reabrir") {
    const fim = item.acao === "concluir";
    if (item.tipo === "tarefa") return { ...item.antes, feita: fim };
    if (item.tipo === "marco") return { ...item.antes, status: fim ? "concluido" : "pendente" };
    return item.antes;
  }
  return item.acao && item.acao !== "alterar" ? item.antes : item.dados;
}

function htmlResumo(p, item, i) {
  const feito = p.estado === "aplicada" && (p.aplicados || []).includes(i);
  const [principal, ...detalhes] = item.acao === "ordenar"
    ? [item.extra?.nome, item.dados.ordem.map((m) => m.titulo).join(" → ")]
    : resumo(item, depoisDe(item), p);
  if (item.acao === "contribuir") {  // o valor que entrou na meta vem primeiro
    detalhes.unshift(`+ ${item.antes.tipo === "financeira" ? fmtMoeda(item.dados.valor) : item.dados.valor}`);
  }
  return `<li class="ia-prop-item ia-prop-item--resumo${feito ? "" : " ia-prop-item--fora"}${item.depende != null ? " ia-prop-item--dep" : ""}" data-item="${i}">
    <span class="ia-prop-sinal" aria-hidden="true">${feito ? "[x]" : "[ ]"}</span>
    <span class="ia-prop-tipo"${item.acao ? ` data-acao="${item.acao}"` : ""}>${escapeHtml(rotuloTipo(item))}</span>
    <span class="ia-prop-principal">${escapeHtml(principal || "—")}</span>
    ${detalhes.filter(Boolean).length ? `<span class="ia-prop-detalhe">${detalhes.filter(Boolean).map(escapeHtml).join(" · ")}</span>` : ""}
  </li>`;
}

function htmlItem(p, item, i, travado) {
  if (p.estado !== "pendente") return htmlResumo(p, item, i);
  const orfao = semTrilha(p, item);
  const marcado = marcados(p)[i] && !orfao;
  const falha = p.erros?.[i] || (item.problema ? { chave: item.problema } : null);
  const classes = ["ia-prop-item", falha ? "ia-prop-item--problema" : "", item.aviso && !falha ? "ia-prop-item--aviso" : "",
    !marcado ? "ia-prop-item--fora" : "", item.depende != null ? "ia-prop-item--dep" : ""].filter(Boolean).join(" ");
  const tipo = rotuloTipo(item);
  const acao = item.acao ? ` data-acao="${item.acao}"` : "";
  const corpo = (!item.acao || item.acao === "alterar"
    ? `<div class="ia-prop-campos">${campos(p, item, i, travado)}</div>`
      + (item.acao === "alterar" ? `<p class="ia-prop-antes">${escapeHtml(t("assistente.proposta.antes", { texto: textoAntes(p, item) }))}</p>` : "")
    : htmlAlvo(p, item) + (item.campos ? `<div class="ia-prop-campos">${campos(p, item, i, travado)}</div>` : ""))
    + (mexeNoDinheiro(item) ? `<p class="ia-prop-aviso">${escapeHtml(t("assistente.proposta.mexe_no_dinheiro"))}</p>` : "");
  return `<li class="${classes}" data-item="${i}"${acao}>
    <label class="ia-prop-marca">
      <input type="checkbox" data-prop="marcar" ${marcado ? "checked" : ""} ${travado || orfao ? "disabled" : ""}
        aria-label="${escapeHtml(t("assistente.proposta.marcar", { tipo }))}">
      <span class="ia-prop-tipo"${acao}>${escapeHtml(tipo)}</span>
    </label>
    ${corpo}
    ${item.trilha_nome ? `<p class="ia-prop-entrada">${escapeHtml(t("assistente.proposta.na_trilha", { nome: item.trilha_nome }))}</p>` : ""}
    ${item.entrada ? `<p class="ia-prop-entrada">${escapeHtml(t("assistente.proposta.da_caixa", { texto: item.entrada.texto }))}</p>` : ""}
    ${item.linha ? `<p class="ia-prop-entrada">${escapeHtml(t("assistente.proposta.do_extrato", { texto: item.linha }))}</p>` : ""}
    ${item.aviso && !falha ? `<p class="ia-prop-aviso">${escapeHtml(t(item.aviso))}</p>` : ""}
    ${falha ? `<p class="ia-prop-problema" id="${id(i, "falha")}">${escapeHtml(msgErro(falha.chave, falha.vars))}</p>` : ""}
  </li>`;
}

function htmlRodape(p, carregando) {
  if (p.confirmando) {
    const c = p.confirmando;
    const texto = c.editados
      ? t("assistente.proposta.desfazer_editados", { n: c.intactos, editados: c.editados })
      : t("assistente.proposta.desfazer_confirma", { n: c.intactos });
    return `<div class="ia-prop-confirma" role="group">
      <p>${escapeHtml(texto)}</p>
      <div class="form-actions">
        ${c.intactos || !c.editados ? `<button type="button" class="btn sm danger" data-prop="desfazer-sim">${escapeHtml(c.editados ? t("assistente.proposta.desfazer_resto") : t("assistente.proposta.sim_desfazer"))}</button>` : ""}
        ${c.editados ? `<button type="button" class="btn sm danger" data-prop="desfazer-tudo">${escapeHtml(t("assistente.proposta.desfazer_tudo"))}</button>` : ""}
        <button type="button" class="btn sm" data-prop="desfazer-nao">${escapeHtml(t("geral.cancelar"))}</button>
      </div>
    </div>`;
  }
  if (p.estado === "pendente") {
    const n = contarMarcados(p);
    return `<div class="form-actions">
      <button type="button" class="btn sm primary" data-prop="aplicar" ${n && !carregando && !p.ocupado ? "" : "disabled"}>${escapeHtml(t("assistente.proposta.aplicar", { n }))}</button>
      <button type="button" class="btn sm" data-prop="descartar" ${carregando || p.ocupado ? "disabled" : ""}>${escapeHtml(t("assistente.proposta.descartar"))}</button>
    </div>`;
  }
  if (p.estado === "aplicada") {
    return `<div class="ia-prop-fim">
      <span>${escapeHtml(t("assistente.proposta.aplicada", { n: (p.aplicados || []).length }))}</span>
      <button type="button" class="ia-acao" data-prop="desfazer" ${p.ocupado ? "disabled" : ""}>${escapeHtml(t("assistente.proposta.desfazer"))}</button>
    </div>`;
  }
  return `<div class="ia-prop-fim"><span>${escapeHtml(t(`assistente.proposta.${p.estado}`))}</span></div>`;
}

function contarMarcados(p) {
  return p.itens.filter((item, i) => marcados(p)[i] && !semTrilha(p, item)).length;
}

/** P-136: conta e forma de pagamento dos lançamentos, uma pro lote. */
function htmlConta(p, travado) {
  if (!p.itens.some((item) => item.tipo === "lancamento" && !item.acao)) return ""; // editar mantém a conta
  if (!p.contas?.length) return `<p class="ia-prop-problema">${escapeHtml(t("erro.assistente.escolha_a_conta"))}</p>`;
  const conta = p.contas.find((c) => c.id === p.conta_id);
  const opcoes = [...(conta ? [] : [["", "—"]]), ...p.contas.map((c) => [c.id, nomeConta(c)])];
  return `<div class="ia-prop-campos ia-prop-conta">
      ${campoEscolha("lote", "conta_id", t("transacao.conta"), opcoes, p.conta_id || "", travado).replace('data-campo="conta_id"', 'data-lote="conta_id"')}
      ${conta?.saldo && conta?.credito
        ? campoEscolha("lote", "forma", t("transacao.forma_de_pagamento"), [...(p.forma ? [] : [["", "—"]]), ...FORMA()], p.forma || "", travado).replace('data-campo="forma"', 'data-lote="forma"')
        : ""}
    </div>`;
}

function html(p, carregando) {
  const travado = p.estado !== "pendente" || carregando || p.ocupado;
  return `
    <div class="ia-prop-cab">
      <b>${escapeHtml(t("assistente.proposta.titulo"))}</b>
      <span>${escapeHtml(t("assistente.proposta.itens", { n: p.itens.length }))}</span>
    </div>
    ${p.estado === "pendente" ? `<p class="ia-nota">${escapeHtml(t("assistente.proposta.dica"))}</p>${htmlConta(p, travado)}` : ""}
    <ul class="ia-prop-itens">${p.itens.map((item, i) => htmlItem(p, item, i, travado)).join("")}</ul>
    ${p.erroGeral ? `<p class="ia-falha" role="alert">${escapeHtml(p.erroGeral.chave ? msgErro(p.erroGeral.chave, p.erroGeral.vars) : p.erroGeral.detail)}</p>` : ""}
    ${htmlRodape(p, carregando)}`;
}

// ── comportamento ────────────────────────────────────────────────────────

function lerCampo(p, alvo) {
  const li = alvo.closest(".ia-prop-item");
  const i = Number(li.dataset.item);
  const d = p.itens[i].dados;
  const campo = alvo.dataset.campo;
  if (campo === "dias_semana") {
    d.dias_semana = [...li.querySelectorAll('[data-campo="dias_semana"]:checked')].map((c) => Number(c.value));
  } else if (campo === "valor" || campo === "alvo") {
    d[campo] = lerValor(alvo.value);
  } else if (campo === "vezes_semana") {
    d.vezes_semana = Math.min(7, Math.max(1, Number(alvo.value) || 1));
  } else if (alvo.dataset.tipo === "valor") {
    d[campo] = lerValor(alvo.value);
  } else if (alvo.dataset.tipo === "inteiro" || alvo.dataset.tipo === "dia") {
    d[campo] = Math.max(0, Math.trunc(Number(alvo.value) || 0));
  } else if (alvo.dataset.tipo === "sim_nao") {
    d[campo] = alvo.value === "true";
  } else {
    d[campo] = alvo.value;
  }
  // editou: o problema antigo pode não valer mais — o backend confere de novo
  p.itens[i].problema = null;
  if (p.erros) delete p.erros[i];
  return { i, mudouForma: ["repeticao", "frequencia", "tipo"].includes(campo) || alvo.dataset.tipo === "escolha" };
}

function erroDe(err) {
  return err instanceof ApiError && err.body?.chave ? { chave: err.body.chave, vars: err.body.vars } : { chave: "", detail: err.message };
}

/**
 * O cartão de uma proposta. `opcoes`: {conversaId, carregando, aoMudar(p)}.
 * `aoMudar` avisa o painel (que guarda `p` na mensagem) depois de aplicar,
 * descartar ou desfazer.
 */
export function noProposta(p, { conversaId, carregando = false, aoMudar = () => {} } = {}) {
  const box = document.createElement("section");
  box.className = `ia-proposta ia-proposta--${p.estado}`;
  box.setAttribute("aria-label", t("assistente.proposta.titulo"));
  const redesenhar = (foco) => {
    box.className = `ia-proposta ia-proposta--${p.estado}`;
    box.innerHTML = html(p, carregando);
    if (foco) box.querySelector(foco)?.focus();
  };
  redesenhar();

  box.addEventListener("change", (e) => {
    const alvo = e.target;
    if (alvo.dataset.lote) {
      p[alvo.dataset.lote] = alvo.value || null;
      if (alvo.dataset.lote === "conta_id") {
        const c = p.contas.find((x) => x.id === p.conta_id);
        if (!(c?.saldo && c?.credito)) p.forma = null;
      }
      for (const item of p.itens) if (DA_CONTA.some((fim) => item.problema?.endsWith(fim))) item.problema = null;
      p.erros = null;
      redesenhar(`#${id("lote", alvo.dataset.lote)}`);
      return;
    }
    if (alvo.dataset.prop === "marcar") {
      marcados(p)[Number(alvo.closest(".ia-prop-item").dataset.item)] = alvo.checked;
      redesenhar(`.ia-prop-item[data-item="${alvo.closest(".ia-prop-item").dataset.item}"] [data-prop="marcar"]`);
      return;
    }
    if (!alvo.dataset.campo) return;
    const { i, mudouForma } = lerCampo(p, alvo);
    if (mudouForma) redesenhar(`#${id(i, alvo.dataset.campo)}`);
  });
  box.addEventListener("input", (e) => {
    if (e.target.dataset.campo && e.target.matches("input[type=text], input[type=number], textarea")) lerCampo(p, e.target);
  });

  box.addEventListener("click", async (e) => {
    const botao = e.target.closest("[data-prop]");
    if (!botao || botao.disabled || botao.dataset.prop === "marcar") return;
    const acao = botao.dataset.prop;
    const ref = { conversa_id: conversaId, mensagem_id: p.mensagem_id };
    if (acao === "aplicar") {
      p.ocupado = true;
      p.erroGeral = null;
      redesenhar();
      try {
        const itens = p.itens.map((item, i) => (marcados(p)[i] && !semTrilha(p, item) ? { indice: i, dados: item.dados } : null)).filter(Boolean);
        const conta = p.contas ? { conta_id: p.conta_id || null, forma_pagamento: p.forma || "" } : {};
        const r = await aplicarProposta({ ...ref, itens, ...conta });
        // livre ANTES de avisar o painel: ele redesenha a conversa e o
        // cartão novo nasce do estado de `p`
        Object.assign(p, r.proposta, { erros: null, erroGeral: null, ocupado: false });
        announce(t("assistente.proposta.aplicada", { n: r.proposta.aplicados.length }));
        aoMudar(p);
      } catch (err) {
        const erro = erroDe(err);
        const i = err.body?.vars?.indice;
        if (Number.isInteger(i)) p.erros = { ...(p.erros || {}), [i]: erro };
        else p.erroGeral = erro;
        announce(erro.chave ? msgErro(erro.chave, erro.vars) : erro.detail);
      } finally {
        p.ocupado = false;
        redesenhar(p.erros ? `.ia-prop-item--problema input, .ia-prop-item--problema textarea` : null);
      }
    } else if (acao === "descartar") {
      try {
        Object.assign(p, (await descartarProposta(ref)).proposta);
        aoMudar(p);
      } catch (err) {
        announce(erroDe(err).detail || msgErro(erroDe(err).chave));
      }
      redesenhar();
    } else if (acao === "desfazer") {
      p.ocupado = true;
      redesenhar();
      try {
        const lote = await getLote(p.lote_id);
        const conta = (s) => lote.itens.filter((x) => x.situacao === s).length;
        p.confirmando = { intactos: conta("intacto"), editados: conta("editado") };
      } catch (err) {
        announce(erroDe(err).detail || msgErro(erroDe(err).chave));
      }
      p.ocupado = false;
      redesenhar(".ia-prop-confirma button");
    } else if (acao === "desfazer-nao") {
      p.confirmando = null;
      redesenhar('[data-prop="desfazer"]');
    } else if (acao === "desfazer-sim" || acao === "desfazer-tudo") {
      p.ocupado = true;
      p.confirmando = null;
      redesenhar();
      try {
        const r = await desfazerLote(p.lote_id, acao === "desfazer-tudo");
        Object.assign(p, { estado: "desfeita", ocupado: false });
        announce(t("assistente.proposta.desfeito", { n: r.desfeitos, mantidos: r.mantidos }));
        aoMudar(p);
      } catch (err) {
        announce(erroDe(err).detail || msgErro(erroDe(err).chave));
      }
      p.ocupado = false;
      redesenhar();
    }
  });
  return box;
}
