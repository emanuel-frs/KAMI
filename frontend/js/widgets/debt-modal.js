import * as financasApi from "../api/financas.js";
import { showErrorModal } from "./err-model.js";
import { enhanceSelect, refreshCustomSelect } from "./custom-select.js";

/** Modal "nova dívida" — mesmo padrão singleton de subscription-modal.js. */

let modalEl = null;
let onSavedCb = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "debt-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">nova dívida <span class="close" data-action="close">×</span></div>
      <div class="modal-body">
        <div class="field"><label>descrição</label><input type="text" id="dm-desc" placeholder="ex: empréstimo, parcelamento..."></div>
        <div class="field"><label>credor (opcional)</label><input type="text" id="dm-counterparty" placeholder="ex: banco x, fulano..."></div>
        <div class="field-row">
          <div class="field"><label>valor</label><input type="number" id="dm-amount" placeholder="0.00"></div>
          <div class="field"><label>vencimento (opcional)</label><input type="text" id="dm-due" placeholder="YYYY-MM-DD"></div>
        </div>
        <div class="field">
          <label>status</label>
          <select id="dm-status">
            <option value="aberta">aberta</option>
            <option value="paga">paga</option>
          </select>
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
  enhanceSelect(wrap.querySelector("#dm-status"));
  return wrap;
}

async function submitDebt(wrap) {
  const description = wrap.querySelector("#dm-desc").value.trim();
  const amount = Number(wrap.querySelector("#dm-amount").value);
  if (!description || !amount) { showErrorModal("preenche descrição e valor.", "atenção"); return; }

  const payload = {
    description,
    counterparty: wrap.querySelector("#dm-counterparty").value.trim() || null,
    amount,
    due_date: wrap.querySelector("#dm-due").value.trim() || null,
    status: wrap.querySelector("#dm-status").value,
  };

  try {
    await financasApi.createDebt(payload);
  } catch (err) {
    showErrorModal(err.message, "erro ao criar dívida");
    return;
  }
  closeDebtModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeDebtModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeDebtModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitDebt(wrap));
}

/** @param {{ onSaved: () => Promise<void>|void }} opts */
export function openDebtModal({ onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;

  modalEl.querySelector("#dm-desc").value = "";
  modalEl.querySelector("#dm-counterparty").value = "";
  modalEl.querySelector("#dm-amount").value = "";
  modalEl.querySelector("#dm-due").value = "";
  modalEl.querySelector("#dm-status").value = "aberta";
  refreshCustomSelect(modalEl.querySelector("#dm-status"));
  modalEl.classList.add("open");
}

export function closeDebtModal() {
  modalEl?.classList.remove("open");
}