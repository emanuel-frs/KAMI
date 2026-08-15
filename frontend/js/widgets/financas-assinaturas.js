import * as walletApi from "../api/wallet.js";
import { escapeHtml } from "../components/format.js";
import { openSubscriptionModal } from "../modals/subscription-modal.js";
import { openAssinaturaFilterModal } from "../modals/assinatura-filter-modal.js";
import { showPromptModal } from "../modals/prompt-modal.js";
import { openPayPeriodModal } from "../modals/pay-period-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";

/**
 * Widget "assinaturas". Marcar como paga pode gerar uma transação real
 * (item 6 do mapa de problemas) quando a assinatura tem conta_id
 * vinculada — nesse caso abre pay-period-modal.js pra confirmar valor/
 * conta/forma de pagamento. Sem conta vinculada, continua sendo só
 * lembrete (prompt simples de valor, sem afetar saldo).
 */

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando assinaturas…</div>';
  const month = currentMonthStr();
  let subscriptions = [];
  let periods = [];
  let banks = [];
  let filter = { contaId: null, status: null };

  function hasActiveFilter() {
    return !!(filter.contaId || filter.status);
  }

  async function reload() {
    try {
      [subscriptions, periods, banks] = await Promise.all([
        walletApi.listSubscriptions(),
        walletApi.listSubscriptionPeriods(month),
        walletApi.listBanks(),
      ]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar assinaturas: ${err.message}</div>`;
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
    const active = subscriptions.filter((s) => s.active).filter((s) => {
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
        <button type="button" class="btn sm${hasActiveFilter() ? " primary" : ""}" data-action="filter">filtro${hasActiveFilter() ? " •" : ""}</button>
        <button type="button" class="btn sm" data-action="add-sub">+ assinatura</button>
      </div>
      <div class="subs-list">
        ${active.length ? active.map((s) => {
          const period = periodBySub[s.id];
          const paga = period ? period.paga : false;
          const valor = period && period.valor_pago != null ? period.valor_pago : s.valor_esperado;
          const tooltip = s.conta_id
            ? "tem conta vinculada — pode gerar uma transação real ao confirmar"
            : "lembrete — sem conta vinculada, não afeta saldo/fatura";
          return `
            <div class="sub-row${paga ? " paga" : ""}" data-assinatura-id="${s.id}">
              <div class="sub-top">
                <span class="sub-name">${escapeHtml(s.nome)}</span>
              </div>
              <div class="sub-meta">
                <span class="sub-valor">${brl(valor)}</span>
                <span class="sub-dia">dia ${s.dia_cobranca}</span>
                ${period && period.gerou_transacao ? `<span class="sub-tx-tag" data-tooltip="gerou uma transação real, descontada da conta">R$</span>` : ""}
                <button class="sub-toggle${paga ? " paga" : ""}" data-toggle-period="${period ? period.id : ""}" data-sub-id="${s.id}"
                  data-tooltip="${tooltip}">
                  ${paga ? "pago" : "marcar pago"}
                </button>
              </div>
            </div>`;
        }).join("") : `<div class="wallet-empty">${hasActiveFilter() ? "nenhuma assinatura bate com o filtro." : "nenhuma assinatura cadastrada."}</div>`}
      </div>
    `;

    el.querySelectorAll("[data-toggle-period]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const periodId = btn.getAttribute("data-toggle-period");
        if (!periodId) return;
        const isPaga = btn.classList.contains("paga");
        if (isPaga) {
          await walletApi.unpaySubscriptionPeriod(periodId);
        } else {
          const sub = subscriptions.find((s) => s.id === btn.getAttribute("data-sub-id"));
          const accounts = banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
          const conta = sub?.conta_id ? accounts.find((a) => a.id === sub.conta_id) : null;

          let payload;
          if (conta) {
            payload = await openPayPeriodModal({ nome: sub.nome, valorEsperado: sub.valor_esperado, conta });
            if (payload === null) return; // cancelado
          } else {
            const valorStr = await showPromptModal("valor pago", {
              title: "marcar como pago",
              placeholder: "deixe em branco pra usar o valor esperado",
              inputType: "number",
            });
            if (valorStr === null) return; // cancelado
            payload = { valor_pago: valorStr ? Number(valorStr) : null, gerar_transacao: false };
          }
          try {
            await walletApi.paySubscriptionPeriod(periodId, payload);
          } catch (err) {
            showErrorModal(err.message, "erro ao marcar como pago");
            return;
          }
        }
        await reload();
      });
    });

    el.querySelector('[data-action="add-sub"]').addEventListener("click", () => {
      const accounts = banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
      openSubscriptionModal({ accounts, onSaved: reload });
    });
    el.querySelector('[data-action="filter"]').addEventListener("click", () => {
      const accounts = banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
      openAssinaturaFilterModal({ accounts, current: filter, onApply: (newFilter) => { filter = newFilter; draw(); } });
    });

    if (focusId) focusRow(el.querySelector(`[data-assinatura-id="${focusId}"]`), "assinatura");
  }

  await reload();
}
