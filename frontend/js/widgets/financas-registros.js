import * as financasApi from "../api/financas.js";
import * as carteiraApi from "../api/carteira.js";
import { escapeHtml, fmtDataCurta } from "../components/format.js";
import { fitAsciiText } from "../components/ascii.js";
import { openTransacaoModal } from "../modals/transacao-modal.js";
import { openRegistroFilterModal } from "../modals/registro-filter-modal.js";
import { icon } from "../components/icons.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { consumePendingFocus } from "../components/pending-focus.js";

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[m - 1]} ${y}`;
}
function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso) {
  return fmtDataCurta(iso); // ORG-07
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando registros…</div>';
  let month = currentMonthStr();
  // ORG-03: lançamento escolhido na busca (Ctrl+K) — "id|AAAA-MM-DD": abre
  // no mês dele e já com a edição aberta
  const pedido = consumePendingFocus("lancamento");
  const [lancPedido, dataPedida] = (pedido || "").split("|");
  if (dataPedida) month = dataPedida.slice(0, 7);
  let banks = [];
  let transactions = [];
  let filter = { contaId: null, categoria: null, type: null };

  function filteredTransactions() {
    return transactions.filter((t) => {
      if (filter.contaId && t.conta_id !== filter.contaId) return false;
      if (filter.categoria && t.category !== filter.categoria) return false;
      if (filter.type && t.type !== filter.type) return false;
      return true;
    });
  }
  function hasActiveFilter() {
    return !!(filter.contaId || filter.categoria || filter.type);
  }

  function accountLookup() {
    const map = {};
    banks.forEach((b) => b.accounts.forEach((a) => { map[a.id] = { bank: b, account: a }; }));
    return map;
  }
  function accountsFlat() {
    return banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
  }

  async function reload() {
    try {
      [banks, transactions] = await Promise.all([
        carteiraApi.listBanks(),
        financasApi.listTransactions(month),
      ]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar registros: ${escapeHtml(err.message)}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    const lookup = accountLookup();
    const visible = filteredTransactions();
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <div class="month-nav">
          <button type="button" class="btn sm" data-action="prev-month">${icon("arrow-left", { size: 11 })}</button>
          <span class="month-label">${monthLabel(month)}</span>
          <button type="button" class="btn sm" data-action="next-month">${icon("arrow-right", { size: 11 })}</button>
        </div>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn sm${hasActiveFilter() ? " primary" : ""}" data-action="filter">filtro${hasActiveFilter() ? ` <span class="filter-dot"></span>` : ""}</button>
          <button type="button" class="btn sm" data-action="add-transaction">+ lançamento</button>
        </div>
      </div>
      <div class="registros-list">
        ${visible.length ? visible.map((t) => {
          const found = lookup[t.conta_id];
          const bankIcon = found
            ? (found.bank.icon_ascii ? `<pre>${escapeHtml(found.bank.icon_ascii)}</pre>` : `<span class="ph">${found.bank.is_dinheiro ? "R$" : found.bank.nome.slice(0, 2).toUpperCase()}</span>`)
            : `<span class="ph">—</span>`;
          const bankName = found ? escapeHtml(found.bank.nome) : "conta removida";
          const accountName = found ? escapeHtml(found.account.nome) : "";
          const sinal = t.type === "entrada" ? "+" : t.type === "saida" ? "-" : "→";
          return `
            <div class="registro-row">
              <div class="r-top">
                <div class="registro-desc" data-tooltip="${escapeHtml(t.description)}">${escapeHtml(t.description)}<span class="r-category">${escapeHtml(t.category)}</span></div>
                <div class="registro-valor ${t.type}">${sinal} ${brl(t.amount)}</div>
              </div>
              <div class="r-meta">
                <div class="registro-conta-col">
                  <div class="r-bank-icon">${bankIcon}</div>
                  <div class="registro-conta-names">
                    <span class="r-bank-name" data-tooltip="${bankName}">${bankName}</span>
                    <span class="r-account-name" data-tooltip="${accountName}">${accountName}</span>
                  </div>
                </div>
                <div class="registro-date">${formatDate(t.date)}</div>
                ${t.origem
                  ? `<span class="registro-origem" data-tooltip="veio de ${escapeHtml(t.origem)} — corrija ou desfaça por lá">${escapeHtml(t.origem)}</span>`
                  : `<span class="registro-actions">
                      <button type="button" class="icon-btn" data-edit-tx="${escapeHtml(t.id)}" data-tooltip="corrigir lançamento" aria-label="corrigir lançamento">${icon("pencil", { size: 11 })}</button>
                      <button type="button" class="icon-btn danger" data-delete-tx="${escapeHtml(t.id)}" data-tooltip="apagar lançamento" aria-label="apagar lançamento">${icon("trash-2", { size: 11 })}</button>
                    </span>`}
              </div>
            </div>`;
        }).join("") : `<div class="wallet-empty">${hasActiveFilter() ? "nenhum lançamento bate com o filtro." : `nenhum lançamento em ${monthLabel(month)}.`}</div>`}
      </div>
    `;

    // fit dos ícones ascii — sem isso vira bloco preto (mesmo bug corrigido antes)
    el.querySelectorAll(".r-bank-icon pre").forEach((pre) => {
      fitAsciiText(pre, pre.textContent, { container: pre.parentElement, maxHeight: 14, maxFont: 4, minFont: 0.3, paddingX: 2, paddingY: 2 });
    });

    el.querySelector('[data-action="prev-month"]').addEventListener("click", () => { month = shiftMonth(month, -1); reload(); });
    el.querySelector('[data-action="next-month"]').addEventListener("click", () => { month = shiftMonth(month, 1); reload(); });
    el.querySelector('[data-action="add-transaction"]').addEventListener("click", () => {
      openTransacaoModal({ accounts: accountsFlat(), onSaved: reload });
    });
    // CONF-07: corrigir abre o lançamento preenchido; apagar pede confirmação
    // e devolve saldo/fatura e xp (o backend faz tudo de uma vez)
    el.querySelectorAll("[data-edit-tx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = transactions.find((x) => x.id === btn.dataset.editTx);
        if (t) openTransacaoModal({ accounts: accountsFlat(), onSaved: reload, editing: t });
      });
    });
    el.querySelectorAll("[data-delete-tx]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const t = transactions.find((x) => x.id === btn.dataset.deleteTx);
        if (!t) return;
        const ok = await showConfirmModal(
          `apagar "${t.description}" (${brl(t.amount)})? o valor volta pra conta e o xp do lançamento sai.`,
          { title: "apagar lançamento", confirmText: "apagar", danger: true },
        );
        if (!ok) return;
        try {
          await financasApi.deleteTransaction(t.id);
        } catch (err) {
          showErrorModal(err.message, "erro ao apagar");
          return;
        }
        window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
        await reload();
      });
    });
    el.querySelector('[data-action="filter"]').addEventListener("click", () => {
      const categories = [...new Set(transactions.map((t) => t.category).filter(Boolean))].sort();
      openRegistroFilterModal({
        accounts: accountsFlat(),
        categories,
        current: filter,
        onApply: (newFilter) => { filter = newFilter; draw(); },
      });
    });
  }

  await reload();
  if (lancPedido === "novo") {
    // "novo lançamento" da paleta
    openTransacaoModal({ accounts: accountsFlat(), onSaved: reload });
  } else if (lancPedido) {
    const t = transactions.find((x) => x.id === lancPedido);
    if (t) openTransacaoModal({ accounts: accountsFlat(), onSaved: reload, editing: t });
  }
  listenWhileConnected(el, "kami:wallet-changed", reload);
}
