import * as carteiraApi from "../api/carteira.js";
import { escapeHtml } from "../components/format.js";
import { openAssinaturaModal } from "../modals/assinatura-modal.js";
import { openAssinaturaFilterModal } from "../modals/assinatura-filter-modal.js";
import { showPromptModal } from "../modals/prompt-modal.js";
import { openPayPeriodModal } from "../modals/pay-period-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { icon } from "../components/icons.js";
import { t } from "../i18n.js";

/**
 * Widget "assinaturas". Marcar como paga pode gerar uma transação real
 * (item 6) quando a assinatura tem conta_id
 * vinculada — nesse caso abre pay-period-modal.js pra confirmar valor/
 * conta/forma de pagamento. Sem conta vinculada, continua sendo só
 * lembrete (prompt simples de valor, sem afetar saldo).
 *
 * Nome clicável = editar, ícone x = remover (padrão de contas-fixas.js — item
 * 5). Assinaturas INATIVAS continuam listadas (com
 * tag "inativa" no lugar do toggle de pagar, igual contas-fixas.js) em
 * vez de somem da lista — senão reativar uma assinatura desativada via
 * edição ficaria impossível (não teria mais onde clicar).
 */

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("assinaturas.carregando")}</div>`;
  const month = currentMonthStr();
  let subscriptions = [];
  let periods = [];
  let banks = [];
  let filter = { contaId: null, status: null };

  function hasActiveFilter() {
    return !!(filter.contaId || filter.status);
  }
  function flatAccounts() {
    return banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
  }

  async function reload() {
    try {
      [subscriptions, periods, banks] = await Promise.all([
        carteiraApi.listSubscriptions(),
        carteiraApi.listSubscriptionPeriods(month),
        carteiraApi.listBanks(),
      ]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("assinaturas.erro", { erro: err.message }))}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    // se chegamos aqui vindo de um clique no Calendário, garante que o
    // filtro atual não esteja escondendo a assinatura que precisa ficar
    // visível pro destaque.
    const focusId = consumePendingFocus("assinatura");
    if (focusId && hasActiveFilter()) filter = { contaId: null, status: null };

    const periodBySub = {};
    periods.forEach((p) => { periodBySub[p.subscription_id] = p; });
    const visible = subscriptions.filter((s) => {
      if (filter.contaId && s.conta_id !== filter.contaId) return false;
      if (filter.status) {
        const paga = periodBySub[s.id] ? periodBySub[s.id].paga : false;
        if (filter.status === "paga" && !paga) return false;
        if (filter.status === "pendente" && paga) return false;
      }
      return true;
    });

    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm${hasActiveFilter() ? " primary" : ""}" data-action="filter">${t("registros.filtro")}${hasActiveFilter() ? ` <span class="filter-dot"></span>` : ""}</button>
        <button type="button" class="btn sm" data-action="add-sub">${t("assinaturas.nova")}</button>
      </div>
      <div class="subs-list">
        ${visible.length ? visible.map((s) => {
          const period = s.active ? periodBySub[s.id] : null;
          const paga = period ? period.paga : false;
          const valor = period && period.valor_pago != null ? period.valor_pago : s.valor_esperado;
          const tooltip = s.conta_id
            ? t("contas.com_conta")
            : t("contas.sem_conta");
          return `
            <div class="sub-row${s.active ? (paga ? " paga" : "") : " inactive"}" data-assinatura-id="${s.id}">
              <div class="sub-top">
                <span class="sub-name" data-edit-sub="${s.id}" data-tooltip="${escapeHtml(s.nome)}">${escapeHtml(s.nome)}</span>
                <span class="sub-remove" data-remove-sub="${s.id}" data-tooltip="${t("assinaturas.remover")}" aria-label="${t("assinaturas.remover")}">${icon("x", { size: 11 })}</span>
              </div>
              <div class="sub-meta">
                <span class="sub-valor">${brl(valor)}</span>
                <span class="sub-dia">dia ${s.dia_cobranca}</span>
                ${period && period.gerou_transacao ? `<span class="sub-tx-tag" data-tooltip="${t("contas.gerou_tx")}">R$</span>` : ""}
                ${s.active
                  ? `<button class="sub-toggle${paga ? " paga" : ""}" data-toggle-period="${period ? period.id : ""}" data-sub-id="${s.id}"
                      data-tooltip="${tooltip}" aria-label="${tooltip}">
                      ${paga ? t("assinaturas.pago") : t("assinaturas.marcar_pago")}
                    </button>`
                  : `<span class="cf-inactive-tag">inativa</span>`}
              </div>
            </div>`;
        }).join("") : `<div class="wallet-empty">${hasActiveFilter() ? t("assinaturas.vazio_filtro") : t("assinaturas.vazio")}</div>`}
      </div>
    `;

    el.querySelectorAll("[data-edit-sub]").forEach((el2) => {
      el2.addEventListener("click", () => {
        const id = el2.getAttribute("data-edit-sub");
        const subscription = subscriptions.find((s) => s.id === id);
        if (subscription) openAssinaturaModal({ subscription, accounts: flatAccounts(), onSaved: reload });
      });
    });

    el.querySelectorAll("[data-remove-sub]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal(t("assinaturas.remover_confirma"), { title: t("assinaturas.remover"), confirmText: t("geral.remover"), danger: true }))) return;
        await carteiraApi.deleteSubscription(btn.getAttribute("data-remove-sub"));
        await reload();
      });
    });

    el.querySelectorAll("[data-toggle-period]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const periodId = btn.getAttribute("data-toggle-period");
        if (!periodId) return;
        const isPaga = btn.classList.contains("paga");
        if (isPaga) {
          await carteiraApi.unpaySubscriptionPeriod(periodId);
        } else {
          const sub = subscriptions.find((s) => s.id === btn.getAttribute("data-sub-id"));
          const accounts = flatAccounts();
          const conta = sub?.conta_id ? accounts.find((a) => a.id === sub.conta_id) : null;

          let payload;
          if (conta) {
            payload = await openPayPeriodModal({ nome: sub.nome, valorEsperado: sub.valor_esperado, conta });
            if (payload === null) return; // cancelado
          } else {
            const valorStr = await showPromptModal(t("contas.valor_pago"), {
              title: t("assinaturas.marcar_titulo"),
              placeholder: t("contas.valor_placeholder"),
              inputType: "number",
            });
            if (valorStr === null) return; // cancelado
            payload = { valor_pago: valorStr ? Number(valorStr) : null, gerar_transacao: false };
          }
          try {
            await carteiraApi.paySubscriptionPeriod(periodId, payload);
          } catch (err) {
            showErrorModal(err.message, t("assinaturas.erro_pagar"));
            return;
          }
        }
        await reload();
      });
    });

    el.querySelector('[data-action="add-sub"]').addEventListener("click", () => {
      openAssinaturaModal({ accounts: flatAccounts(), onSaved: reload });
    });
    el.querySelector('[data-action="filter"]').addEventListener("click", () => {
      openAssinaturaFilterModal({ accounts: flatAccounts(), current: filter, onApply: (newFilter) => { filter = newFilter; draw(); } });
    });

    if (focusId) focusRow(el.querySelector(`[data-assinatura-id="${focusId}"]`), "assinatura");
  }

  await reload();
}
