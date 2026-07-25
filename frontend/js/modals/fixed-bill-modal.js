import * as financasApi from "../api/financas.js";
import { showErrorModal } from "./err-model.js";

/** Modal "nova conta fixa" — mesmo padrão singleton de subscription-modal.js. */

let modalEl = null;
let onSavedCb = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "fixed-bill-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">nova conta fixa <span class="close" data-action="close">×</span></div>
      <div class="modal-body">
        <div class="field"><label>nome</label><input type="text" id="fbm-name" placeholder="ex: aluguel, internet..."></div>
        <div class="field-row">
          <div class="field"><label>valor</label><input type="number" id="fbm-amount" placeholder="0.00"></div>
          <div class="field"><label>dia de vencimento</label><input type="number" id="fbm-due-day" min="1" max="31" placeholder="10"></div>
        </div>
        <label class="account-flag"><input type="checkbox" id="fbm-active" checked> ativa</label>
        <div class="form-actions">
          <button class="btn sm" data-action="close">cancelar</button>
          <button class="btn sm primary" data-action="save">+ adicionar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

async function submitFixedBill(wrap) {
  const name = wrap.querySelector("#fbm-name").value.trim();
  const amount = Number(wrap.querySelector("#fbm-amount").value);
  const dueDay = Number(wrap.querySelector("#fbm-due-day").value);
  if (!name || !amount || !dueDay) { showErrorModal("preenche nome, valor e dia de vencimento.", "atenção"); return; }

  const payload = {
    name,
    amount,
    due_day: dueDay,
    active: wrap.querySelector("#fbm-active").checked,
  };

  try {
    await financasApi.createFixedBill(payload);
  } catch (err) {
    showErrorModal(err.message, "erro ao criar conta fixa");
    return;
  }
  closeFixedBillModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeFixedBillModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeFixedBillModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitFixedBill(wrap));
}

/** @param {{ onSaved: () => Promise<void>|void }} opts */
export function openFixedBillModal({ onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;

  modalEl.querySelector("#fbm-name").value = "";
  modalEl.querySelector("#fbm-amount").value = "";
  modalEl.querySelector("#fbm-due-day").value = "";
  modalEl.querySelector("#fbm-active").checked = true;
  modalEl.classList.add("open");
}

export function closeFixedBillModal() {
  modalEl?.classList.remove("open");
}