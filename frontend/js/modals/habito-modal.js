import { createHabito, updateHabito } from "../api/habitos.js";
import { showErrorModal } from "./err-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { ATRIBUTOS, diasCurtos } from "../components/habito-linha.js";
import { nomeAtributo } from "../components/textos-sistema.js";
import { t } from "../i18n.js";

/**
 * Modal "novo hábito" / "editar hábito" (ORG-04) — mesmo padrão singleton
 * dos outros modais: passar `habito` vira edição (PUT em vez de POST).
 *
 * Frequência (P-57): todo dia, dias fixos da semana (aparecem os 7 dias
 * pra marcar) ou X vezes por semana (aparece o número). O atributo é
 * onde cai o xp de cada marca (P-56).
 */


let modalEl = null;
let onSavedCb = null;
let editando = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "habito-modal";
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="hbm-head">
      <div class="modal-head"><span class="modal-head-title" id="hbm-head">${t("habito.novo_habito")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field"><label for="hbm-nome">${t("habito.nome")}</label><input type="text" id="hbm-nome" maxlength="120" placeholder="${t("habito.ex_beber_2l_de_agua")}" autocomplete="off" data-autofocus></div>
        <div class="field-row">
          <div class="field">
            <label for="hbm-freq">${t("habito.frequencia")}</label>
            <select id="hbm-freq">
              <option value="diario">${t("habito.todo_dia")}</option>
              <option value="dias">${t("habito.dias_fixos_da_semana")}</option>
              <option value="semana">${t("habito.x_vezes_por_semana")}</option>
            </select>
          </div>
          <div class="field">
            <label for="hbm-attr">${t("habito.atributo_onde_cai_o_xp")}</label>
            <select id="hbm-attr">${ATRIBUTOS.map((v) => `<option value="${v}">${nomeAtributo(v)}</option>`).join("")}</select>
          </div>
        </div>
        <div class="field" id="hbm-dias-campo" hidden>
          <span class="field-label" id="hbm-dias-label">${t("habito.dias")}</span>
          <div class="hb-dias" role="group" aria-labelledby="hbm-dias-label">
            ${diasCurtos().map((d, i) => `<label class="hb-dia"><input type="checkbox" value="${i}"> ${d}</label>`).join("")}
          </div>
        </div>
        <div class="field" id="hbm-vezes-campo" hidden>
          <label for="hbm-vezes">${t("habito.quantas_vezes_por_semana")}</label>
          <input type="number" id="hbm-vezes" min="1" max="7" value="3">
        </div>
        <div class="hbm-dica">${t("habito.cada_dia_feito_da_5")}</div>
        <div class="form-actions">
          <button type="button" class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button type="button" class="btn sm primary" data-action="save">${t("habito.criar")}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeHabitoModal));
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeHabitoModal();
  });
  wrap.querySelector('[data-action="save"]').addEventListener("click", salvar);
  wrap.querySelector("#hbm-freq").addEventListener("change", mostrarCampos);
  wrap.querySelector("#hbm-nome").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      salvar();
    }
  });
  return wrap;
}

function mostrarCampos() {
  const freq = modalEl.querySelector("#hbm-freq").value;
  modalEl.querySelector("#hbm-dias-campo").hidden = freq !== "dias";
  modalEl.querySelector("#hbm-vezes-campo").hidden = freq !== "semana";
}

async function salvar() {
  const nome = modalEl.querySelector("#hbm-nome").value.trim();
  const frequencia = modalEl.querySelector("#hbm-freq").value;
  const dias = [...modalEl.querySelectorAll(".hb-dia input:checked")].map((c) => Number(c.value));
  const vezes = Number(modalEl.querySelector("#hbm-vezes").value);
  if (!nome) return showErrorModal(t("habito.da_um_nome_pro_habito"), t("geral.atencao"));
  if (frequencia === "dias" && !dias.length) return showErrorModal(t("habito.escolha_pelo_menos_um_dia"), t("geral.atencao"));
  if (frequencia === "semana" && !(vezes >= 1 && vezes <= 7)) return showErrorModal(t("habito.de_1_a_7_vezes"), t("geral.atencao"));

  const dados = { nome, frequencia, atributo: modalEl.querySelector("#hbm-attr").value };
  if (frequencia === "dias") dados.dias_semana = dias;
  if (frequencia === "semana") dados.vezes_semana = vezes;
  let salvo;
  try {
    salvo = editando ? await updateHabito(editando.id, dados) : await createHabito(dados);
  } catch (err) {
    showErrorModal(err.message, editando ? t("habito.erro_ao_salvar_habito") : t("habito.erro_ao_criar_habito"));
    return;
  }
  closeHabitoModal();
  await onSavedCb?.(salvo);
}

/** @param {{ habito?: object, onSaved?: (h: object) => void }} [opts] */
export function openHabitoModal({ habito = null, onSaved = null } = {}) {
  modalEl = modalEl && modalEl.isConnected ? modalEl : buildModal();
  onSavedCb = onSaved;
  editando = habito;
  modalEl.querySelector("#hbm-head").textContent = habito ? t("habito.editar_habito") : t("habito.novo_habito");
  modalEl.querySelector('[data-action="save"]').textContent = habito ? t("habito.salvar_alteracoes") : "+ criar";
  modalEl.querySelector("#hbm-nome").value = habito?.nome || "";
  modalEl.querySelector("#hbm-freq").value = habito?.frequencia || "diario";
  modalEl.querySelector("#hbm-attr").value = habito?.atributo || "organizacao";
  modalEl.querySelector("#hbm-vezes").value = habito?.vezes_semana ?? 3;
  const dias = new Set(habito?.dias_semana ?? [0, 1, 2, 3, 4]);
  modalEl.querySelectorAll(".hb-dia input").forEach((c) => (c.checked = dias.has(Number(c.value))));
  refreshCustomSelect(modalEl.querySelector("#hbm-freq"));
  refreshCustomSelect(modalEl.querySelector("#hbm-attr"));
  mostrarCampos();
  modalEl.classList.add("open");
}

export function closeHabitoModal() {
  modalEl?.classList.remove("open");
}
