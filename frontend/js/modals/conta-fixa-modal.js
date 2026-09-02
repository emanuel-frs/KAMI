import * as financasApi from "../api/financas.js";
import { showErrorModal } from "./err-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";

/**
 * Modal "nova conta fixa" / "editar conta fixa" — mesmo padrão singleton
 * de account-modal.js: passar `bill` faz o modal virar edição (PUT em
 * vez de POST), pré-preenchido com os dados da conta fixa.
 *
 * `conta_id`/`categoria` são opcionais — mesma ideia de
 * subscription-modal.js: sem conta vinculada, a conta fixa continua
 * sendo só lembrete; com conta vinculada, marcar como paga passa a
 * poder gerar uma transação real (ver widgets/contas-fixas.js e
 * app/finance_utils.py — item 6).
 */

let modalEl = null;
let onSavedCb = null;
let editingBill = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "fixed-bill-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">nova conta fixa</span> <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field"><label>nome</label><input type="text" id="fbm-name" placeholder="ex: aluguel, internet..."></div>
        <div class="field-row">
          <div class="field"><label>valor</label><input type="number" id="fbm-amount" placeholder="0.00"></div>
          <div class="field"><label>dia de vencimento</label><input type="number" id="fbm-due-day" min="1" max="31" placeholder="10"></div>
        </div>
        <div class="field">
          <label>conta vinculada (opcional — habilita descontar automaticamente)</label>
          <select id="fbm-conta"><option value="">— nenhuma, só lembrete —</option></select>
        </div>
        <div class="field"><label>categoria (opcional)</label><input type="text" id="fbm-categoria" placeholder="ex: moradia, contas fixas..."></div>
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
    conta_id: wrap.querySelector("#fbm-conta").value || null,
    categoria: wrap.querySelector("#fbm-categoria").value.trim() || null,
  };

  try {
    if (editingBill) {
      await financasApi.updateFixedBill(editingBill.id, payload);
    } else {
      await financasApi.createFixedBill(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingBill ? "erro ao salvar conta fixa" : "erro ao criar conta fixa");
    return;
  }
  closeContaFixaModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeContaFixaModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeContaFixaModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitFixedBill(wrap));
}

/**
 * @param {{ bill?: object, accounts?: Array, onSaved: () => Promise<void>|void }} opts
 *   `bill` — se informado, o modal abre em modo edição (PUT em vez de
 *   POST) pré-preenchido com os dados da conta fixa.
 *   `accounts` — contas já achatadas (com bankNome), pro select de conta
 *   vinculada — mesmo formato usado em subscription-modal.js.
 */
export function openContaFixaModal({ bill = null, accounts = [], onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  editingBill = bill || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingBill ? "editar conta fixa" : "nova conta fixa";
  saveBtn.textContent = editingBill ? "salvar alterações" : "+ adicionar";

  modalEl.querySelector("#fbm-name").value = editingBill?.name || "";
  modalEl.querySelector("#fbm-amount").value = editingBill?.amount ?? "";
  modalEl.querySelector("#fbm-due-day").value = editingBill?.due_day ?? "";
  modalEl.querySelector("#fbm-categoria").value = editingBill?.categoria || "";
  modalEl.querySelector("#fbm-active").checked = editingBill ? !!editingBill.active : true;

  modalEl.querySelector("#fbm-conta").innerHTML =
    `<option value="">— nenhuma, só lembrete —</option>` +
    (accounts || []).map((a) => `<option value="${a.id}">${a.bankNome} — ${a.nome}</option>`).join("");
  modalEl.querySelector("#fbm-conta").value = editingBill?.conta_id || "";
  refreshCustomSelect(modalEl.querySelector("#fbm-conta"));

  modalEl.classList.add("open");
}

export function closeContaFixaModal() {
  modalEl?.classList.remove("open");
}
