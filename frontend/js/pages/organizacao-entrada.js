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
import { escapeHtml } from "../components/format.js";

let raiz = null;
let itens = [];
let aoContar = null;

function quando(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? hh : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hh}`;
}

function desenhar() {
  if (!raiz) return;
  aoContar?.(itens.length);
  const lista = raiz.querySelector("#entrada-lista");
  if (!itens.length) {
    lista.innerHTML = `<div class="empty-state">caixa de entrada vazia. <kbd>Alt</kbd>+<kbd>Q</kbd> anota qualquer coisa de qualquer tela.</div>`;
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
            <span class="entrada-vira">virar:</span>
            ${TIPOS_CONVERSAO.map((t) => `<button type="button" class="btn sm entrada-btn" data-virar="${t.tipo}">${icon(t.icone, { size: 11 })} ${t.rotulo}</button>`).join("")}
            <button type="button" class="nota-acao perigo" data-descartar data-tooltip="descartar" aria-label="descartar">${icon("x", { size: 12 })}</button>
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
        caixa de entrada
        <span class="push"></span>
        <span class="entrada-dica">anote com <kbd>Alt</kbd>+<kbd>Q</kbd></span>
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
