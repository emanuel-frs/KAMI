import * as carreiraApi from "../api/carreira.js";
import { showErrorModal } from "./err-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";

/**
 * Modal "nova posição" / "editar posição" — mesmo padrão dual singleton
 * de debt-modal.js: passar `position` faz o modal virar edição (PUT em
 * vez de POST), pré-preenchido. `end_date` em branco = posição atual
 * (múltiplas posições "atuais" são permitidas, sem validação de
 * unicidade — seção 3 do documento de regras de negócio); "tipo de
 * vínculo" é um <select> só de UI, o backend aceita qualquer texto.
 */

let modalEl = null;
let onSavedCb = null;
let editingPosition = null;

const EMPLOYMENT_TYPES = ["CLT", "PJ", "freelancer", "estágio", "outro"];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "position-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">nova posição</span> <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field"><label>empresa</label><input type="text" id="pm-company" placeholder="ex: acme ltda"></div>
          <div class="field"><label>cargo</label><input type="text" id="pm-role" placeholder="ex: dev backend pleno"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>área (opcional)</label><input type="text" id="pm-area" placeholder="ex: engenharia"></div>
          <div class="field">
            <label>tipo de vínculo</label>
            <select id="pm-employment-type">
              ${EMPLOYMENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>início</label><input type="text" id="pm-start" placeholder="YYYY-MM-DD"></div>
          <div class="field"><label>fim (opcional — em branco = atual)</label><input type="text" id="pm-end" placeholder="YYYY-MM-DD"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>fim de contrato previsto (opcional)</label><input type="text" id="pm-contract-end" placeholder="YYYY-MM-DD"></div>
          <div class="field"><label>próxima revisão salarial prevista (opcional)</label><input type="text" id="pm-salary-review" placeholder="YYYY-MM-DD"></div>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="close">cancelar</button>
          <button class="btn sm primary" data-action="save">+ adicionar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  enhanceSelect(wrap.querySelector("#pm-employment-type"));
  return wrap;
}

async function submitPosition(wrap) {
  const company = wrap.querySelector("#pm-company").value.trim();
  const role = wrap.querySelector("#pm-role").value.trim();
  const start_date = wrap.querySelector("#pm-start").value.trim();
  if (!company || !role || !start_date) {
    showErrorModal("preenche empresa, cargo e início.", "atenção");
    return;
  }

  const payload = {
    company,
    role,
    area: wrap.querySelector("#pm-area").value.trim() || null,
    employment_type: wrap.querySelector("#pm-employment-type").value || null,
    start_date,
    end_date: wrap.querySelector("#pm-end").value.trim() || null,
    expected_contract_end: wrap.querySelector("#pm-contract-end").value.trim() || null,
    expected_salary_review: wrap.querySelector("#pm-salary-review").value.trim() || null,
  };

  try {
    if (editingPosition) {
      await carreiraApi.updateCareerPosition(editingPosition.id, payload);
    } else {
      await carreiraApi.createCareerPosition(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingPosition ? "erro ao salvar posição" : "erro ao criar posição");
    return;
  }
  closePositionModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closePositionModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closePositionModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitPosition(wrap));
}

/**
 * @param {{ position?: object, onSaved: () => Promise<void>|void }} opts
 *   `position` — se informado, o modal abre em modo edição (PUT em vez
 *   de POST) pré-preenchido com os dados da posição.
 */
export function openPositionModal({ position = null, onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  editingPosition = position || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingPosition ? "editar posição" : "nova posição";
  saveBtn.textContent = editingPosition ? "salvar alterações" : "+ adicionar";

  modalEl.querySelector("#pm-company").value = editingPosition?.company || "";
  modalEl.querySelector("#pm-role").value = editingPosition?.role || "";
  modalEl.querySelector("#pm-area").value = editingPosition?.area || "";
  modalEl.querySelector("#pm-employment-type").value = editingPosition?.employment_type || EMPLOYMENT_TYPES[0];
  modalEl.querySelector("#pm-start").value = editingPosition?.start_date || "";
  modalEl.querySelector("#pm-end").value = editingPosition?.end_date || "";
  modalEl.querySelector("#pm-contract-end").value = editingPosition?.expected_contract_end || "";
  modalEl.querySelector("#pm-salary-review").value = editingPosition?.expected_salary_review || "";
  refreshCustomSelect(modalEl.querySelector("#pm-employment-type"));
  modalEl.classList.add("open");
}

export function closePositionModal() {
  modalEl?.classList.remove("open");
}
