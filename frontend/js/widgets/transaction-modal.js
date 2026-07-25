import * as financasApi from "../api/financas.js";
import { showErrorModal } from "./err-model.js";
import { enhanceSelect, refreshCustomSelect } from "./custom-select.js";

/**
 * Modal "novo lançamento" — entrada/saída/transferência. Recebe as
 * contas já achatadas (com bankNome) por quem chamar. Dispara
 * 'kami:wallet-changed' (wallet.js e financas-resumo.js escutam) e
 * 'kami:action-registered' (todo lançamento credita XP em financas —
 * mesmo evento que attributes.js já escuta no núcleo).
 */

let modalEl = null;
let onSavedCb = null;
let accountsFlat = [];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "transaction-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">novo lançamento <span class="close" data-action="close">×</span></div>
      <div class="modal-body">
        <div class="field">
          <label>tipo</label>
          <select id="tm-type">
            <option value="entrada">entrada</option>
            <option value="saida">saída</option>
            <option value="transferencia">transferência</option>
          </select>
        </div>
        <div class="field">
          <label>descrição</label>
          <input type="text" id="tm-desc" placeholder="ex: mercado, salário...">
        </div>
        <div class="field-row">
          <div class="field"><label>valor</label><input type="number" id="tm-amount" placeholder="0.00"></div>
          <div class="field"><label>data</label><input type="text" id="tm-date" placeholder="YYYY-MM-DD"></div>
        </div>
        <div class="field" id="tm-category-field">
          <label>categoria</label>
          <input type="text" id="tm-category" placeholder="ex: alimentacao, transporte...">
        </div>
        <div class="field">
          <label>conta</label>
          <select id="tm-conta"></select>
        </div>
        <div class="field" id="tm-forma-pagamento-field" style="display:none;">
          <label>forma de pagamento</label>
          <select id="tm-forma-pagamento">
            <option value="saldo">saldo</option>
            <option value="credito">crédito</option>
          </select>
        </div>
        <div class="field" id="tm-destino-tipo-field" style="display:none;">
          <label>destino</label>
          <select id="tm-destino-tipo">
            <option value="interna">conta cadastrada</option>
            <option value="externa">externo (pix, saque...)</option>
          </select>
        </div>
        <div class="field" id="tm-conta-destino-field" style="display:none;">
          <label>conta de destino</label>
          <select id="tm-conta-destino"></select>
        </div>
        <div class="field" id="tm-destino-externo-field" style="display:none;">
          <label>destino (texto livre)</label>
          <input type="text" id="tm-destino-externo" placeholder="ex: fulano, saque...">
        </div>

        <div class="form-actions">
          <button class="btn sm" data-action="close">cancelar</button>
          <button class="btn sm primary" data-action="save">+ lançar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  // #tm-conta e #tm-conta-destino são montados via refreshCustomSelect em
  // populateContaSelects (as opções só existem depois que as contas chegam).
  enhanceSelect(wrap.querySelector("#tm-type"));
  enhanceSelect(wrap.querySelector("#tm-forma-pagamento"));
  enhanceSelect(wrap.querySelector("#tm-destino-tipo"));
  return wrap;
}

function updateVisibility(wrap) {
  const type = wrap.querySelector("#tm-type").value;
  const contaId = wrap.querySelector("#tm-conta").value;
  const conta = accountsFlat.find((a) => a.id === contaId);

  wrap.querySelector("#tm-category-field").style.display = type === "transferencia" ? "none" : "block";
  wrap.querySelector("#tm-forma-pagamento-field").style.display =
    type === "saida" && conta && conta.possui_saldo && conta.possui_credito ? "block" : "none";

  const isTransfer = type === "transferencia";
  wrap.querySelector("#tm-destino-tipo-field").style.display = isTransfer ? "block" : "none";
  const destinoTipo = wrap.querySelector("#tm-destino-tipo").value;
  wrap.querySelector("#tm-conta-destino-field").style.display = isTransfer && destinoTipo === "interna" ? "block" : "none";
  wrap.querySelector("#tm-destino-externo-field").style.display = isTransfer && destinoTipo === "externa" ? "block" : "none";
}

function populateContaSelects(wrap) {
  const opts = accountsFlat.map((a) => `<option value="${a.id}">${a.bankNome} — ${a.nome}</option>`).join("");
  wrap.querySelector("#tm-conta").innerHTML = opts;
  wrap.querySelector("#tm-conta-destino").innerHTML = opts;
  refreshCustomSelect(wrap.querySelector("#tm-conta"));
  refreshCustomSelect(wrap.querySelector("#tm-conta-destino"));
}

async function submitTransaction(wrap) {
  const type = wrap.querySelector("#tm-type").value;
  const payload = {
    description: wrap.querySelector("#tm-desc").value.trim(),
    amount: Number(wrap.querySelector("#tm-amount").value),
    type,
    category: type === "transferencia" ? "transferencia" : wrap.querySelector("#tm-category").value.trim(),
    date: wrap.querySelector("#tm-date").value,
    conta_id: wrap.querySelector("#tm-conta").value,
  };
  if (!payload.conta_id) { showErrorModal("cadastre uma conta antes de lançar.", "atenção"); return; }
  if (!payload.description || !payload.amount) { showErrorModal("preenche descrição e valor.", "atenção"); return; }

  if (type === "saida" && wrap.querySelector("#tm-forma-pagamento-field").style.display !== "none") {
    payload.forma_pagamento = wrap.querySelector("#tm-forma-pagamento").value;
  }
  if (type === "transferencia") {
    const destinoTipo = wrap.querySelector("#tm-destino-tipo").value;
    if (destinoTipo === "interna") payload.conta_destino_id = wrap.querySelector("#tm-conta-destino").value;
    else payload.destino_externo = wrap.querySelector("#tm-destino-externo").value.trim();
  }

  try {
    await financasApi.createTransaction(payload);
  } catch (err) {
    showErrorModal(err.message, "erro ao lançar");
    return;
  }
  closeTransactionModal();
  window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
  window.dispatchEvent(new CustomEvent("kami:action-registered"));
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeTransactionModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeTransactionModal(); });
  wrap.querySelector("#tm-type").addEventListener("change", () => updateVisibility(wrap));
  wrap.querySelector("#tm-conta").addEventListener("change", () => updateVisibility(wrap));
  wrap.querySelector("#tm-destino-tipo").addEventListener("change", () => updateVisibility(wrap));
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitTransaction(wrap));
}

/**
 * @param {{ accounts: Array, onSaved: () => Promise<void>|void }} opts
 *   `accounts` já achatadas com bankNome — ex: banks.flatMap(b =>
 *   b.accounts.map(a => ({ ...a, bankNome: b.nome }))).
 */
export function openTransactionModal({ accounts, onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  accountsFlat = accounts || [];

  modalEl.querySelector("#tm-type").value = "entrada";
  refreshCustomSelect(modalEl.querySelector("#tm-type"));
  modalEl.querySelector("#tm-desc").value = "";
  modalEl.querySelector("#tm-amount").value = "";
  modalEl.querySelector("#tm-date").value = new Date().toISOString().slice(0, 10);
  modalEl.querySelector("#tm-category").value = "";
  modalEl.querySelector("#tm-destino-tipo").value = "interna";
  refreshCustomSelect(modalEl.querySelector("#tm-destino-tipo"));
  modalEl.querySelector("#tm-destino-externo").value = "";
  populateContaSelects(modalEl);
  updateVisibility(modalEl);
  modalEl.classList.add("open");
}

export function closeTransactionModal() {
  modalEl?.classList.remove("open");
}