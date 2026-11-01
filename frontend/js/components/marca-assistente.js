/**
 * "· assistente" discreto no que foi criado por um lote do assistente
 * (IA-05, P-126) — na linha/cartão e no modal de editar. Sem filtro novo
 * nas telas: a lista de lotes (configurações › assistente) já filtra.
 */
import { escapeHtml } from "./format.js";
import { t } from "../i18n.js";

export const criadoPeloAssistente = (item) => item?.criado_por === "assistente";

export function marcaAssistente(item) {
  if (!criadoPeloAssistente(item)) return "";
  return `<span class="ia-marca" data-tooltip="${escapeHtml(t("assistente.marca_dica"))}">· ${escapeHtml(t("assistente.marca"))}</span>`;
}

/** Nos modais (cabeçalho com o título em textContent): um span irmão. */
export function marcaNoCabecalho(tituloEl, item) {
  let el = tituloEl.parentNode.querySelector(":scope > .ia-marca");
  if (!el) {
    el = document.createElement("span");
    el.className = "ia-marca";
    el.dataset.tooltip = t("assistente.marca_dica");
    el.textContent = `· ${t("assistente.marca")}`;
    tituloEl.after(el);
  }
  el.hidden = !criadoPeloAssistente(item);
}
