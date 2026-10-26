import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";
import { icon } from "../components/icons.js";
import { fmtMoney, localDateKey } from "../components/format.js";
import { noIdiomaAtual, t } from "../i18n.js";

/**
 * Modal "marcar renda como paga" — usado por widgets/financas-renda.js.
 * Reaproveita a estrutura de pay-period-modal.js (valor editável +
 * confirmar), mas com uma diferença central: se o valor digitado for
 * diferente do valor cadastrado na fonte, pergunta (via
 * showConfirmModal) se isso deve virar o novo valor esperado da fonte
 * daqui pra frente, ou só valer pra essa ocorrência — antes, confirmar
 * sempre usava o `amount` da fonte sem opção nenhuma (item da spec do
 * redesenho de renda recorrente).
 *
 * Resolve com `null` se cancelado, ou com
 * `{ valor_recebido, paid_date, atualizar_valor_fonte }` pronto pra
 * mandar direto pro payload de financasApi.payIncomeEntry.
 */

let modalEl = null;
let resolveCb = null;
let currentValorCadastrado = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "pay-income-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("pay_income.marcar_como_paga")}</span> <button type="button" class="close" data-action="cancel" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field"><label for="pim-valor">${t("pay_income.valor_recebido")}</label><input type="number" id="pim-valor" placeholder="0.00"></div>
        <div class="field"><label for="pim-data">${t("pay_income.data")}</label><input type="date" id="pim-data"></div>
        <p class="ppm-conta-info" id="pim-conta-info"></p>
        <div class="form-actions">
          <button class="btn sm" data-action="cancel">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="confirm">${t("geral.confirmar")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function settle(value) {
  const cb = resolveCb;
  resolveCb = null;
  modalEl?.classList.remove("open");
  cb?.(value);
}

async function handleConfirm(wrap) {
  const valorStr = wrap.querySelector("#pim-valor").value;
  const paidDate = wrap.querySelector("#pim-data").value;
  if (!valorStr || !paidDate) { showErrorModal(t("pay_income.preenche_o_valor_recebido_e"), t("geral.atencao")); return; }

  const valorRecebido = Number(valorStr);
  const difereDoCadastrado = currentValorCadastrado != null && valorRecebido !== currentValorCadastrado;

  let atualizarValorFonte = false;
  if (difereDoCadastrado) {
    atualizarValorFonte = await showConfirmModal(
      t("pay_income.valor_diferente", { recebido: fmtMoney(valorRecebido), cadastrado: fmtMoney(currentValorCadastrado) }),
      { title: t("pay_income.atualizar_valor_da_fonte"), confirmText: t("pay_income.atualizar_pra_frente"), cancelText: t("pay_income.so_essa_vez") },
    );
  }

  settle({ valor_recebido: valorRecebido, paid_date: paidDate, atualizar_valor_fonte: atualizarValorFonte });
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="cancel"]').forEach((el) => el.addEventListener("click", () => settle(null)));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) settle(null); });
  wrap.querySelector('[data-action="confirm"]').addEventListener("click", () => handleConfirm(wrap));
}

/**
 * @param {{ nome: string, valorEsperado: number, expectedDate: string, conta?: object }} opts
 *   `conta` opcional — só pra exibir de onde o dinheiro vai entrar; sem
 *   ela, marcar como paga continua sendo só lembrete (sem conta_id não
 *   há transação real, ver app/routers/financas/renda.py::pay_income_entry).
 * @returns {Promise<{valor_recebido:number, paid_date:string, atualizar_valor_fonte:boolean}|null>}
 */
export function openPayIncomeModal({ nome, valorEsperado, expectedDate, conta = null }) {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  currentValorCadastrado = valorEsperado ?? null;

  modalEl.querySelector(".modal-head-title").textContent = t("pagar.titulo", { nome });
  modalEl.querySelector("#pim-valor").value = valorEsperado ?? "";
  modalEl.querySelector("#pim-data").value = expectedDate || localDateKey();
  modalEl.querySelector("#pim-conta-info").textContent = conta
    ? t("pay_income.creditado_em", { banco: conta.bankNome, conta: conta.nome })
    : t("pay_income.sem_conta_vinculada_so_um");
  modalEl.classList.add("open");

  return new Promise((resolve) => { resolveCb = resolve; });
}
