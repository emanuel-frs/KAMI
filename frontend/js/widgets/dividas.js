import * as financasApi from "../api/financas.js";
import { listBanks } from "../api/carteira.js";
import { openQuitarDividaModal } from "../modals/quitar-divida-modal.js";
import { escapeHtml, fmtData } from "../components/format.js";
import { openDividaModal } from "../modals/divida-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { enhanceSelect, destroyCustomSelect } from "../components/custom-select.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { icon } from "../components/icons.js";
import { t } from "../i18n.js";

/**
 * Widget "dívidas" — segue o mesmo padrão simples de financas-resumo.js
 * (sem paginação/filtro, lista tudo que vem de GET /debts). Status é
 * editável inline pelo select, sem reabrir o modal. Desde a P-13
 * (CONF-04), "paga" quita de verdade: abre quitar-divida-modal.js pra
 * escolher de qual conta o dinheiro saiu (ou nenhuma) e chama
 * PUT /debts/{id}/pay; voltar pra "aberta" chama /unpay, que devolve o
 * dinheiro e estorna o xp.
 */

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso) {
  if (!iso) return t("renda.sem_data");
  return fmtData(iso); // ORG-07: formatador único
}

export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("dividas.carregando")}</div>`;
  let debts = [];

  async function reload() {
    try {
      debts = await financasApi.listDebts();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("dividas.erro", { erro: err.message }))}</div>`;
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

    const focusId = consumePendingFocus("divida");

    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-debt">${t("dividas.nova")}</button>
      </div>
      <div class="dividas-list">
        ${debts.length ? debts.map((d) => `
          <div class="divida-row${d.status === "paga" ? " paga" : ""}" data-divida-id="${d.id}">
            <div class="divida-top">
              <span class="divida-desc" data-edit-debt="${d.id}" data-tooltip="${escapeHtml(d.description)}">${escapeHtml(d.description)}</span>
              <span class="divida-remove" data-remove-debt="${d.id}" data-tooltip="${t("dividas.remover")}" aria-label="${t("dividas.remover")}">${icon("x", { size: 11 })}</span>
            </div>
            ${d.counterparty ? `<div class="divida-counterparty">${escapeHtml(d.counterparty)}</div>` : ""}
            <div class="divida-meta">
              <span class="divida-valor">${brl(d.amount)}</span>
              <span class="divida-due">${formatDate(d.due_date)}</span>
              <select class="divida-status" data-status-for="${d.id}">
                <option value="aberta"${d.status === "aberta" ? " selected" : ""}>${t("dividas.aberta")}</option>
                <option value="paga"${d.status === "paga" ? " selected" : ""}>${t("dividas.paga")}</option>
              </select>
            </div>
          </div>`).join("") : `<div class="wallet-empty">${t("dividas.vazio")}</div>`}
      </div>
    `;

    el.querySelectorAll("[data-edit-debt]").forEach((el2) => {
      el2.addEventListener("click", () => {
        const id = el2.getAttribute("data-edit-debt");
        const debt = debts.find((d) => d.id === id);
        if (debt) openDividaModal({ debt, onSaved: reload });
      });
    });

    el.querySelectorAll("[data-status-for]").forEach((sel) => {
      enhanceSelect(sel, { compact: true });
      sel.addEventListener("change", async () => {
        const id = sel.getAttribute("data-status-for");
        const debt = debts.find((d) => d.id === id);
        if (!debt) return;
        try {
          if (sel.value === "paga") {
            const banks = await listBanks();
            const accounts = banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
            const choice = await openQuitarDividaModal({ debt, accounts });
            if (choice) await financasApi.payDebt(id, choice);
          } else {
            await financasApi.unpayDebt(id);
          }
        } catch (err) {
          showErrorModal(err.message, t("dividas.erro_status"));
        }
        await reload(); // cancelou a quitação: o select volta pra "aberta"
      });
    });

    el.querySelectorAll("[data-remove-debt]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal(t("dividas.remover_confirma"), { title: t("dividas.remover"), confirmText: t("geral.remover"), danger: true }))) return;
        await financasApi.deleteDebt(btn.getAttribute("data-remove-debt"));
        await reload();
      });
    });

    el.querySelector('[data-action="add-debt"]').addEventListener("click", () => {
      openDividaModal({ onSaved: reload });
    });

    if (focusId) focusRow(el.querySelector(`[data-divida-id="${focusId}"]`), "divida");
  }

  await reload();
}