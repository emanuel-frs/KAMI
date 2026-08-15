import * as financasApi from "../api/financas.js";
import { escapeHtml } from "../components/format.js";
import { showConfirmModal } from "../modals/confirm-modal.js";

/**
 * Widget "renda recorrente" (financas_renda) — item 2 do mapa de
 * problemas: o backend de income_entries (GET /income-entries,
 * confirm/revert) já existia pronto e testado, mas nenhum widget o
 * consumia (código morto no frontend). Este widget fecha essa lacuna.
 *
 * Mostra as entradas do mês corrente ("parte 1"/"parte 2", geradas sob
 * demanda pelo backend via workalendar) com toggle confirmar/reverter —
 * mesmo padrão visual de dividas.js/contas-fixas.js. Confirmar sempre
 * usa a data de hoje como paid_date (mantém o fluxo em um clique, sem
 * modal extra); reverter volta pra "previsto".
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
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando renda…</div>';
  const month = currentMonthStr();
  let entries = [];

  async function reload() {
    try {
      entries = await financasApi.getIncomeEntries(month);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar renda: ${err.message}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    el.innerHTML = `
      <div class="renda-list">
        ${entries.length ? entries.map((e) => {
          const pago = e.status === "pago";
          return `
            <div class="renda-row${pago ? " pago" : ""}" data-renda-id="${e.id}">
              <div class="renda-top">
                <span class="renda-label">${escapeHtml(e.label)}</span>
                <span class="renda-valor">${brl(e.amount)}</span>
              </div>
              <div class="renda-meta">
                <span class="renda-data">${pago ? formatDate(e.paid_date) : `previsto ${formatDate(e.expected_date)}`}</span>
                <button class="renda-toggle${pago ? " pago" : ""}" data-toggle-entry="${e.id}"
                  data-tooltip="renda confirmada aqui não gera transação automática">
                  ${pago ? "confirmado" : "confirmar"}
                </button>
              </div>
            </div>`;
        }).join("") : `<div class="wallet-empty">nenhuma entrada de renda pra este mês.</div>`}
      </div>
    `;

    el.querySelectorAll("[data-toggle-entry]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const entryId = btn.getAttribute("data-toggle-entry");
        const isPago = btn.classList.contains("pago");
        if (isPago) {
          if (!(await showConfirmModal("desfazer a confirmação dessa renda?", { title: "reverter renda", confirmText: "reverter" }))) return;
          await financasApi.revertIncomeEntry(entryId);
        } else {
          await financasApi.confirmIncomeEntry(entryId, todayIso());
        }
        await reload();
      });
    });
  }

  await reload();
}
