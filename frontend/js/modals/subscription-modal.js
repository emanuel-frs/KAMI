import * as walletApi from "../api/wallet.js";
import { showErrorModal } from "./err-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";

/**
 * Modal "nova assinatura". Conta é opcional — sem ela, a assinatura
 * continua sendo só lembrete; com ela, marcar como paga passa a poder
 * gerar uma transação real (ver widgets/financas-assinaturas.js e
 * app/finance_utils.py — item 6 do mapa de problemas). `categoria`
 * alimenta essa transação quando gerada.
 */

let modalEl = null;
let onSavedCb = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "subscription-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">nova assinatura <span class="close" data-action="close">×</span></div>
      <div class="modal-body">
        <div class="field"><label>nome</label><input type="text" id="sm-nome" placeholder="ex: streaming, academia..."></div>
        <div class="field-row">
          <div class="field"><label>valor esperado</label><input type="number" id="sm-valor" placeholder="0.00"></div>
          <div class="field"><label>dia de cobrança</label><input type="number" id="sm-dia" min="1" max="31" placeholder="10"></div>
        </div>
        <div class="field">
          <label>conta vinculada (opcional — habilita descontar automaticamente)</label>
          <select id="sm-conta"><option value="">— nenhuma, só lembrete —</option></select>
        </div>
        <div class="field"><label>categoria (opcional)</label><input type="text" id="sm-categoria" placeholder="ex: streaming, assinaturas..."></div>
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

async function submitSubscription(wrap) {
  const nome = wrap.querySelector("#sm-nome").value.trim();
  const valor = Number(wrap.querySelector("#sm-valor").value);
  const dia = Number(wrap.querySelector("#sm-dia").value);
  if (!nome || !valor || !dia) { showErrorModal("preenche nome, valor e dia de cobrança.", "atenção"); return; }
  const contaId = wrap.querySelector("#sm-conta").value || null;
  const categoria = wrap.querySelector("#sm-categoria").value.trim() || null;

  try {
    await walletApi.createSubscription({ nome, valor_esperado: valor, dia_cobranca: dia, conta_id: contaId, categoria });
  } catch (err) {
    showErrorModal(err.message, "erro ao criar assinatura");
    return;
  }
  closeSubscriptionModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeSubscriptionModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeSubscriptionModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitSubscription(wrap));
}

/** @param {{ accounts: Array, onSaved: () => Promise<void>|void }} opts */
export function openSubscriptionModal({ accounts, onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;

  modalEl.querySelector("#sm-nome").value = "";
  modalEl.querySelector("#sm-valor").value = "";
  modalEl.querySelector("#sm-dia").value = "";
  modalEl.querySelector("#sm-categoria").value = "";
  modalEl.querySelector("#sm-conta").innerHTML =
    `<option value="">— nenhuma, só lembrete —</option>` +
    (accounts || []).map((a) => `<option value="${a.id}">${a.bankNome} — ${a.nome}</option>`).join("");
  refreshCustomSelect(modalEl.querySelector("#sm-conta"));
  modalEl.classList.add("open");
}

export function closeSubscriptionModal() {
  modalEl?.classList.remove("open");
}