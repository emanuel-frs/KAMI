import { createLembrete, updateLembrete, deleteLembrete } from "../api/lembretes.js";
import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { escapeHtml, localDateKey } from "../components/format.js";
import { DIAS_CURTOS } from "../components/habito-linha.js";

/**
 * Modal "novo lembrete" / "editar lembrete" (ORG-05) — singleton, mesmo
 * padrão dos outros. Abre de vários lugares (P-61): o botão "lembrar" de
 * notas, contas fixas, metas, hábitos e eventos (vem com `vinculo`), a
 * captura rápida ("@ amanhã 9h …", vem com `inicial`), o Ctrl+K e a aba
 * "lembretes" do calendário.
 */

export const REPETICOES = [
  ["nao", "não repete"],
  ["diario", "todo dia"],
  ["dias", "dias da semana"],
  ["mensal", "todo mês"],
  ["anual", "todo ano"],
];
export const VINCULO_ROTULO = { nota: "nota", conta_fixa: "conta fixa", meta: "meta", habito: "hábito", evento: "evento" };

let modalEl = null;
let onSavedCb = null;
let editando = null;
let vinculo = null;

function proximaHoraCheia() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return { data: localDateKey(d), hora: `${String(d.getHours()).padStart(2, "0")}:00` };
}

/**
 * O dia de um lembrete que veio só com a hora ("@ 23h30 remédio" da
 * captura): hoje se a hora ainda não passou, senão amanhã. Antes caía no
 * dia da "próxima hora cheia" — depois das 23h, isso é amanhã, e um
 * "@ 23h30" digitado às 23h10 ia para o dia seguinte (achado no e2e do
 * Windows da 1.14, que rodou depois das 23h). Função pura (testada).
 */
export function diaDaHora(hora, agora = new Date()) {
  const [h, m] = hora.split(":").map(Number);
  const d = new Date(agora);
  if (h * 60 + m <= agora.getHours() * 60 + agora.getMinutes()) d.setDate(d.getDate() + 1);
  return localDateKey(d);
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "lembrete-modal";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="lbm-head">
      <div class="modal-head"><span class="modal-head-title" id="lbm-head">novo lembrete</span> <button type="button" class="close" data-action="close" aria-label="fechar">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field"><label for="lbm-titulo">lembrar de</label><input type="text" id="lbm-titulo" maxlength="200" placeholder="ex: ligar pro banco, tomar o remédio" autocomplete="off" data-autofocus></div>
        <div class="field-row">
          <div class="field"><label for="lbm-data">dia</label><input type="date" id="lbm-data"></div>
          <div class="field"><label for="lbm-hora">hora</label><input type="time" id="lbm-hora"></div>
        </div>
        <div class="field">
          <label for="lbm-rep">repetição</label>
          <select id="lbm-rep">${REPETICOES.map(([v, r]) => `<option value="${v}">${r}</option>`).join("")}</select>
        </div>
        <div class="field" id="lbm-dias-campo" hidden>
          <span class="field-label" id="lbm-dias-label">dias</span>
          <div class="hb-dias" role="group" aria-labelledby="lbm-dias-label">
            ${DIAS_CURTOS.map((d, i) => `<label class="hb-dia"><input type="checkbox" value="${i}"> ${d}</label>`).join("")}
          </div>
        </div>
        <div class="lbm-vinculo" id="lbm-vinculo" hidden></div>
        <div class="hbm-dica" id="lbm-dica"></div>
        <div class="form-actions">
          <button type="button" class="btn sm danger" data-action="apagar" hidden>apagar</button>
          <button type="button" class="btn sm" data-action="close">cancelar</button>
          <button type="button" class="btn sm primary" data-action="save">+ criar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeLembreteModal));
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeLembreteModal();
    if (e.target.closest("[data-action=tirar-vinculo]")) {
      vinculo = null;
      mostrarVinculo();
    }
  });
  wrap.querySelector('[data-action="save"]').addEventListener("click", salvar);
  wrap.querySelector('[data-action="apagar"]').addEventListener("click", apagar);
  wrap.querySelector("#lbm-rep").addEventListener("change", mostrarCampos);
  wrap.querySelector("#lbm-titulo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      salvar();
    }
  });
  return wrap;
}

function mostrarCampos() {
  modalEl.querySelector("#lbm-dias-campo").hidden = modalEl.querySelector("#lbm-rep").value !== "dias";
}

