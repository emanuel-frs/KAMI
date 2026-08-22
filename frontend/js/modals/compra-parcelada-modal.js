import * as walletApi from "../api/wallet.js";
import { showErrorModal } from "./err-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";

/**
 * Modal "nova compra parcelada" / "editar compra parcelada" — mesmo
 * padrão dual singleton de fixed-bill-modal.js/subscription-modal.js:
 * passar `compra` faz o modal virar edição (PUT em vez de POST),
 * pré-preenchido com os dados da compra. A reconciliação da reserva no
 * limite (desfazer o valor antigo antes de aplicar o novo) é feita
 * inteira no backend (ver update_compra_parcelada em wallet.py) — o
 * modal só manda os dados novos.
 *
 * Conta é opcional (referência visual + destino da aplicação automática
 * na fatura, se preenchida).
 */

let modalEl = null;
let onSavedCb = null;
let editingCompra = null;

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "compra-parcelada-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">nova compra parcelada</span> <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field"><label>nome</label><input type="text" id="cpm-nome" placeholder="ex: notebook, geladeira..."></div>
        <div class="field-row">
          <div class="field"><label>valor total</label><input type="number" id="cpm-valor" placeholder="0.00"></div>
          <div class="field"><label>número de parcelas</label><input type="number" id="cpm-parcelas" min="1" placeholder="12"></div>
        </div>
        <div class="field">
          <label>mês da 1ª parcela</label>
          <input type="text" id="cpm-mes" placeholder="YYYY-MM">
        </div>
        <div class="field">
          <label>conta (opcional — soma a parcela na fatura dela todo mês)</label>
          <select id="cpm-conta"><option value="">— nenhuma —</option></select>
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
  return wrap;
}

async function submitCompraParcelada(wrap) {
  const nome = wrap.querySelector("#cpm-nome").value.trim();
  const valorTotal = Number(wrap.querySelector("#cpm-valor").value);
  const numParcelas = Number(wrap.querySelector("#cpm-parcelas").value);
  const mes = wrap.querySelector("#cpm-mes").value.trim();
  if (!nome || !valorTotal || !numParcelas || !mes) {
    showErrorModal("preenche nome, valor total, número de parcelas e mês da 1ª parcela.", "atenção");
    return;
  }
  const contaId = wrap.querySelector("#cpm-conta").value || null;

  const payload = {
    nome,
    valor_total: valorTotal,
    num_parcelas: numParcelas,
    conta_id: contaId,
    mes_primeira_parcela: mes,
  };

  try {
    if (editingCompra) {
      await walletApi.updateCompraParcelada(editingCompra.id, payload);
    } else {
      await walletApi.createCompraParcelada(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingCompra ? "erro ao salvar compra parcelada" : "erro ao criar compra parcelada");
    return;
  }
  closeCompraParceladaModal();
  window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeCompraParceladaModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeCompraParceladaModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitCompraParcelada(wrap));
}

/**
 * @param {{ compra?: object, accounts?: Array, onSaved: () => Promise<void>|void }} opts
 *   `compra` — se informado, o modal abre em modo edição (PUT em vez de
 *   POST) pré-preenchido com os dados da compra parcelada. Note que
 *   `ajuste_parcelas` NÃO é editável aqui — isso continua sendo só pelos
 *   botões de ajuste (setas) do widget (ver compras-parceladas.js/item 7).
 */
export function openCompraParceladaModal({ compra = null, accounts = [], onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  editingCompra = compra || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingCompra ? "editar compra parcelada" : "nova compra parcelada";
  saveBtn.textContent = editingCompra ? "salvar alterações" : "+ adicionar";

  modalEl.querySelector("#cpm-nome").value = editingCompra?.nome || "";
  modalEl.querySelector("#cpm-valor").value = editingCompra?.valor_total ?? "";
  modalEl.querySelector("#cpm-parcelas").value = editingCompra?.num_parcelas ?? "";
  modalEl.querySelector("#cpm-mes").value = editingCompra?.mes_primeira_parcela || currentMonthStr();
  modalEl.querySelector("#cpm-conta").innerHTML =
    `<option value="">— nenhuma —</option>` +
    (accounts || []).map((a) => `<option value="${a.id}">${a.bankNome} — ${a.nome}</option>`).join("");
  modalEl.querySelector("#cpm-conta").value = editingCompra?.conta_id || "";
  refreshCustomSelect(modalEl.querySelector("#cpm-conta"));
  modalEl.classList.add("open");
}

export function closeCompraParceladaModal() {
  modalEl?.classList.remove("open");
}
