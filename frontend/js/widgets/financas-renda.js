import * as financasApi from "../api/financas.js";
import * as walletApi from "../api/wallet.js";
import { escapeHtml } from "../components/format.js";
import { openIncomeSourceModal } from "../modals/income-source-modal.js";
import { openPayIncomeModal } from "../modals/pay-income-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { icon } from "../components/icons.js";

/**
 * Widget "renda recorrente" (financas_renda) — v2: fecha o item 2 do
 * mapa de problemas antigo (o backend só tinha 2 fontes fixas
 * hardcoded, sem CRUD nenhum). Agora:
 *   - lista TODAS as fontes ativas, uma ocorrência por linha (uma
 *     fonte com tipo_data='intervalo_dias' semanal pode ter várias
 *     linhas no mesmo mês);
 *   - nome clicável abre edição da fonte (mesmo padrão de
 *     contas-fixas.js, item 5);
 *   - toggle "marcar paga" abre pay-income-modal.js (valor editável,
 *     credita saldo real se a fonte tem conta_id vinculada);
 *   - "+ fonte de renda" abre income-source-modal.js pro CRUD completo.
 *
 * Deliberadamente fora do Calendário por enquanto (ver comentário em
 * app/routers/calendario.py) — só aparece aqui em Finanças.
 */

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso) {
  if (!iso) return "sem data";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando renda…</div>';
  const month = currentMonthStr();
  let sources = [];
  let entries = [];
  let banks = [];

  function flatAccounts() {
    return banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
  }

  async function reload() {
    try {
      [sources, entries, banks] = await Promise.all([
        financasApi.listIncomeSources(),
        financasApi.getIncomeEntries(month),
        walletApi.listBanks(),
      ]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar renda: ${err.message}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    const entriesBySource = {};
    entries.forEach((e) => {
      (entriesBySource[e.income_source_id] = entriesBySource[e.income_source_id] || []).push(e);
    });

    const rowsHtml = sources.map((source) => {
      const sourceEntries = entriesBySource[source.id] || [];
      if (!source.active) {
        return `
          <div class="renda-row inactive" data-fonte-id="${source.id}">
            <div class="renda-top">
              <span class="renda-label" data-edit-source="${source.id}">${escapeHtml(source.nome)}</span>
              <span class="cf-remove" data-remove-source="${source.id}" data-tooltip="remover fonte de renda">${icon("x", { size: 11 })}</span>
            </div>
            <div class="renda-meta"><span class="cf-inactive-tag">inativa</span></div>
          </div>`;
      }
      if (!sourceEntries.length) {
        return `
          <div class="renda-row" data-fonte-id="${source.id}">
            <div class="renda-top">
              <span class="renda-label" data-edit-source="${source.id}">${escapeHtml(source.nome)}</span>
              <span class="cf-remove" data-remove-source="${source.id}" data-tooltip="remover fonte de renda">${icon("x", { size: 11 })}</span>
            </div>
            <div class="renda-meta"><span class="renda-data">sem ocorrência este mês</span></div>
          </div>`;
      }
      return sourceEntries.map((e) => {
        const pago = e.status === "pago";
        const tooltip = source.conta_id
          ? "tem conta vinculada — credita saldo real ao marcar como paga"
          : "lembrete — sem conta vinculada, não afeta saldo";
        return `
          <div class="renda-row${pago ? " pago" : ""}" data-renda-id="${e.id}" data-fonte-id="${source.id}">
            <div class="renda-top">
              <span class="renda-label" data-edit-source="${source.id}">${escapeHtml(source.nome)}</span>
              <span class="renda-valor">${brl(e.amount)}</span>
              <span class="cf-remove" data-remove-source="${source.id}" data-tooltip="remover fonte de renda">${icon("x", { size: 11 })}</span>
            </div>
            <div class="renda-meta">
              <span class="renda-data">${pago ? formatDate(e.paid_date) : `previsto ${formatDate(e.expected_date)}`}</span>
              ${pago && e.gerou_transacao ? `<span class="cf-tx-tag" data-tooltip="gerou uma transação real, creditada na conta">R$</span>` : ""}
              <button class="renda-toggle${pago ? " pago" : ""}" data-toggle-entry="${e.id}" data-tooltip="${tooltip}">
                ${pago ? "pago" : "marcar paga"}
              </button>
            </div>
          </div>`;
      }).join("");
    }).join("");

    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-source">+ fonte de renda</button>
      </div>
      <div class="renda-list">
        ${sources.length ? rowsHtml : `<div class="wallet-empty">nenhuma fonte de renda cadastrada.</div>`}
      </div>
    `;

    el.querySelectorAll("[data-edit-source]").forEach((label) => {
      label.addEventListener("click", () => {
        const id = label.getAttribute("data-edit-source");
        const source = sources.find((s) => s.id === id);
        if (source) openIncomeSourceModal({ source, sources, accounts: flatAccounts(), onSaved: reload });
      });
    });

    el.querySelectorAll("[data-remove-source]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal("remover essa fonte de renda?", { title: "remover fonte de renda", confirmText: "remover", danger: true }))) return;
        try {
          await financasApi.deleteIncomeSource(btn.getAttribute("data-remove-source"));
        } catch (err) {
          showErrorModal(err.message, "erro ao remover fonte de renda");
          return;
        }
        await reload();
      });
    });

    el.querySelectorAll("[data-toggle-entry]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const entryId = btn.getAttribute("data-toggle-entry");
        const entry = entries.find((e) => e.id === entryId);
        const isPago = btn.classList.contains("pago");
        if (isPago) {
          if (!(await showConfirmModal("desfazer o pagamento dessa renda?", { title: "desfazer pagamento", confirmText: "desfazer" }))) return;
          try {
            await financasApi.unpayIncomeEntry(entryId);
          } catch (err) {
            showErrorModal(err.message, "erro ao desfazer pagamento");
            return;
          }
        } else {
          const source = sources.find((s) => s.id === entry?.income_source_id);
          const conta = source?.conta_id ? flatAccounts().find((a) => a.id === source.conta_id) : null;
          const payload = await openPayIncomeModal({
            nome: entry.label,
            valorEsperado: entry.amount,
            expectedDate: entry.expected_date,
            conta,
          });
          if (payload === null) return; // cancelado
          try {
            await financasApi.payIncomeEntry(entryId, payload);
          } catch (err) {
            showErrorModal(err.message, "erro ao marcar como paga");
            return;
          }
        }
        await reload();
      });
    });

    el.querySelector('[data-action="add-source"]').addEventListener("click", () => {
      openIncomeSourceModal({ sources, accounts: flatAccounts(), onSaved: reload });
    });
  }

  await reload();
}