function mostrarVinculo() {
  const el = modalEl.querySelector("#lbm-vinculo");
  el.hidden = !vinculo;
  el.innerHTML = vinculo
    ? `${icon("link", { size: 11 })} ligado a ${VINCULO_ROTULO[vinculo.tipo] || vinculo.tipo} «${escapeHtml(vinculo.nome || "")}»
       <button type="button" class="lbm-tirar" data-action="tirar-vinculo" aria-label="tirar o vínculo">${icon("x", { size: 10 })}</button>
       ${vinculo.tipo === "habito" ? `<div class="lbm-vinculo-dica">não avisa se o hábito já foi marcado no dia</div>` : ""}`
    : "";
}

async function salvar() {
  const dados = {
    titulo: modalEl.querySelector("#lbm-titulo").value.trim(),
    data: modalEl.querySelector("#lbm-data").value,
    hora: modalEl.querySelector("#lbm-hora").value,
    repeticao: modalEl.querySelector("#lbm-rep").value,
    dias_semana: [...modalEl.querySelectorAll(".hb-dia input:checked")].map((c) => Number(c.value)),
    vinculo_tipo: vinculo?.tipo ?? null,
    vinculo_id: vinculo?.id ?? null,
  };
  if (!dados.titulo) return showErrorModal("escreva do que lembrar.", "atenção");
  if (!dados.data || !dados.hora) return showErrorModal("preencha o dia e a hora.", "atenção");
  if (dados.repeticao === "dias" && !dados.dias_semana.length) return showErrorModal("escolha pelo menos um dia da semana.", "atenção");
  let salvo;
  try {
    salvo = editando ? await updateLembrete(editando.id, dados) : await createLembrete(dados);
  } catch (err) {
    showErrorModal(err.message, editando ? "erro ao salvar lembrete" : "erro ao criar lembrete");
    return;
  }
  closeLembreteModal();
  window.dispatchEvent(new CustomEvent("kami:lembretes-mudaram"));
  await onSavedCb?.(salvo);
}

async function apagar() {
  if (!editando) return;
  const ok = await showConfirmModal(`Apagar o lembrete "${editando.titulo}"?`, { title: "apagar lembrete", confirmText: "apagar", danger: true });
  if (!ok) return;
  try {
    await deleteLembrete(editando.id);
  } catch (err) {
    showErrorModal(err.message, "erro ao apagar lembrete");
    return;
  }
  closeLembreteModal();
  window.dispatchEvent(new CustomEvent("kami:lembretes-mudaram"));
  await onSavedCb?.(null);
}

/**
 * @param {{ lembrete?: object, vinculo?: {tipo: string, id: string, nome: string},
 *   inicial?: {titulo?: string, data?: string, hora?: string}, onSaved?: (l: object|null) => void }} [opts]
 */
export function openLembreteModal({ lembrete = null, vinculo: v = null, inicial = {}, onSaved = null } = {}) {
  modalEl = modalEl && modalEl.isConnected ? modalEl : buildModal();
  onSavedCb = onSaved;
  editando = lembrete;
  vinculo = lembrete ? lembrete.vinculo : v;
  const padrao = proximaHoraCheia();
  modalEl.querySelector("#lbm-head").textContent = lembrete ? "editar lembrete" : "novo lembrete";
  modalEl.querySelector('[data-action="save"]').textContent = lembrete ? "salvar alterações" : "+ criar";
  modalEl.querySelector('[data-action="apagar"]').hidden = !lembrete;
  modalEl.querySelector("#lbm-titulo").value = lembrete?.titulo ?? inicial.titulo ?? (v ? v.nome : "");
  modalEl.querySelector("#lbm-data").value =
    lembrete?.data ?? inicial.data ?? (inicial.hora ? diaDaHora(inicial.hora) : padrao.data);
  modalEl.querySelector("#lbm-hora").value = lembrete?.hora ?? inicial.hora ?? padrao.hora;
  modalEl.querySelector("#lbm-rep").value = lembrete?.repeticao ?? (v?.tipo === "habito" ? "diario" : "nao");
  const dias = new Set(lembrete?.dias_semana ?? [0, 1, 2, 3, 4]);
  modalEl.querySelectorAll(".hb-dia input").forEach((c) => (c.checked = dias.has(Number(c.value))));
  modalEl.querySelector("#lbm-dica").textContent =
    "avisa dentro do kami e, se ligado em configurações › notificações, também pelo sistema. só com o kami aberto (ou na bandeja).";
  refreshCustomSelect(modalEl.querySelector("#lbm-rep"));
  mostrarCampos();
  mostrarVinculo();
  modalEl.classList.add("open");
}

export function closeLembreteModal() {
  modalEl?.classList.remove("open");
}
