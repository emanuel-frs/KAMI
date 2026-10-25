import { enhanceSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { escapeHtml } from "../components/format.js";
import { estaNoDocumento } from "../components/no-documento.js";
import { t } from "../i18n.js";

/**
 * Modal "quitar dívida" (P-13, CONF-04) — aberto por widgets/dividas.js
 * quando a dívida é marcada como "paga".
 *
 * Quitar funciona como pagar uma conta fixa (ver pay-period-modal.js):
 * a pessoa escolhe de qual conta o dinheiro saiu e o app lança a saída
 * real (categoria "dívidas"), descontando saldo/fatura. Diferente da
 * conta fixa, a dívida não tem conta vinculada no cadastro — por isso o
 * select aqui, com "nenhuma conta" como opção (só marca como quitada).
 *
 * Resolve com `null` se cancelado, ou com `{ conta_id, forma_pagamento }`
 * pronto pro payload de financasApi.payDebt.
 */

let modalEl = null;
let resolveCb = null;
let accountsFlat = [];

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "quitar-divida-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("quitar_divida.quitar_divida")}</span> <button type="button" class="close" data-action="cancel" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <p class="qdm-info" id="qdm-info"></p>
        <div class="field">
          <label for="qdm-conta">${t("quitar_divida.o_dinheiro_saiu_de")}</label>
          <select id="qdm-conta"></select>
        </div>
        <div class="field" id="qdm-forma-field" style="display:none;">
          <label for="qdm-forma">${t("quitar_divida.forma_de_pagamento")}</label>
          <select id="qdm-forma">
            <option value="saldo">${t("quitar_divida.saldo")}</option>
            <option value="credito">${t("quitar_divida.credito")}</option>
          </select>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="cancel">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="confirm">${t("quitar_divida.quitar")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-action="cancel"]').forEach((b) => b.addEventListener("click", () => close(null)));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(null); });
  wrap.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    const contaId = wrap.querySelector("#qdm-conta").value || null;
    const formaVisible = wrap.querySelector("#qdm-forma-field").style.display !== "none";
    close({ conta_id: contaId, forma_pagamento: contaId && formaVisible ? wrap.querySelector("#qdm-forma").value : null });
  });
  wrap.querySelector("#qdm-conta").addEventListener("change", () => syncForma(wrap));
  return wrap;
}

function syncForma(wrap) {
  const conta = accountsFlat.find((a) => a.id === wrap.querySelector("#qdm-conta").value);
  wrap.querySelector("#qdm-forma-field").style.display = conta && conta.possui_saldo && conta.possui_credito ? "block" : "none";
}

function close(result) {
  modalEl?.classList.remove("open");
  const cb = resolveCb;
  resolveCb = null;
  cb?.(result);
}

/**
 * @param {{ debt: {description: string, amount: number}, accounts: Array }} opts
 *   `accounts` já achatadas com bankNome (mesmo formato do transacao-modal.js).
 */
export function openQuitarDividaModal({ debt, accounts = [] }) {
  if (!estaNoDocumento(modalEl)) modalEl = buildModal();
  accountsFlat = accounts.filter((a) => a.possui_saldo || a.possui_credito);
  modalEl.querySelector("#qdm-info").textContent = `${debt.description} — ${brl(debt.amount)}`;
  const select = modalEl.querySelector("#qdm-conta");
  select.innerHTML =
    `<option value="">${t("quitar_divida.nenhuma_conta_so_marcar_como")}</option>` +
    accountsFlat.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}</option>`).join("");
  // sugestão: a primeira conta COM SALDO — quitar dívida costuma sair da
  // conta corrente, não do cartão (visto no teste: a primeira da lista era
  // um cartão de crédito). Sem conta de saldo, a primeira que houver.
  select.value = (accountsFlat.find((a) => a.possui_saldo) || accountsFlat[0])?.id || "";
  enhanceSelect(select);
  enhanceSelect(modalEl.querySelector("#qdm-forma"));
  syncForma(modalEl);
  modalEl.classList.add("open");
  return new Promise((resolve) => {
    resolveCb = resolve;
  });
}
