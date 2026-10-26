import { createLembrete, updateLembrete, deleteLembrete } from "../api/lembretes.js";
import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { escapeHtml, localDateKey } from "../components/format.js";
import { diasCurtos } from "../components/habito-linha.js";
import { t } from "../i18n.js";

/**
 * Modal "novo lembrete" / "editar lembrete" (ORG-05) — singleton, mesmo
 * padrão dos outros. Abre de vários lugares (P-61): o botão "lembrar" de
 * notas, contas fixas, metas, hábitos e eventos (vem com `vinculo`), a
 * captura rápida ("@ amanhã 9h …", vem com `inicial`), o Ctrl+K e a aba
 * "lembretes" do calendário.
 */

export const repeticoes = () => [
  ["nao", t("lembrete.nao_repete")],
  ["diario", t("lembrete.todo_dia")],
  ["dias", t("lembrete.dias_da_semana")],
  ["mensal", t("lembrete.todo_mes")],
  ["anual", t("lembrete.todo_ano")],
];
export const vinculoRotulo = () => ({ nota: t("captura.nota"), conta_fixa: t("lembrete.conta_fixa"), meta: t("captura.meta"), habito: t("lembrete.habito"), evento: t("captura.evento") });

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
      <div class="modal-head"><span class="modal-head-title" id="lbm-head">${t("lembrete.novo_lembrete")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field"><label for="lbm-titulo">${t("lembrete.lembrar_de")}</label><input type="text" id="lbm-titulo" maxlength="200" placeholder="${t("lembrete.ex_ligar_pro_banco_tomar")}" autocomplete="off" data-autofocus></div>
        <div class="field-row">
          <div class="field"><label for="lbm-data">${t("lembrete.dia")}</label><input type="date" id="lbm-data"></div>
          <div class="field"><label for="lbm-hora">${t("lembrete.hora")}</label><input type="time" id="lbm-hora"></div>
        </div>
        <div class="field">
          <label for="lbm-rep">${t("lembrete.repeticao")}</label>
          <select id="lbm-rep">${repeticoes().map(([v, r]) => `<option value="${v}">${r}</option>`).join("")}</select>
        </div>
        <div class="field" id="lbm-dias-campo" hidden>
          <span class="field-label" id="lbm-dias-label">${t("lembrete.dias")}</span>
          <div class="hb-dias" role="group" aria-labelledby="lbm-dias-label">
            ${diasCurtos().map((d, i) => `<label class="hb-dia"><input type="checkbox" value="${i}"> ${d}</label>`).join("")}
          </div>
        </div>
        <div class="lbm-vinculo" id="lbm-vinculo" hidden></div>
        <div class="hbm-dica" id="lbm-dica"></div>
        <div class="form-actions">
          <button type="button" class="btn sm danger" data-action="apagar" hidden>${t("geral.apagar")}</button>
          <button type="button" class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button type="button" class="btn sm primary" data-action="save">${t("lembrete.criar")}</button>
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
    ? `${icon("link", { size: 11 })} ${t("lembrete.ligado_a", { tipo: vinculoRotulo()[vinculo.tipo] || vinculo.tipo, nome: escapeHtml(vinculo.nome || "") })}
       <button type="button" class="lbm-tirar" data-action="tirar-vinculo" aria-label="${t("lembrete.tirar_o_vinculo")}">${icon("x", { size: 10 })}</button>
       ${vinculo.tipo === "habito" ? `<div class="lbm-vinculo-dica">${t("lembrete.nao_avisa_se_o_habito")}</div>` : ""}`
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
  if (!dados.titulo) return showErrorModal(t("lembrete.escreva_do_que_lembrar"), t("geral.atencao"));
  if (!dados.data || !dados.hora) return showErrorModal(t("lembrete.preencha_o_dia_e_a"), t("geral.atencao"));
  if (dados.repeticao === "dias" && !dados.dias_semana.length) return showErrorModal(t("lembrete.escolha_pelo_menos_um_dia"), t("geral.atencao"));
  let salvo;
  try {
    salvo = editando ? await updateLembrete(editando.id, dados) : await createLembrete(dados);
  } catch (err) {
    showErrorModal(err.message, editando ? t("lembrete.erro_ao_salvar_lembrete") : t("lembrete.erro_ao_criar_lembrete"));
    return;
  }
  closeLembreteModal();
  window.dispatchEvent(new CustomEvent("kami:lembretes-mudaram"));
  await onSavedCb?.(salvo);
}

async function apagar() {
  if (!editando) return;
  const ok = await showConfirmModal(t("lembrete.apagar_pergunta", { titulo: editando.titulo }), { title: t("lembrete.apagar_lembrete"), confirmText: t("geral.apagar"), danger: true });
  if (!ok) return;
  try {
    await deleteLembrete(editando.id);
  } catch (err) {
    showErrorModal(err.message, t("lembrete.erro_ao_apagar_lembrete"));
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
  modalEl.querySelector("#lbm-head").textContent = lembrete ? t("lembrete.editar_lembrete") : t("lembrete.novo_lembrete");
  modalEl.querySelector('[data-action="save"]').textContent = lembrete ? t("lembrete.salvar_alteracoes") : t("lembrete.criar");
  modalEl.querySelector('[data-action="apagar"]').hidden = !lembrete;
  modalEl.querySelector("#lbm-titulo").value = lembrete?.titulo ?? inicial.titulo ?? (v ? v.nome : "");
  modalEl.querySelector("#lbm-data").value =
    lembrete?.data ?? inicial.data ?? (inicial.hora ? diaDaHora(inicial.hora) : padrao.data);
  modalEl.querySelector("#lbm-hora").value = lembrete?.hora ?? inicial.hora ?? padrao.hora;
  modalEl.querySelector("#lbm-rep").value = lembrete?.repeticao ?? (v?.tipo === "habito" ? "diario" : "nao");
  const dias = new Set(lembrete?.dias_semana ?? [0, 1, 2, 3, 4]);
  modalEl.querySelectorAll(".hb-dia input").forEach((c) => (c.checked = dias.has(Number(c.value))));
  modalEl.querySelector("#lbm-dica").textContent =
    t("lembrete.avisa_dentro_do_kami_e");
  refreshCustomSelect(modalEl.querySelector("#lbm-rep"));
  mostrarCampos();
  mostrarVinculo();
  modalEl.classList.add("open");
}

export function closeLembreteModal() {
  modalEl?.classList.remove("open");
}
