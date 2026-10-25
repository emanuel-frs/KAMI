import * as financasApi from "../api/financas.js";
import * as carteiraApi from "../api/carteira.js";
import { escapeHtml } from "../components/format.js";
import { openContaFixaModal } from "../modals/conta-fixa-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { showPromptModal } from "../modals/prompt-modal.js";
import { openPayPeriodModal } from "../modals/pay-period-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { icon } from "../components/icons.js";
import { t } from "../i18n.js";

/**
 * Widget "contas fixas". Cadastro (nome/valor/dia/conta/categoria)
 * continua CRUD simples via conta-fixa-modal.js — igual antes.
 *
 * A exibição mensal segue o MESMO padrão de financas-assinaturas.js:
 * instância por (conta fixa, mês) com toggle pago/não-pago
 * (GET/PUT /fixed-bills/periods, unificação do item 1).
 *
 * Marcar como paga pode gerar uma transação real (item 6) quando a
 * conta fixa tem conta_id vinculada — nesse caso abre
 * pay-period-modal.js pra confirmar valor/conta/forma de pagamento.
 * Sem conta vinculada, continua sendo só lembrete (prompt simples de
 * valor, sem afetar saldo) — o tooltip no botão deixa isso explícito.
 */

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("contas.carregando")}</div>`;
  const month = currentMonthStr();
  let bills = [];
  let periods = [];
  let banks = [];

  function flatAccounts() {
    return banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
  }

  async function reload() {
    try {
      [bills, periods, banks] = await Promise.all([
        financasApi.listFixedBills(),
        financasApi.listFixedBillPeriods(month),
        carteiraApi.listBanks(),
      ]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("contas.erro", { erro: err.message }))}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    const focusId = consumePendingFocus("conta_fixa");
    const periodByBill = {};
    periods.forEach((p) => { periodByBill[p.fixed_bill_id] = p; });

    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-bill">${t("contas.nova")}</button>
      </div>
      <div class="contas-fixas-list">
        ${bills.length ? bills.map((b) => {
          // instância mensal só existe pra contas ativas (mesma regra de
          // assinaturas — GET /fixed-bills/periods filtra active=1)
          const period = b.active ? periodByBill[b.id] : null;
          const paga = period ? period.paga : false;
          const valor = period && period.valor_pago != null ? period.valor_pago : b.amount;
          const tooltip = b.conta_id
            ? t("contas.com_conta")
            : t("contas.sem_conta");
          return `
            <div class="conta-fixa-row${b.active ? (paga ? " paga" : "") : " inactive"}" data-conta-fixa-id="${b.id}">
              <div class="cf-top">
                <span class="cf-name" data-edit-bill="${b.id}" data-tooltip="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
                <span class="cf-remove cf-lembrar" data-lembrar-bill="${b.id}" data-tooltip="${t("contas.lembrar")}" aria-label="${t("contas.lembrar")}">${icon("bell-ring", { size: 11 })}</span>
                <span class="cf-remove" data-remove-bill="${b.id}" data-tooltip="${t("contas.remover")}" aria-label="${t("contas.remover")}">${icon("x", { size: 11 })}</span>
              </div>
              <div class="cf-meta">
                <span class="cf-valor">${brl(valor)}</span>
                <span class="cf-dia">dia ${b.due_day}</span>
                ${period && period.gerou_transacao ? `<span class="cf-tx-tag" data-tooltip="${t("contas.gerou_tx")}">R$</span>` : ""}
                ${b.active
                  ? `<button class="cf-toggle${paga ? " paga" : ""}" data-toggle-period="${period ? period.id : ""}" data-bill-id="${b.id}"
                      data-tooltip="${tooltip}" aria-label="${tooltip}">
                      ${paga ? t("contas.paga") : t("contas.marcar_paga")}
                    </button>`
                  : `<span class="cf-inactive-tag">${t("renda.inativa")}</span>`}
              </div>
            </div>`;
        }).join("") : `<div class="wallet-empty">${t("contas.vazio")}</div>`}
      </div>
    `;

    el.querySelectorAll("[data-edit-bill]").forEach((el2) => {
      el2.addEventListener("click", () => {
        const id = el2.getAttribute("data-edit-bill");
        const bill = bills.find((b) => b.id === id);
        if (bill) openContaFixaModal({ bill, accounts: flatAccounts(), onSaved: reload });
      });
    });

    el.querySelectorAll("[data-toggle-period]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const periodId = btn.getAttribute("data-toggle-period");
        if (!periodId) return;
        const isPaga = btn.classList.contains("paga");
        if (isPaga) {
          await financasApi.unpayFixedBillPeriod(periodId);
        } else {
          const bill = bills.find((b) => b.id === btn.getAttribute("data-bill-id"));
          const conta = bill?.conta_id ? flatAccounts().find((a) => a.id === bill.conta_id) : null;

          let payload;
          if (conta) {
            payload = await openPayPeriodModal({ nome: bill.name, valorEsperado: bill.amount, conta });
            if (payload === null) return; // cancelado
          } else {
            const valorStr = await showPromptModal(t("contas.valor_pago"), {
              title: t("contas.marcar_titulo"),
              placeholder: t("contas.valor_placeholder"),
              inputType: "number",
            });
            if (valorStr === null) return; // cancelado
            payload = { valor_pago: valorStr ? Number(valorStr) : null, gerar_transacao: false };
          }
          try {
            await financasApi.payFixedBillPeriod(periodId, payload);
          } catch (err) {
            showErrorModal(err.message, t("contas.erro_pagar"));
            return;
          }
        }
        await reload();
      });
    });

    // ORG-05: lembrete ligado à conta fixa (sugere o dia do vencimento)
    el.querySelectorAll("[data-lembrar-bill]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const bill = bills.find((x) => x.id === btn.getAttribute("data-lembrar-bill"));
        if (!bill) return;
        const { openLembreteModal } = await import("../modals/lembrete-modal.js");
        openLembreteModal({ vinculo: { tipo: "conta_fixa", id: bill.id, nome: bill.name }, inicial: { titulo: t("contas.lembrete_titulo", { nome: bill.name }) } });
      });
    });

    el.querySelectorAll("[data-remove-bill]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal(t("contas.remover_confirma"), { title: t("contas.remover"), confirmText: t("geral.remover"), danger: true }))) return;
        await financasApi.deleteFixedBill(btn.getAttribute("data-remove-bill"));
        await reload();
      });
    });

    el.querySelector('[data-action="add-bill"]').addEventListener("click", () => {
      openContaFixaModal({ accounts: flatAccounts(), onSaved: reload });
    });

    // drill-down do Calendário: abre direto o modal de edição, além de
    // manter o destaque visual da linha (mesmo padrão de antes).
    if (focusId) {
      const bill = bills.find((b) => b.id === focusId);
      if (bill) {
        focusRow(el.querySelector(`[data-conta-fixa-id="${focusId}"]`), "conta_fixa");
        openContaFixaModal({ bill, accounts: flatAccounts(), onSaved: reload });
      }
    }
  }

  await reload();
}
