/**
 * Configurações › assistente › ações do assistente (IA-05a, P-124).
 *
 * Cada lote é uma proposta que a pessoa aplicou: quando, o que foi criado
 * e como cada item está agora (como foi criado, mexido depois, já apagado).
 * "desfazer" funciona igual ao do cartão no chat — pergunta antes se algum
 * item foi mexido (esses ficam, a não ser que a pessoa peça) — e não tem
 * prazo. A lista vale também pras conversas já apagadas ou não guardadas.
 */
import { desfazerLote, getLotes } from "../../api/assistente.js";
import { ApiError } from "../../api/client.js";
import { atualizarTelaAtras } from "../../components/assistente-painel.js";
import { escapeHtml, fmtDataHora } from "../../components/format.js";
import { icon } from "../../components/icons.js";
import { t, tOu } from "../../i18n.js";

const ITENS_VISIVEIS = 4;

let lotes = [];
let confirmando = null; // {id, intactos, editados}

export function lotesSectionHtml() {
  return `
      <div class="settings-section">
        <h4>${t("assistente.lotes.titulo")}</h4>
        <p class="settings-desc">${t("assistente.lotes.desc")}</p>
        <div id="cfg-ia-lotes"></div>
        <p class="settings-status" id="cfg-ia-lotes-status" role="status"></p>
      </div>`;
}

function textoDoErro(err) {
  const chave = err instanceof ApiError ? err.body?.chave : null;
  return escapeHtml(chave ? tOu(chave, err.message, err.body?.vars) : err.message);
}

function itensHtml(lote) {
  const mostrar = lote.itens.slice(0, ITENS_VISIVEIS).map((i) => {
    const situacao = lote.desfeito_em || i.situacao === "intacto" ? "" : ` <small>(${escapeHtml(t(`assistente.lotes.situacao.${i.situacao}`))})</small>`;
    return `<li>${escapeHtml(t(`assistente.proposta.tipo.${i.tipo}`))}: ${escapeHtml(i.titulo || "—")}${situacao}</li>`;
  });
  const resto = lote.itens.length - ITENS_VISIVEIS;
  if (resto > 0) mostrar.push(`<li class="settings-note">${escapeHtml(t("assistente.lotes.mais", { n: resto }))}</li>`);
  return `<ul class="cfg-ia-lote-itens">${mostrar.join("")}</ul>`;
}

function confirmaHtml(c) {
  const texto = c.editados
    ? t("assistente.proposta.desfazer_editados", { n: c.intactos, editados: c.editados })
    : t("assistente.proposta.desfazer_confirma", { n: c.intactos });
  return `<div class="ia-prop-confirma">
      <p>${escapeHtml(texto)}</p>
      <div class="form-actions">
        ${c.intactos || !c.editados ? `<button type="button" class="btn sm danger" data-lote="sim">${escapeHtml(c.editados ? t("assistente.proposta.desfazer_resto") : t("assistente.proposta.sim_desfazer"))}</button>` : ""}
        ${c.editados ? `<button type="button" class="btn sm danger" data-lote="tudo">${escapeHtml(t("assistente.proposta.desfazer_tudo"))}</button>` : ""}
        <button type="button" class="btn sm" data-lote="nao">${escapeHtml(t("geral.cancelar"))}</button>
      </div>
    </div>`;
}

function render(wrap) {
  const box = wrap.querySelector("#cfg-ia-lotes");
  if (!box) return;
  if (!lotes.length) {
    box.innerHTML = `<p class="settings-note">${escapeHtml(t("assistente.lotes.nenhum"))}</p>`;
    return;
  }
  box.innerHTML = `<ul class="cfg-ia-lotes">${lotes.map((l) => {
    const vivos = l.itens.filter((i) => i.situacao !== "sumiu").length;
    const estado = l.desfeito_em
      ? `<span class="cfg-ia-lote-estado">${escapeHtml(t("assistente.lotes.desfeito_em", { quando: fmtDataHora(l.desfeito_em) }))}</span>`
      : vivos
        ? `<button type="button" class="btn sm" data-lote="desfazer" data-id="${escapeHtml(l.id)}">${icon("undo", { size: 12 })} ${escapeHtml(t("assistente.proposta.desfazer"))}</button>`
        : `<span class="cfg-ia-lote-estado">${escapeHtml(t("assistente.lotes.nada_restou"))}</span>`;
    return `<li class="cfg-ia-lote" data-id="${escapeHtml(l.id)}">
        <div class="cfg-ia-lote-cab">
          <span>${escapeHtml(fmtDataHora(l.aplicado_em))} · ${escapeHtml(t("assistente.proposta.itens", { n: l.itens.length }))}</span>
          ${estado}
        </div>
        ${itensHtml(l)}
        ${confirmando?.id === l.id ? confirmaHtml(confirmando) : ""}
      </li>`;
  }).join("")}</ul>`;
}

function status(wrap, html, erro = false) {
  const el = wrap.querySelector("#cfg-ia-lotes-status");
  if (!el) return;
  el.innerHTML = html;
  el.classList.toggle("is-error", erro);
}

export async function carregarLotes(wrap) {
  try {
    lotes = await getLotes();
    confirmando = null;
    render(wrap);
  } catch (err) {
    status(wrap, textoDoErro(err), true);
  }
}

async function desfazer(wrap, id, apagarEditados) {
  confirmando = null;
  try {
    const r = await desfazerLote(id, apagarEditados);
    status(wrap, `${icon("check", { size: 12 })} ${escapeHtml(t("assistente.proposta.desfeito", { n: r.desfeitos, mantidos: r.mantidos }))}`);
    atualizarTelaAtras();
  } catch (err) {
    status(wrap, textoDoErro(err), true);
  }
  await carregarLotes(wrap);
  wrap.querySelector(`.cfg-ia-lote[data-id="${CSS.escape(id)}"] .cfg-ia-lote-cab`)?.setAttribute("tabindex", "-1");
  wrap.querySelector(`.cfg-ia-lote[data-id="${CSS.escape(id)}"] .cfg-ia-lote-cab`)?.focus();
}

export function wireLotes(wrap) {
  wrap.querySelector("#cfg-ia-lotes")?.addEventListener("click", (e) => {
    const botao = e.target.closest("[data-lote]");
    if (!botao) return;
    const acao = botao.dataset.lote;
    if (acao === "desfazer") {
      const lote = lotes.find((l) => l.id === botao.dataset.id);
      const conta = (s) => lote.itens.filter((i) => i.situacao === s).length;
      confirmando = { id: lote.id, intactos: conta("intacto"), editados: conta("editado") };
      render(wrap);
      wrap.querySelector(`.cfg-ia-lote[data-id="${CSS.escape(lote.id)}"] .ia-prop-confirma button`)?.focus();
    } else if (acao === "nao") {
      const id = confirmando?.id;
      confirmando = null;
      render(wrap);
      wrap.querySelector(`[data-lote="desfazer"][data-id="${CSS.escape(id || "")}"]`)?.focus();
    } else if (acao === "sim" || acao === "tudo") {
      desfazer(wrap, confirmando.id, acao === "tudo");
    }
  });
}
