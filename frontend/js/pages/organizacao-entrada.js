/**
 * pages/organizacao-entrada.js — aba "entrada" da Organização (ORG-02).
 *
 * O que foi capturado com Alt+Q sem prefixo fica aqui até virar alguma
 * coisa: gasto, tarefa, nota, meta ou evento (components/captura.js
 * abre o formulário já preenchido) — ou ser descartado. A aba mostra a
 * contagem no rótulo, e o sino de notificações também.
 */
import { listEntrada, descartarEntrada } from "../api/entrada.js";
import { converterItem, TIPOS_CONVERSAO } from "../components/captura.js";
import { icon } from "../components/icons.js";
import { escapeHtml, fmtDataCurta, localDateKey } from "../components/format.js";
import { t } from "../i18n.js";

let raiz = null;
let itens = [];
let aoContar = null;

function quando(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? hh : `${fmtDataCurta(localDateKey(d))} ${hh}`;
}

function desenhar() {
  if (!raiz) return;
  aoContar?.(itens.length);
  const lista = raiz.querySelector("#entrada-lista");
  if (!itens.length) {
    lista.innerHTML = `<div class="empty-state">${t("organizacao_entrada.vazia", { atalho: "<kbd>Alt</kbd>+<kbd>Q</kbd>" })}</div>`;
    return;
  }
  lista.innerHTML = itens
    .map(
      (it) => `
      <div class="entrada-item" data-entrada-id="${escapeHtml(it.id)}">
        <div class="entrada-texto">${escapeHtml(it.texto)}</div>
        <div class="entrada-rodape">
          <span class="entrada-quando">${quando(it.criado_em)}</span>
          <span class="entrada-acoes">
            <span class="entrada-vira">${t("organizacao_entrada.virar")}</span>
            ${TIPOS_CONVERSAO.map((t) => `<button type="button" class="btn sm entrada-btn" data-virar="${t.tipo}">${icon(t.icone, { size: 11 })} ${t.rotulo}</button>`).join("")}
            <button type="button" class="nota-acao perigo" data-descartar data-tooltip="${t("organizacao_entrada.descartar")}" aria-label="${t("organizacao_entrada.descartar")}">${icon("x", { size: 12 })}</button>
          </span>
        </div>
      </div>`
    )
    .join("");
}

export async function carregarEntrada() {
  try {
    itens = await listEntrada();
  } catch {
    itens = [];
  }
  desenhar();
}

async function onClick(e) {
  const linha = e.target.closest("[data-entrada-id]");
  if (!linha) return;
  const item = itens.find((i) => i.id === linha.dataset.entradaId);
  if (!item) return;
  const virar = e.target.closest("[data-virar]")?.dataset.virar;
  if (virar) {
    await converterItem(item, virar);
    return;
  }
  if (e.target.closest("[data-descartar]")) {
    await descartarEntrada(item.id).catch(() => {});
    itens = itens.filter((i) => i.id !== item.id);
    desenhar();
    window.dispatchEvent(new CustomEvent("kami:entrada-mudou"));
  }
}

/** @param {HTMLElement} painel @param {(n: number) => void} contar — atualiza o rótulo da aba */
export async function montarEntrada(painel, contar) {
  raiz = painel;
  aoContar = contar;
  painel.innerHTML = `
    <div class="card">
      <div class="card-head">
        ${t("organizacao_entrada.caixa_de_entrada")}
        <span class="push"></span>
        <span class="entrada-dica">${t("organizacao_entrada.anote_com", { atalho: "<kbd>Alt</kbd>+<kbd>Q</kbd>" })}</span>
      </div>
      <div class="card-body"><div id="entrada-lista"></div></div>
    </div>`;
  painel.addEventListener("click", onClick);
  window.addEventListener("kami:entrada-mudou", carregarEntrada);
  await carregarEntrada();
}

export function desmontarEntrada() {
  raiz?.removeEventListener("click", onClick);
  window.removeEventListener("kami:entrada-mudou", carregarEntrada);
  raiz = null;
  aoContar = null;
  itens = [];
}
