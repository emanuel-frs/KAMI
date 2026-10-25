import * as financasApi from "../api/financas.js";
import { showErrorModal } from "./err-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { noIdiomaAtual, t } from "../i18n.js";

/**
 * Modal "nova dívida" / "editar dívida" — mesmo padrão dual singleton de
 * fixed-bill-modal.js/subscription-modal.js: passar `debt` faz o modal
 * virar edição (PUT em vez de POST), pré-preenchido com os dados da
 * dívida. `PUT /debts/{id}` já existia no backend (usado pelo `<select>`
 * de status em dividas.js) — aqui só passa a editar TODOS os campos, não
 * só o status (item 4).
 */

let modalEl = null;
let onSavedCb = null;
let editingDebt = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "debt-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("divida.nova_divida")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field"><label for="dm-desc">${t("divida.descricao")}</label><input type="text" id="dm-desc" placeholder="${t("divida.ex_emprestimo_parcelamento")}"></div>
        <div class="field"><label for="dm-counterparty">${t("divida.credor_opcional")}</label><input type="text" id="dm-counterparty" placeholder="${t("divida.ex_banco_x_fulano")}"></div>
        <div class="field-row">
          <div class="field"><label for="dm-amount">${t("divida.valor")}</label><input type="number" id="dm-amount" placeholder="0.00"></div>
          <div class="field"><label for="dm-due">${t("divida.vencimento_opcional")}</label><input type="date" id="dm-due"></div>
        </div>
        <div class="field">
          <label for="dm-status">${t("divida.status")}</label>
          <select id="dm-status">
            <option value="aberta">${t("divida.aberta")}</option>
            <option value="paga">${t("divida.paga")}</option>
          </select>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="save">${t("divida.adicionar")}</button>
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
  if (!description || !amount) { showErrorModal(t("divida.preenche_descricao_e_valor"), t("geral.atencao")); return; }

  const payload = {
    description,
    counterparty: wrap.querySelector("#dm-counterparty").value.trim() || null,
    amount,
    due_date: wrap.querySelector("#dm-due").value.trim() || null,
    status: wrap.querySelector("#dm-status").value,
  };

  try {
    if (editingDebt) {
      await financasApi.updateDebt(editingDebt.id, payload);
    } else {
      await financasApi.createDebt(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingDebt ? t("divida.erro_ao_salvar_divida") : t("divida.erro_ao_criar_divida"));
    return;
  }
  closeDividaModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeDividaModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeDividaModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitDebt(wrap));
}

/**
 * @param {{ debt?: object, onSaved: () => Promise<void>|void }} opts
 *   `debt` — se informado, o modal abre em modo edição (PUT em vez de
 *   POST) pré-preenchido com os dados da dívida.
 */
export function openDividaModal({ debt = null, onSaved } = {}) {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  onSavedCb = onSaved;
  editingDebt = debt || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingDebt ? t("divida.editar_divida") : t("divida.nova_divida");
  saveBtn.textContent = editingDebt ? t("divida.salvar_alteracoes") : "+ adicionar";

  modalEl.querySelector("#dm-desc").value = editingDebt?.description || "";
  modalEl.querySelector("#dm-counterparty").value = editingDebt?.counterparty || "";
  modalEl.querySelector("#dm-amount").value = editingDebt?.amount ?? "";
  modalEl.querySelector("#dm-due").value = editingDebt?.due_date || "";
  modalEl.querySelector("#dm-status").value = editingDebt?.status || "aberta";
  refreshCustomSelect(modalEl.querySelector("#dm-status"));
  modalEl.classList.add("open");
}

export function closeDividaModal() {
  modalEl?.classList.remove("open");
}
