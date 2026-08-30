import * as carreiraApi from "../api/carreira.js";
import { showErrorModal } from "./err-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";

/**
 * Modal "novo registro salarial" / "editar registro" (Parte 4, seção 5
 * do documento de regras de negócio) — mesmo padrão dual singleton de
 * position-modal.js: passar `record` faz o modal virar edição (PUT em
 * vez de POST). `position_id` é um vínculo OPCIONAL a uma posição da
 * linha do tempo (career_positions) — select populado sob demanda a
 * cada abertura, com opção "nenhuma" no topo; "tipo de vínculo" segue o
 * mesmo <select> livre de position-modal.js.
 */

let modalEl = null;
let onSavedCb = null;
let editingRecord = null;

const EMPLOYMENT_TYPES = ["CLT", "PJ", "freelancer", "outro"];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "salary-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">novo registro salarial</span> <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field"><label>valor</label><input type="text" id="sm-amount" placeholder="ex: 8500.00"></div>
          <div class="field"><label>moeda</label><input type="text" id="sm-currency" placeholder="BRL"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>data</label><input type="text" id="sm-date" placeholder="YYYY-MM-DD"></div>
          <div class="field">
            <label>tipo de vínculo (opcional)</label>
            <select id="sm-employment-type">
              <option value="">—</option>
              ${EMPLOYMENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>posição vinculada (opcional)</label><select id="sm-position"><option value="">nenhuma</option></select></div>
          <div class="field"><label>motivo (opcional)</label><input type="text" id="sm-reason" placeholder="ex: reajuste anual"></div>
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
  enhanceSelect(wrap.querySelector("#sm-employment-type"));
  enhanceSelect(wrap.querySelector("#sm-position"));
  return wrap;
}

async function loadPositionOptions(wrap, selectedId) {
  const select = wrap.querySelector("#sm-position");
  let positions = [];
  try {
    positions = await carreiraApi.listCareerPositions();
  } catch {
    // silencioso — vínculo é opcional, não bloqueia o registro salarial
    // por conta de um erro ao carregar a lista de posições
  }
  select.innerHTML =
    `<option value="">nenhuma</option>` +
    positions.map((p) => `<option value="${p.id}">${p.role} — ${p.company}</option>`).join("");
  select.value = selectedId || "";
  refreshCustomSelect(select);
}

async function submitSalaryRecord(wrap) {
  const amount = parseFloat(wrap.querySelector("#sm-amount").value.trim().replace(",", "."));
  const dateVal = wrap.querySelector("#sm-date").value.trim();
  if (!amount || amount <= 0 || !dateVal) {
    showErrorModal("preenche valor (maior que zero) e data.", "atenção");
    return;
  }

  const payload = {
    amount,
    currency: wrap.querySelector("#sm-currency").value.trim() || "BRL",
    employment_type: wrap.querySelector("#sm-employment-type").value || null,
    date: dateVal,
    reason: wrap.querySelector("#sm-reason").value.trim() || null,
    position_id: wrap.querySelector("#sm-position").value || null,
  };

  try {
    if (editingRecord) {
      await carreiraApi.updateCareerSalaryRecord(editingRecord.id, payload);
    } else {
      await carreiraApi.createCareerSalaryRecord(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingRecord ? "erro ao salvar registro" : "erro ao criar registro");
    return;
  }
  closeSalaryModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeSalaryModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeSalaryModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitSalaryRecord(wrap));
}

/**
 * @param {{ record?: object, onSaved: () => Promise<void>|void }} opts
 *   `record` — se informado, o modal abre em modo edição (PUT em vez de
 *   POST) pré-preenchido com os dados do registro.
 */
export async function openSalaryModal({ record = null, onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  editingRecord = record || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingRecord ? "editar registro salarial" : "novo registro salarial";
  saveBtn.textContent = editingRecord ? "salvar alterações" : "+ adicionar";

  modalEl.querySelector("#sm-amount").value = editingRecord?.amount ?? "";
  modalEl.querySelector("#sm-currency").value = editingRecord?.currency || "BRL";
  modalEl.querySelector("#sm-date").value = editingRecord?.date || "";
  modalEl.querySelector("#sm-employment-type").value = editingRecord?.employment_type || "";
  modalEl.querySelector("#sm-reason").value = editingRecord?.reason || "";
  refreshCustomSelect(modalEl.querySelector("#sm-employment-type"));

  await loadPositionOptions(modalEl, editingRecord?.position_id || "");

  modalEl.classList.add("open");
}

export function closeSalaryModal() {
  modalEl?.classList.remove("open");
}
