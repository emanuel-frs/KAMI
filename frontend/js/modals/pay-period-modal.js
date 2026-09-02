import { showErrorModal } from "./err-modal.js";
import { enhanceSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";

/**
 * Modal "marcar como paga/pago" — usado por widgets/contas-fixas.js e
 * widgets/financas-assinaturas.js quando o registro (conta fixa /
 * assinatura) tem uma conta vinculada. Item 6: antes, marcar como pago nunca afetava saldo/fatura; agora, se há
 * conta vinculada, o usuário decide aqui (checkbox "descontar
 * automaticamente", ligado por padrão) se isso deve virar uma
 * transação real — igual um app de finanças de verdade perguntaria.
 *
 * Sem conta vinculada, os widgets nem chamam este modal — continuam
 * usando o prompt simples de valor (showPromptModal), só lembrete.
 *
 * Resolve com `null` se cancelado, ou com
 * `{ valor_pago, gerar_transacao, forma_pagamento }` pronto pra mandar
 * direto pro payload de payFixedBillPeriod/paySubscriptionPeriod.
 */

let modalEl = null;
let resolveCb = null;
let currentConta = null;

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "pay-period-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">marcar como paga</span> <span class="close" data-action="cancel">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field"><label>valor pago</label><input type="number" id="ppm-valor" placeholder="0.00"></div>
        <p class="ppm-conta-info" id="ppm-conta-info"></p>
        <label class="account-flag" id="ppm-gerar-wrap">
          <input type="checkbox" id="ppm-gerar" checked> descontar automaticamente da conta
        </label>
        <div class="field" id="ppm-forma-field" style="display:none;">
          <label>forma de pagamento</label>
          <select id="ppm-forma">
            <option value="saldo">saldo</option>
            <option value="credito">crédito</option>
          </select>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="cancel">cancelar</button>
          <button class="btn sm primary" data-action="confirm">confirmar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  enhanceSelect(wrap.querySelector("#ppm-forma"));
  return wrap;
}

function updateVisibility(wrap) {
  const gerar = wrap.querySelector("#ppm-gerar").checked;
  const ambiguous = currentConta && currentConta.possui_saldo && currentConta.possui_credito;
  wrap.querySelector("#ppm-forma-field").style.display = gerar && ambiguous ? "block" : "none";
}

function settle(value) {
  const cb = resolveCb;
  resolveCb = null;
  modalEl?.classList.remove("open");
  cb?.(value);
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="cancel"]').forEach((el) => el.addEventListener("click", () => settle(null)));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) settle(null); });
  wrap.querySelector("#ppm-gerar").addEventListener("change", () => updateVisibility(wrap));
  wrap.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    const valorStr = wrap.querySelector("#ppm-valor").value;
    const gerar = wrap.querySelector("#ppm-gerar").checked;
    const ambiguous = currentConta && currentConta.possui_saldo && currentConta.possui_credito;
    if (gerar && ambiguous) {
      const forma = wrap.querySelector("#ppm-forma").value;
      settle({ valor_pago: valorStr ? Number(valorStr) : null, gerar_transacao: true, forma_pagamento: forma });
    } else {
      settle({ valor_pago: valorStr ? Number(valorStr) : null, gerar_transacao: gerar, forma_pagamento: null });
    }
  });
}

/**
 * @param {{ nome: string, valorEsperado: number, conta: object }} opts
 *   `conta` precisa ter { bankNome, nome, possui_saldo, possui_credito }.
 * @returns {Promise<{valor_pago:number|null, gerar_transacao:boolean, forma_pagamento:string|null}|null>}
 */
export function openPayPeriodModal({ nome, valorEsperado, conta }) {
  if (!conta) {
    showErrorModal("essa conta fixa/assinatura não tem conta vinculada.", "erro interno");
    return Promise.resolve(null);
  }
  modalEl = modalEl || buildModal();
  currentConta = conta;

  modalEl.querySelector(".modal-head-title").textContent = `marcar "${nome}" como paga`;
  modalEl.querySelector("#ppm-valor").value = valorEsperado ?? "";
  modalEl.querySelector("#ppm-conta-info").textContent = `descontado de: ${conta.bankNome} — ${conta.nome}`;
  modalEl.querySelector("#ppm-gerar").checked = true;
  modalEl.querySelector("#ppm-forma").value = conta.possui_credito ? "credito" : "saldo";
  updateVisibility(modalEl);
  modalEl.classList.add("open");

  return new Promise((resolve) => { resolveCb = resolve; });
}
