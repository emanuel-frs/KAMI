import { imageToAscii, fitAsciiText } from "../components/ascii.js";
import { escapeHtml } from "../components/format.js";
import * as walletApi from "../api/wallet.js";
import { showErrorModal } from "./err-model.js";

/**
 * Modal "nova conta" / "editar conta" (decisão 18 — modais são o padrão
 * de criação/edição). Singleton igual avatar-modal.js: DOM construído
 * uma vez, reaproveitado depois. Recebe os bancos já carregados por quem
 * chamar (evita um segundo fetch) e devolve controle via onSaved.
 *
 * Edição: passar `account` (+ `bankName` pra exibição) faz o modal virar
 * "editar conta" — troca criar/adicionar por PUT em walletApi.updateAccount
 * e esconde o seletor de banco (mover uma conta de banco não é suportado
 * por ora; edição troca só os campos da própria conta).
 */

let modalEl = null;
let onSavedCb = null;
let pendingIconAscii = null;
let pendingBankId = null;
let pendingBankIsNew = false;
let editingAccount = null;

function bankIconInnerFallback(b) {
  return `<span class="ph">${b.nome.slice(0, 2).toUpperCase()}</span>`;
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "account-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">nova conta</span> <span class="close" data-action="close">×</span></div>
      <div class="modal-body">
        <div class="field" id="am-bank-field">
          <label>banco</label>
          <div class="bank-pick-list" id="am-bank-pick-list"></div>
        </div>
        <div class="field" id="am-bank-readonly" style="display:none;">
          <label>banco</label>
          <div class="am-bank-readonly-value"></div>
        </div>
        <div class="bank-new-fields" id="am-bank-new-fields">
          <div class="field">
            <label>nome do banco</label>
            <input type="text" id="am-nb-name" placeholder="ex: inter, c6, will bank...">
          </div>
          <div class="field">
            <label>imagem / logo (vira ícone em ascii)</label>
            <div class="al-drop" id="am-nb-drop">
              <div class="al-preview" id="am-nb-preview"><span class="ph">sem<br>imagem</span></div>
              <div style="flex:1; min-width:0;">
                <input type="file" id="am-nb-file" accept="image/*" style="width:100%; font-size:10.5px; color:var(--text-dim);">
                <div class="al-hint">arraste uma imagem ou clique pra escolher. convertida localmente pra ascii.</div>
              </div>
            </div>
          </div>
        </div>

        <hr class="rule">
        <div class="field">
          <label>nome da conta</label>
          <input type="text" id="am-na-name" placeholder="ex: conta corrente, cartão físico...">
        </div>

        <div class="account-flags">
          <label class="account-flag"><input type="checkbox" id="am-na-possui-saldo"> possui saldo</label>
          <label class="account-flag"><input type="checkbox" id="am-na-possui-credito"> possui crédito</label>
        </div>

        <div class="account-saldo-fields" id="am-account-saldo-fields">
          <div class="field"><label>saldo atual</label><input type="number" id="am-na-saldo" placeholder="0"></div>
        </div>
        <div class="account-credito-fields" id="am-account-credito-fields">
          <div class="field-row">
            <div class="field"><label>fatura atual</label><input type="number" id="am-na-fatura" placeholder="0"></div>
            <div class="field"><label>limite total</label><input type="number" id="am-na-limite" placeholder="1000"></div>
          </div>
          <div class="field"><label>dia de vencimento</label><input type="number" id="am-na-venc" min="1" max="31" placeholder="10"></div>
        </div>

        <div class="form-actions">
          <button class="btn sm" data-action="close">cancelar</button>
          <button class="btn sm primary" data-action="save">+ adicionar conta</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function updateFlagFields(wrap) {
  const saldoOn = wrap.querySelector("#am-na-possui-saldo").checked;
  const creditoOn = wrap.querySelector("#am-na-possui-credito").checked;
  wrap.querySelector("#am-account-saldo-fields").classList.toggle("show", saldoOn);
  wrap.querySelector("#am-account-credito-fields").classList.toggle("show", creditoOn);
}

function renderBankPickList(wrap, banks) {
  const list = wrap.querySelector("#am-bank-pick-list");
  const existing = banks.map((b) => {
    const iconInner = b.icon_ascii
      ? `<pre>${escapeHtml(b.icon_ascii)}</pre>`
      : bankIconInnerFallback(b);
    const on = pendingBankId === b.id && !pendingBankIsNew ? " on" : "";
    return `<div class="bank-pick-item${on}" data-pick-bank="${b.id}"><span class="bp-icon">${iconInner}</span><span>${escapeHtml(b.nome)}</span></div>`;
  }).join("");
  const newBtn = `<div class="bank-pick-item new-toggle${pendingBankIsNew ? " on" : ""}" data-pick-new-bank>+ novo banco</div>`;
  list.innerHTML = existing + newBtn;
  wrap.querySelector("#am-bank-new-fields").classList.toggle("show", pendingBankIsNew);

  // sem isso o ascii não aparece — <pre> precisa do font-size ajustado ao
  // espaço real do ícone. IMPORTANTE: isso só mede corretamente se o modal
  // já estiver com a classe "open" aplicada (ver openAccountModal) — com o
  // modal escondido (display:none) o container tem largura 0 e o texto
  // encolhe pro tamanho mínimo, ficando praticamente invisível.
  banks.forEach((b) => {
    if (!b.icon_ascii) return;
    const pre = list.querySelector(`[data-pick-bank="${b.id}"] .bp-icon pre`);
    if (pre) fitAsciiText(pre, pre.textContent, { container: pre.parentElement, maxHeight: 16, maxFont: 3.5, minFont: 0.3, paddingX: 2, paddingY: 2 });
  });

  list.querySelectorAll("[data-pick-bank]").forEach((node) => {
    node.addEventListener("click", () => {
      pendingBankId = node.getAttribute("data-pick-bank");
      pendingBankIsNew = false;
      renderBankPickList(wrap, banks);
    });
  });
  list.querySelector("[data-pick-new-bank]").addEventListener("click", () => {
    pendingBankId = null;
    pendingBankIsNew = true;
    renderBankPickList(wrap, banks);
  });
}

function loadBankIconFile(wrap, file) {
  if (!file || !file.type.startsWith("image/")) return;
  const img = new Image();
  img.onload = () => {
    const { ascii } = imageToAscii(img, { cols: 46 });
    pendingIconAscii = ascii;
    const prev = wrap.querySelector("#am-nb-preview");
    prev.innerHTML = '<pre id="am-nb-preview-pre"></pre>';
    const pre = wrap.querySelector("#am-nb-preview-pre");
    pre.textContent = ascii;
    fitAsciiText(pre, ascii, { container: prev, maxHeight: 36, maxFont: 6, minFont: 0.35, paddingX: 4, paddingY: 4 });
  };
  img.src = URL.createObjectURL(file);
}

async function submitAccount(wrap) {
  const nome = wrap.querySelector("#am-na-name").value.trim();
  if (!nome) { showErrorModal("dá um nome pra conta.", "atenção"); return; }

  const possuiSaldo = wrap.querySelector("#am-na-possui-saldo").checked;
  const possuiCredito = wrap.querySelector("#am-na-possui-credito").checked;
  const payload = {
    nome,
    possui_saldo: possuiSaldo,
    saldo_atual: possuiSaldo ? Number(wrap.querySelector("#am-na-saldo").value) || 0 : null,
    possui_credito: possuiCredito,
    fatura_atual: possuiCredito ? Number(wrap.querySelector("#am-na-fatura").value) || 0 : null,
    limite_total: possuiCredito ? Number(wrap.querySelector("#am-na-limite").value) || 0 : null,
    dia_vencimento: possuiCredito ? Number(wrap.querySelector("#am-na-venc").value) || null : null,
  };

  if (editingAccount) {
    try {
      await walletApi.updateAccount(editingAccount.id, payload);
    } catch (err) {
      showErrorModal(err.message, "erro ao salvar conta");
      return;
    }
    closeAccountModal();
    await onSavedCb?.();
    return;
  }

  let bankId = pendingBankId;
  if (pendingBankIsNew) {
    const bankNome = wrap.querySelector("#am-nb-name").value.trim();
    if (!bankNome) { showErrorModal("dá um nome pro banco.", "atenção"); return; }
    try {
      const bank = await walletApi.createBank({ nome: bankNome, icon_ascii: pendingIconAscii });
      bankId = bank.id;
    } catch (err) {
      showErrorModal(err.message, "erro ao criar banco");
      return;
    }
  }
  if (!bankId) { showErrorModal("escolhe um banco.", "atenção"); return; }

  try {
    await walletApi.createAccount(bankId, payload);
  } catch (err) {
    showErrorModal(err.message, "erro ao criar conta");
    return;
  }
  closeAccountModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeAccountModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeAccountModal(); });

  wrap.querySelector("#am-na-possui-saldo").addEventListener("change", () => updateFlagFields(wrap));
  wrap.querySelector("#am-na-possui-credito").addEventListener("change", () => updateFlagFields(wrap));

  wrap.querySelector("#am-nb-file").addEventListener("change", (e) => loadBankIconFile(wrap, e.target.files[0]));
  const drop = wrap.querySelector("#am-nb-drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => loadBankIconFile(wrap, e.dataTransfer.files && e.dataTransfer.files[0]));

  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitAccount(wrap));
}

