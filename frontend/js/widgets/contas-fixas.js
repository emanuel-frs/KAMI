import * as financasApi from "../api/financas.js";
import { escapeHtml } from "../components/format.js";
import { openFixedBillModal } from "../modals/fixed-bill-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";

/**
 * Widget "contas fixas" — mesmo padrão simples de dividas.js. Lista
 * GET /fixed-bills, criar via modal (fixed-bill-modal.js), remover
 * direto (DELETE). Sem edição de status aqui — o backend não tem
 * endpoint de update pra fixed-bills, só create/delete.
 */

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando contas fixas…</div>';
  let bills = [];

  async function reload() {
    try {
      bills = await financasApi.listFixedBills();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar contas fixas: ${err.message}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-bill">+ conta fixa</button>
      </div>
      <div class="contas-fixas-list">
        ${bills.length ? bills.map((b) => `
          <div class="conta-fixa-row${b.active ? "" : " inactive"}">
            <span class="cf-name">${escapeHtml(b.name)}</span>
            <span class="cf-valor">${brl(b.amount)}</span>
            <span class="cf-dia">dia ${b.due_day}</span>
            ${b.active ? "" : `<span class="cf-inactive-tag">inativa</span>`}
            <span class="cf-remove" data-remove-bill="${b.id}" data-tooltip="remover conta fixa">×</span>
          </div>`).join("") : `<div class="wallet-empty">nenhuma conta fixa cadastrada.</div>`}
      </div>
    `;

    el.querySelectorAll("[data-remove-bill]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal("remover essa conta fixa?", { title: "remover conta fixa", confirmText: "remover", danger: true }))) return;
        await financasApi.deleteFixedBill(btn.getAttribute("data-remove-bill"));
        await reload();
      });
    });

    el.querySelector('[data-action="add-bill"]').addEventListener("click", () => {
      openFixedBillModal({ onSaved: reload });
    });
  }

  await reload();
}