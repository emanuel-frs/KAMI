import * as walletApi from "../api/wallet.js";
import { escapeHtml } from "../components/format.js";
import { openSubscriptionModal } from "../modals/subscription-modal.js";
import { openAssinaturaFilterModal } from "../modals/assinatura-filter-modal.js";

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
          return `
            <div class="sub-row${paga ? " paga" : ""}">
              <span class="sub-name">${escapeHtml(s.nome)}</span>
              <span class="sub-valor">${brl(valor)}</span>
              <span class="sub-dia">dia ${s.dia_cobranca}</span>
              <button class="sub-toggle${paga ? " paga" : ""}" data-toggle-period="${period ? period.id : ""}">
                ${paga ? "pago" : "marcar pago"}
              </button>
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
          const valorStr = prompt("valor pago (deixe em branco pra usar o valor esperado):");
          const valor = valorStr ? Number(valorStr) : null;
          await walletApi.paySubscriptionPeriod(periodId, valor);
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
  }

  await reload();
}
