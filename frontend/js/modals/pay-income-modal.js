import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";
import { icon } from "../components/icons.js";

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
      <div class="modal-head"><span class="modal-head-title">marcar como paga</span> <span class="close" data-action="cancel">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field"><label>valor recebido</label><input type="number" id="pim-valor" placeholder="0.00"></div>
        <div class="field"><label>data</label><input type="date" id="pim-data"></div>
        <p class="ppm-conta-info" id="pim-conta-info"></p>
        <div class="form-actions">
          <button class="btn sm" data-action="cancel">cancelar</button>
          <button class="btn sm primary" data-action="confirm">confirmar</button>
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
  if (!valorStr || !paidDate) { showErrorModal("preenche o valor recebido e a data.", "atenção"); return; }

  const valorRecebido = Number(valorStr);
  const difereDoCadastrado = currentValorCadastrado != null && valorRecebido !== currentValorCadastrado;

  let atualizarValorFonte = false;
  if (difereDoCadastrado) {
    atualizarValorFonte = await showConfirmModal(
      `o valor recebido (R$ ${valorRecebido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) é diferente do cadastrado (R$ ${currentValorCadastrado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}). atualizar o valor da fonte pra esse daqui pra frente?`,
      { title: "atualizar valor da fonte?", confirmText: "atualizar pra frente", cancelText: "só essa vez" },
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
 *   há transação real, ver app/routers/financas.py::pay_income_entry).
 * @returns {Promise<{valor_recebido:number, paid_date:string, atualizar_valor_fonte:boolean}|null>}
 */
export function openPayIncomeModal({ nome, valorEsperado, expectedDate, conta = null }) {
  modalEl = modalEl || buildModal();
  currentValorCadastrado = valorEsperado ?? null;

  modalEl.querySelector(".modal-head-title").textContent = `marcar "${nome}" como paga`;
  modalEl.querySelector("#pim-valor").value = valorEsperado ?? "";
  modalEl.querySelector("#pim-data").value = expectedDate || new Date().toISOString().slice(0, 10);
  modalEl.querySelector("#pim-conta-info").textContent = conta
    ? `creditado em: ${conta.bankNome} — ${conta.nome}`
    : "sem conta vinculada — só um lembrete, não credita saldo em lugar nenhum";
  modalEl.classList.add("open");

  return new Promise((resolve) => { resolveCb = resolve; });
}
