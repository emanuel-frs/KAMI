import * as financasApi from "../api/financas.js";
import { escapeHtml } from "../components/format.js";
import { openDebtModal } from "../modals/debt-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { enhanceSelect, destroyCustomSelect } from "../components/custom-select.js";

/**
 * Widget "dívidas" — segue o mesmo padrão simples de financas-resumo.js
 * (sem paginação/filtro, lista tudo que vem de GET /debts). Status é
 * editável inline (select -> PUT), sem precisar reabrir o modal —
 * criar é a única ação que passa pelo modal (debt-modal.js).
 */

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso) {
  if (!iso) return "sem data";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando dívidas…</div>';
  let debts = [];

  async function reload() {
    try {
      debts = await financasApi.listDebts();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar dívidas: ${err.message}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    // as linhas (e os <select> de status dentro delas) são recriadas do
    // zero a cada draw() — o dropdown customizado delas vive num portal
    // em <body> (ver custom-select.js), fora da árvore que o innerHTML
    // abaixo substitui, então precisa ser destruído explicitamente aqui
    // ou ficaria uma lista invisível órfã acumulando a cada reload().
    el.querySelectorAll("[data-status-for]").forEach((sel) => destroyCustomSelect(sel));

    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-debt">+ dívida</button>
      </div>
      <div class="dividas-list">
        ${debts.length ? debts.map((d) => `
          <div class="divida-row${d.status === "paga" ? " paga" : ""}">
            <div class="divida-top">
              <span class="divida-desc">${escapeHtml(d.description)}</span>
              <span class="divida-remove" data-remove-debt="${d.id}" data-tooltip="remover dívida">×</span>
            </div>
            ${d.counterparty ? `<div class="divida-counterparty">${escapeHtml(d.counterparty)}</div>` : ""}
            <div class="divida-meta">
              <span class="divida-valor">${brl(d.amount)}</span>
              <span class="divida-due">${formatDate(d.due_date)}</span>
              <select class="divida-status" data-status-for="${d.id}">
                <option value="aberta"${d.status === "aberta" ? " selected" : ""}>aberta</option>
                <option value="paga"${d.status === "paga" ? " selected" : ""}>paga</option>
              </select>
            </div>
          </div>`).join("") : `<div class="wallet-empty">nenhuma dívida cadastrada.</div>`}
      </div>
    `;

    el.querySelectorAll("[data-status-for]").forEach((sel) => {
      enhanceSelect(sel, { compact: true });
      sel.addEventListener("change", async () => {
        const id = sel.getAttribute("data-status-for");
        const debt = debts.find((d) => d.id === id);
        if (!debt) return;
        try {
          await financasApi.updateDebt(id, { ...debt, status: sel.value });
        } catch (err) {
          showErrorModal(err.message, "erro ao atualizar status");
        }
        await reload();
      });
    });

    el.querySelectorAll("[data-remove-debt]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal("remover essa dívida?", { title: "remover dívida", confirmText: "remover", danger: true }))) return;
        await financasApi.deleteDebt(btn.getAttribute("data-remove-debt"));
        await reload();
      });
    });

    el.querySelector('[data-action="add-debt"]').addEventListener("click", () => {
      openDebtModal({ onSaved: reload });
    });
  }

  await reload();
}