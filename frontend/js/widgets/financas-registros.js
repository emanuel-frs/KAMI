import * as financasApi from "../api/financas.js";
import * as carteiraApi from "../api/carteira.js";
import { escapeHtml } from "../components/format.js";
import { fitAsciiText } from "../components/ascii.js";
import { openTransacaoModal } from "../modals/transacao-modal.js";
import { openRegistroFilterModal } from "../modals/registro-filter-modal.js";
import { icon } from "../components/icons.js";

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
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando registros…</div>';
  let month = currentMonthStr();
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
      el.innerHTML = `<div class="empty-state">erro ao carregar registros: ${err.message}</div>`;
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
                <div class="registro-desc">${escapeHtml(t.description)}<span class="r-category">${escapeHtml(t.category)}</span></div>
                <div class="registro-valor ${t.type}">${sinal} ${brl(t.amount)}</div>
              </div>
              <div class="r-meta">
                <div class="registro-conta-col">
                  <div class="r-bank-icon">${bankIcon}</div>
                  <div class="registro-conta-names">
                    <span class="r-bank-name">${bankName}</span>
                    <span class="r-account-name">${accountName}</span>
                  </div>
                </div>
                <div class="registro-date">${formatDate(t.date)}</div>
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
  window.addEventListener("kami:wallet-changed", reload);
}
