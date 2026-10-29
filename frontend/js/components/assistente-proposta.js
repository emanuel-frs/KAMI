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
 *   p = {mensagem_id, itens, estado, aplicados?, lote_id?, marcados?, erros?, confirmando?}
 */
import { aplicarProposta, desfazerLote, descartarProposta, getLote } from "../api/assistente.js";
import { ApiError } from "../api/client.js";
import { announce } from "./a11y.js";
import { escapeHtml, fmtData } from "./format.js";
import { ATRIBUTOS, diasCurtos, rotuloFrequencia } from "./habito-linha.js";
import { nomeAtributo } from "./textos-sistema.js";
import { t, tOu } from "../i18n.js";

const REPETE_LEMBRETE = () => [
  ["nao", t("lembrete.nao_repete")], ["diario", t("lembrete.todo_dia")], ["dias", t("lembrete.dias_da_semana")],
  ["mensal", t("lembrete.todo_mes")], ["anual", t("lembrete.todo_ano")],
];
const REPETE_EVENTO = () => [
  ["none", t("calendario_evento.nao_repete")], ["daily", t("calendario_evento.diariamente")],
  ["weekly", t("calendario_evento.semanalmente")], ["monthly", t("calendario_evento.mensalmente")],
  ["yearly", t("calendario_evento.anualmente")],
];
const FREQUENCIA = () => [
  ["diario", t("habito.todo_dia")], ["dias", t("habito.dias_fixos_da_semana")], ["semana", t("habito.x_vezes_por_semana")],
];

function marcados(p) {
  if (!p.marcados) p.marcados = p.itens.map((item) => !item.problema);
  return p.marcados;
}

function msgErro(chave, vars) {
  return tOu(chave, t("assistente.proposta.problema"), vars || {});
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

function campos(item, i, travado) {
  const d = item.dados;
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
      + (d.notas ? campoTexto(i, "notas", t("assistente.proposta.campo.texto"), d.notas, { max: 2000, area: true, travado }) : "");
  }
  // hábito
  return campoTexto(i, "nome", t("assistente.proposta.campo.titulo"), d.nome, { max: 120, travado })
    + campoEscolha(i, "frequencia", t("habito.frequencia"), FREQUENCIA(), d.frequencia, travado)
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

/** [principal, detalhes...] do item, no formato das telas. */
function resumo(item) {
  const d = item.dados;
  if (item.tipo === "tarefa") return [d.texto];
  if (item.tipo === "nota") {
    const linha = (d.conteudo || "").split("\n").map((l) => l.replace(/^[-*#>\s[\]x]+/, "").trim()).find(Boolean);
    return [d.titulo || linha || "", ...(d.titulo && linha ? [linha] : [])];
  }
  if (item.tipo === "lembrete") {
    const rep = d.repeticao === "dias" ? d.dias_semana.map((k) => diasCurtos()[k]).join(", ") : rotuloDe(REPETE_LEMBRETE(), d.repeticao);
    return [d.titulo, quando(d.data, d.hora), rep];
  }
  if (item.tipo === "evento") return [d.titulo, quando(d.data, d.hora), rotuloDe(REPETE_EVENTO(), d.repeticao)];
  return [d.nome, rotuloFrequencia(d), nomeAtributo(d.atributo)];
}

function htmlResumo(p, item, i) {
  const feito = p.estado === "aplicada" && (p.aplicados || []).includes(i);
  const [principal, ...detalhes] = resumo(item);
  return `<li class="ia-prop-item ia-prop-item--resumo${feito ? "" : " ia-prop-item--fora"}" data-item="${i}">
    <span class="ia-prop-sinal" aria-hidden="true">${feito ? "[x]" : "[ ]"}</span>
    <span class="ia-prop-tipo">${escapeHtml(t(`assistente.proposta.tipo.${item.tipo}`))}</span>
    <span class="ia-prop-principal">${escapeHtml(principal || "—")}</span>
    ${detalhes.filter(Boolean).length ? `<span class="ia-prop-detalhe">${detalhes.filter(Boolean).map(escapeHtml).join(" · ")}</span>` : ""}
  </li>`;
}

function htmlItem(p, item, i, travado) {
  if (p.estado !== "pendente") return htmlResumo(p, item, i);
  const marcado = marcados(p)[i];
  const aplicado = p.estado !== "pendente" && (p.aplicados || []).includes(i);
  const falha = p.erros?.[i] || (item.problema ? { chave: item.problema } : null);
  const classes = ["ia-prop-item", falha ? "ia-prop-item--problema" : "", !travado && !marcado ? "ia-prop-item--fora" : "",
    travado && !aplicado ? "ia-prop-item--fora" : ""].filter(Boolean).join(" ");
  const tipo = t(`assistente.proposta.tipo.${item.tipo}`);
  return `<li class="${classes}" data-item="${i}">
    <label class="ia-prop-marca">
      <input type="checkbox" data-prop="marcar" ${(travado ? aplicado : marcado) ? "checked" : ""} ${travado ? "disabled" : ""}
        aria-label="${escapeHtml(t("assistente.proposta.marcar", { tipo }))}">
      <span class="ia-prop-tipo">${escapeHtml(tipo)}</span>
    </label>
    <div class="ia-prop-campos">${campos(item, i, travado)}</div>
    ${item.entrada ? `<p class="ia-prop-entrada">${escapeHtml(t("assistente.proposta.da_caixa", { texto: item.entrada.texto }))}</p>` : ""}
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
    const n = marcados(p).filter(Boolean).length;
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

function html(p, carregando) {
  const travado = p.estado !== "pendente" || carregando || p.ocupado;
  return `
    <div class="ia-prop-cab">
      <b>${escapeHtml(t("assistente.proposta.titulo"))}</b>
      <span>${escapeHtml(t("assistente.proposta.itens", { n: p.itens.length }))}</span>
    </div>
    ${p.estado === "pendente" ? `<p class="ia-nota">${escapeHtml(t("assistente.proposta.dica"))}</p>` : ""}
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
  } else if (campo === "vezes_semana") {
    d.vezes_semana = Math.min(7, Math.max(1, Number(alvo.value) || 1));
  } else {
    d[campo] = alvo.value;
  }
  // editou: o problema antigo pode não valer mais — o backend confere de novo
  p.itens[i].problema = null;
  if (p.erros) delete p.erros[i];
  return { i, mudouForma: campo === "repeticao" || campo === "frequencia" };
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
    if (e.target.matches("input[type=text], textarea")) lerCampo(p, e.target);
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
        const itens = marcados(p).map((m, i) => (m ? { indice: i, dados: p.itens[i].dados } : null)).filter(Boolean);
        const r = await aplicarProposta({ ...ref, itens });
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
