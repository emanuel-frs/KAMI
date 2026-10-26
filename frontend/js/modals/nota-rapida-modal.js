import { icon } from "../components/icons.js";
import { createNota, updateNota } from "../api/notas.js";
import { criarEditorNota } from "../components/nota-editor.js";
import { registrarAntesDeFechar } from "../components/antes-de-fechar.js";
import { navigateTo } from "../components/navigate.js";
import { t } from "../i18n.js";

/**
 * modals/nota-rapida-modal.js — nota rápida de qualquer tela (ORG-01, P-51).
 *
 * Alt+Shift+N (components/global-shortcuts.js) abre um modal pequeno com
 * título + o mesmo editor das notas. Salva sozinho (700 ms depois da
 * última tecla) e ao fechar; só cria a nota quando há algo escrito — abrir
 * e fechar sem digitar não deixa nota vazia. "abrir em notas" leva pra
 * Organização com a nota aberta.
 *
 * Mesmo padrão singleton dos outros modais; Esc fecha pelo
 * modal-escape.js (data-action="close"), e fechar salva antes.
 */

const SALVAR_APOS_MS = 700;
let modalEl = null;
let editor = null;
let notaId = null;
let salvo = { titulo: "", conteudo: "" };
let timer = null;
let fila = Promise.resolve();
let removerAntesDeFechar = null;
let aoCriar = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "nota-rapida-modal";
  wrap.innerHTML = `
    <div class="modal wide nota-rapida" role="dialog" aria-modal="true" aria-labelledby="nrm-titulo-head">
      <div class="modal-head">
        <span id="nrm-titulo-head">${icon("pencil", { size: 12 })} ${t("nota_rapida.nota_rapida")}</span>
        <span class="nota-status" id="nrm-status" aria-live="polite"></span>
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="nrm-corpo">
        <input type="text" id="nrm-titulo" class="nota-titulo" placeholder="${t("nota_rapida.titulo_opcional")}" maxlength="200" aria-label="${t("nota_rapida.titulo_da_nota")}" autocomplete="off" data-autofocus>
        <div class="nrm-editor" id="nrm-editor"></div>
      </div>
      <div class="nrm-rodape">
        <span class="nrm-dica">${t("nota_rapida.salva_sozinho_esc_fecha")}</span>
        <button type="button" class="btn sm" data-nrm="abrir">${icon("arrow-right", { size: 11 })} ${t("nota_rapida.abrir_em_notas")}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-action="close"]').addEventListener("click", fechar);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) fechar();
    if (e.target.closest('[data-nrm="abrir"]')) abrirEmNotas();
  });
  wrap.querySelector("#nrm-titulo").addEventListener("input", agendar);
  wrap.querySelector("#nrm-titulo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editor?.focus();
    }
  });
  return wrap;
}

function status(texto, tipo = "") {
  const el = modalEl?.querySelector("#nrm-status");
  if (el) {
    el.textContent = texto;
    el.dataset.tipo = tipo;
  }
}

function agendar() {
  status(t("notas.editando"));
  clearTimeout(timer);
  timer = setTimeout(salvar, SALVAR_APOS_MS);
}

function salvar() {
  clearTimeout(timer);
  // lido agora (o modal pode estar fechando); a fila mantém a ordem
  const dados = {
    titulo: (modalEl?.querySelector("#nrm-titulo").value || "").trim(),
    conteudo: editor ? editor.getMarkdown() : salvo.conteudo,
  };
  fila = fila.then(async () => {
    if (dados.titulo === salvo.titulo && dados.conteudo === salvo.conteudo) return;
    if (!notaId && !dados.titulo && !dados.conteudo) return;
    status(t("notas.salvando"));
    try {
      if (!notaId) {
        notaId = (await createNota(dados)).id;
        aoCriar?.(notaId);
        aoCriar = null;
      }
      else await updateNota(notaId, dados);
      salvo = dados;
      status(t("notas.salvo"), "ok");
      window.dispatchEvent(new CustomEvent("kami:notas-mudaram"));
    } catch (err) {
      console.error("nota rápida: falha ao salvar", err);
      status(t("nota_rapida.nao_salvou_tentando_de_novo"), "erro");
      timer = setTimeout(salvar, 5000);
    }
  });
  return fila;
}

async function fechar() {
  if (!modalEl?.classList.contains("open")) return;
  modalEl.classList.remove("open");
  await salvar();
  removerAntesDeFechar?.();
  removerAntesDeFechar = null;
  editor?.destroy();
  editor = null;
}

async function abrirEmNotas() {
  await salvar();
  const id = notaId;
  await fechar();
  if (id) navigateTo("organizacao", { tab: "notas", notaId: id });
  else navigateTo("organizacao", { tab: "notas" });
}

/** @param {{ titulo?: string, conteudo?: string, onCriada?: (id: string) => void }} [opts]
 *  ORG-02: a captura rápida ("# ideia…") abre já preenchida; `onCriada`
 *  avisa quando a nota passou a existir (a captura tira o item da entrada). */
export function openNotaRapida({ titulo = "", conteudo = "", onCriada = null } = {}) {
  modalEl = modalEl && modalEl.isConnected ? modalEl : buildModal();
  if (modalEl.classList.contains("open")) {
    modalEl.querySelector("#nrm-titulo").focus();
    return;
  }
  notaId = null;
  aoCriar = onCriada;
  salvo = { titulo: "", conteudo: "" };
  modalEl.querySelector("#nrm-titulo").value = titulo;
  status("");
  editor = criarEditorNota(modalEl.querySelector("#nrm-editor"), {
    markdown: conteudo,
    onChange: agendar,
    placeholder: t("nota_rapida.escreva_lista_tarefa_titulo"),
  });
  removerAntesDeFechar = registrarAntesDeFechar(salvar);
  modalEl.classList.add("open");
  if (titulo || conteudo) salvar(); // veio da captura: já vira nota
}
