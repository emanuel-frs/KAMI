import * as financasApi from "../api/financas.js";
import { showErrorModal } from "./err-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { escapeHtml, localDateKey } from "../components/format.js";

/**
 * Modal "novo lançamento" — entrada/saída/transferência. Recebe as
 * contas já achatadas (com bankNome) por quem chamar. Dispara
 * 'kami:wallet-changed' (wallet.js e financas-resumo.js escutam). O xp
 * que todo lançamento credita em financas é percebido por
 * components/progress-watcher.js, que dispara 'kami:action-registered'.
 */

let modalEl = null;
let onSavedCb = null;
let accountsFlat = [];
let editingId = null; // CONF-07: id do lançamento sendo corrigido (null = lançamento novo)

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "transaction-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span id="tm-title">novo lançamento</span> <button type="button" class="close" data-action="close" aria-label="fechar">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field">
          <label for="tm-type">tipo</label>
          <select id="tm-type">
            <option value="entrada">entrada</option>
            <option value="saida">saída</option>
            <option value="transferencia">transferência</option>
          </select>
        </div>
        <div class="field">
          <label for="tm-desc">descrição</label>
          <input type="text" id="tm-desc" placeholder="ex: mercado, salário...">
        </div>
        <div class="field-row">
          <div class="field"><label for="tm-amount">valor</label><input type="number" id="tm-amount" placeholder="0.00"></div>
          <div class="field"><label for="tm-date">data</label><input type="date" id="tm-date"></div>
        </div>
        <div class="field" id="tm-category-field">
          <label for="tm-category">categoria</label>
          <input type="text" id="tm-category" placeholder="ex: alimentacao, transporte...">
        </div>
        <div class="field">
          <label for="tm-conta">conta</label>
          <select id="tm-conta"></select>
        </div>
        <div class="field" id="tm-forma-pagamento-field" style="display:none;">
          <label for="tm-forma-pagamento">forma de pagamento</label>
          <select id="tm-forma-pagamento">
            <option value="saldo">saldo</option>
            <option value="credito">crédito</option>
          </select>
        </div>
        <div class="field" id="tm-destino-tipo-field" style="display:none;">
          <label for="tm-destino-tipo">destino</label>
          <select id="tm-destino-tipo">
            <option value="interna">conta cadastrada</option>
            <option value="externa">externo (pix, saque...)</option>
          </select>
        </div>
        <div class="field" id="tm-conta-destino-field" style="display:none;">
          <label for="tm-conta-destino">conta de destino</label>
          <select id="tm-conta-destino"></select>
        </div>
        <div class="field" id="tm-destino-externo-field" style="display:none;">
          <label for="tm-destino-externo">destino (texto livre)</label>
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
  const opts = accountsFlat.map((a) => `<option value="${a.id}">${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}</option>`).join("");
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
    // CONF-07: corrigindo, troca o lançamento de uma vez no backend
    if (editingId) await financasApi.updateTransaction(editingId, payload);
    else await financasApi.createTransaction(payload);
  } catch (err) {
    showErrorModal(err.message, editingId ? "erro ao corrigir" : "erro ao lançar");
    return;
  }
  closeTransacaoModal();
  window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
  // o xp do lançamento (e o refresh dos widgets do Núcleo) fica com
  // components/progress-watcher.js, que reage a qualquer escrita
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeTransacaoModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeTransacaoModal(); });
  wrap.querySelector("#tm-type").addEventListener("change", () => updateVisibility(wrap));
  wrap.querySelector("#tm-conta").addEventListener("change", () => updateVisibility(wrap));
  wrap.querySelector("#tm-destino-tipo").addEventListener("change", () => updateVisibility(wrap));
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitTransaction(wrap));
}

/**
 * @param {{ accounts: Array, onSaved: () => Promise<void>|void, editing?: object }} opts
 *   `accounts` já achatadas com bankNome — ex: banks.flatMap(b =>
 *   b.accounts.map(a => ({ ...a, bankNome: b.nome }))).
 *   `editing`: um lançamento avulso a corrigir (CONF-07) — o modal abre
 *   preenchido e salvar chama PUT /transactions/{id}.
 */
export function openTransacaoModal({ accounts, onSaved, editing = null, inicial = null } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  accountsFlat = accounts || [];
  editingId = editing?.id || null;
  modalEl.querySelector("#tm-title").textContent = editing ? "corrigir lançamento" : "novo lançamento";
  modalEl.querySelector('[data-action="save"]').textContent = editing ? "salvar correção" : "+ lançar";

  modalEl.querySelector("#tm-type").value = "entrada";
  refreshCustomSelect(modalEl.querySelector("#tm-type"));
  modalEl.querySelector("#tm-desc").value = "";
  modalEl.querySelector("#tm-amount").value = "";
  modalEl.querySelector("#tm-date").value = localDateKey();
  modalEl.querySelector("#tm-category").value = "";
  modalEl.querySelector("#tm-destino-tipo").value = "interna";
  refreshCustomSelect(modalEl.querySelector("#tm-destino-tipo"));
  modalEl.querySelector("#tm-destino-externo").value = "";
  populateContaSelects(modalEl);
  if (editing) fillFrom(modalEl, editing);
  // ORG-02: captura rápida ("$ 25 almoço") abre já preenchido — só o que
  // veio; o resto fica no padrão do modal
  else if (inicial) {
    const campos = { "#tm-type": inicial.type || "saida", "#tm-desc": inicial.description, "#tm-amount": inicial.amount, "#tm-date": inicial.date };
    for (const [sel, v] of Object.entries(campos)) {
      if (v === undefined || v === null || v === "") continue;
      const el = modalEl.querySelector(sel);
      el.value = v;
      if (el.tagName === "SELECT") refreshCustomSelect(el);
    }
  }
  updateVisibility(modalEl);
  modalEl.classList.add("open");
}

/** Preenche o modal com um lançamento existente (modo corrigir, CONF-07). */
function fillFrom(wrap, t) {
  const set = (sel, v) => {
    const el = wrap.querySelector(sel);
    el.value = v ?? "";
    if (el.tagName === "SELECT") refreshCustomSelect(el);
  };
  set("#tm-type", t.type);
  set("#tm-desc", t.description);
  set("#tm-amount", t.amount);
  set("#tm-date", t.date);
  if (t.type !== "transferencia") set("#tm-category", t.category);
  set("#tm-conta", t.conta_id);
  if (t.forma_pagamento) set("#tm-forma-pagamento", t.forma_pagamento);
  if (t.type === "transferencia") {
    set("#tm-destino-tipo", t.conta_destino_id ? "interna" : "externa");
    if (t.conta_destino_id) set("#tm-conta-destino", t.conta_destino_id);
    else set("#tm-destino-externo", t.destino_externo);
  }
}

export function closeTransacaoModal() {
  modalEl?.classList.remove("open");
}