/**
 * @param {{ banks: Array, account?: object, bankName?: string, onSaved: () => Promise<void>|void }} opts
 *   `banks` — lista já carregada por quem chamou (o widget wallet.js já
 *   tem isso em mãos, evita um segundo fetch aqui).
 *   `account` — se informado, o modal abre em modo edição (PUT em vez
 *   de POST) pré-preenchido com os dados da conta; `bankName` é só pra
 *   exibição (o banco da conta não é editável por aqui).
 */
export function openAccountModal({ banks, account = null, bankName = "", onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  pendingIconAscii = null;
  editingAccount = account || null;

  const bankField = modalEl.querySelector("#am-bank-field");
  const bankReadonly = modalEl.querySelector("#am-bank-readonly");
  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');

  if (editingAccount) {
    titleEl.textContent = "editar conta";
    saveBtn.textContent = "salvar alterações";
    bankField.style.display = "none";
    bankReadonly.style.display = "block";
    bankReadonly.querySelector(".am-bank-readonly-value").textContent = bankName || "—";
    pendingBankId = null;
    pendingBankIsNew = false;
  } else {
    titleEl.textContent = "nova conta";
    saveBtn.textContent = "+ adicionar conta";
    bankField.style.display = "";
    bankReadonly.style.display = "none";
    pendingBankId = banks?.length ? banks[0].id : null;
    pendingBankIsNew = !banks?.length;
  }

  modalEl.querySelector("#am-nb-name").value = "";
  modalEl.querySelector("#am-nb-file").value = "";
  modalEl.querySelector("#am-nb-preview").innerHTML = '<span class="ph">sem<br>imagem</span>';
  modalEl.querySelector("#am-na-name").value = editingAccount?.nome || "";
  modalEl.querySelector("#am-na-possui-saldo").checked = editingAccount?.possui_saldo || false;
  modalEl.querySelector("#am-na-possui-credito").checked = editingAccount?.possui_credito || false;
  modalEl.querySelector("#am-na-saldo").value = editingAccount?.saldo_atual ?? "";
  modalEl.querySelector("#am-na-fatura").value = editingAccount?.fatura_atual ?? "";
  modalEl.querySelector("#am-na-limite").value = editingAccount?.limite_total ?? "";
  modalEl.querySelector("#am-na-venc").value = editingAccount?.dia_vencimento ?? "";
  updateFlagFields(modalEl);

  // abre o modal ANTES de montar a lista de bancos — renderBankPickList
  // usa fitAsciiText, que mede a largura real do container; com o modal
  // ainda fechado (display:none) essa largura é 0 e o ícone nunca aparece
  // no tamanho certo. Em modo edição isso é pulado (banco não é exibido).
  modalEl.classList.add("open");
  if (!editingAccount) renderBankPickList(modalEl, banks || []);
}

export function closeAccountModal() {
  modalEl?.classList.remove("open");
}