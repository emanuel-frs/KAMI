import * as carteiraApi from "../api/carteira.js";
import { escapeHtml } from "../components/format.js";
import { openCompraParceladaModal } from "../modals/compra-parcelada-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { icon } from "../components/icons.js";

/**
 * Widget "compras parceladas". A progressão (parcela_atual) vem
 * calculada do backend (calendário + ajuste manual). Os botões de seta
 * chamam carteiraApi.ajustarParcelasCompra pra adiantar/desfazer um
 * adiantamento — não mexe em fatura/saldo, só no rótulo de progresso
 * (a reserva no limite já foi feita inteira na criação da compra).
 *
 * Segunda seção "fatura do mês" (item 3 do plano de ajustes): lista,
 * pro mês navegável selecionado, uma linha por compra ativa naquele
 * mês no formato "nome (parcela X/N) — R$ valor", como um item de
 * fatura de banco de verdade — calculada on the fly no backend
 * (GET /compras-parceladas/mes), sem mexer em saldo/fatura de novo
 * (já foi reservado na criação). Essa conta LEVA EM CONTA o
 * ajuste_parcelas atual (ver _parcela_no_mes em routers/wallet.py:
 * raw_parcela = elapsed + 1 + ajuste_parcelas) — não é independente da
 * primeira seção; um adiantamento/estorno feito ali também desloca qual
 * parcela aparece aqui. São visões diferentes ("progresso atual" vs "o
 * que cai em cada mês"), mas compartilham o mesmo ajuste como entrada.
 */

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

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando compras parceladas…</div>';
  let compras = [];
  let banks = [];
  let faturaMes = currentMonthStr();
  let faturaItens = [];

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
      [compras, banks] = await Promise.all([
        carteiraApi.listComprasParceladas(),
        carteiraApi.listBanks(),
      ]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar compras parceladas: ${err.message}</div>`;
      return;
    }
    await reloadFatura();
  }

  async function reloadFatura() {
    try {
      faturaItens = await carteiraApi.listComprasParceladasMes(faturaMes);
    } catch (err) {
      faturaItens = [];
    }
    draw();
  }

  function draw() {
    const focusId = consumePendingFocus("parcela");
    const lookup = accountLookup();
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-compra">+ compra parcelada</button>
      </div>
      <div class="compras-parceladas-list">
        ${compras.length ? compras.map((c) => {
          const found = c.conta_id ? lookup[c.conta_id] : null;
          const contaLabel = found ? `${escapeHtml(found.bank.nome)} — ${escapeHtml(found.account.nome)}` : "sem conta vinculada";
          const ajusteTag = c.ajuste_parcelas ? `<span class="cp-ajuste-tag" data-tooltip="ajuste manual">${c.ajuste_parcelas > 0 ? "+" : ""}${c.ajuste_parcelas}</span>` : "";
          return `
            <div class="compra-parcelada-row${c.quitada ? " quitada" : ""}" data-parcela-id="${c.id}">
              <div class="cp-top">
                <span class="cp-nome" data-edit-compra="${c.id}">${escapeHtml(c.nome)}</span>
                <span class="cp-remove" data-remove-compra="${c.id}" data-tooltip="remover (desfaz a reserva no limite, se tinha conta)">${icon("x", { size: 11 })}</span>
              </div>
              <div class="cp-meta">
                <div class="cp-parcela-adjust">
                  <button type="button" class="cp-adjust-btn${c.parcela_atual <= 0 ? " disabled" : ""}" data-adjust="-1" data-compra="${c.id}" ${c.parcela_atual <= 0 ? "disabled" : ""} data-tooltip="desfazer um adiantamento">${icon("arrow-left", { size: 11 })}</button>
                  <span class="cp-parcela">${c.parcela_atual}/${c.num_parcelas}${ajusteTag}${c.quitada ? " · quitada" : ""}</span>
                  <button type="button" class="cp-adjust-btn${c.quitada || c.parcela_atual >= c.num_parcelas ? " disabled" : ""}" data-adjust="1" data-compra="${c.id}" ${c.quitada || c.parcela_atual >= c.num_parcelas ? "disabled" : ""} data-tooltip="adiantar uma parcela">${icon("arrow-right", { size: 11 })}</button>
                </div>
                <div class="cp-valor-stack">
                  <span class="cp-valor">${brl(c.valor_parcela)}</span>
                  <span class="cp-valor-total">de ${brl(c.valor_total)}</span>
                </div>
              </div>
              <div class="cp-conta">${contaLabel}</div>
            </div>`;
        }).join("") : `<div class="wallet-empty">nenhuma compra parcelada cadastrada.</div>`}
      </div>

      <div class="cp-fatura-section">
        <div class="widget-inline-toolbar">
          <div class="month-nav">
            <button type="button" class="btn sm" data-action="fatura-prev-month">${icon("arrow-left", { size: 11 })}</button>
            <span class="month-label">${monthLabel(faturaMes)}</span>
            <button type="button" class="btn sm" data-action="fatura-next-month">${icon("arrow-right", { size: 11 })}</button>
          </div>
          <span class="cp-fatura-title">fatura do mês</span>
        </div>
        <div class="cp-fatura-list">
          ${faturaItens.length ? faturaItens.map((f) => `
            <div class="cp-fatura-row">
              <span class="cp-fatura-nome">${escapeHtml(f.nome)}<span class="cp-fatura-parcela">(${f.parcela_numero}/${f.num_parcelas})</span></span>
              <span class="cp-fatura-valor">${brl(f.valor_parcela)}</span>
            </div>`).join("") : `<div class="wallet-empty">nenhuma compra parcelada ativa em ${monthLabel(faturaMes)}.</div>`}
        </div>
      </div>
    `;

    el.querySelectorAll("[data-edit-compra]").forEach((el2) => {
      el2.addEventListener("click", () => {
        const id = el2.getAttribute("data-edit-compra");
        const compra = compras.find((c) => c.id === id);
        if (compra) {
          openCompraParceladaModal({
            compra,
            accounts: accountsFlat(),
            onSaved: async () => {
              await reload();
              window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
            },
          });
        }
      });
    });

    el.querySelectorAll("[data-remove-compra]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal(
          "remover essa compra parcelada? isso desfaz a reserva no limite, se tinha conta vinculada.",
          { title: "remover compra parcelada", confirmText: "remover", danger: true }
        ))) return;
        await carteiraApi.deleteCompraParcelada(btn.getAttribute("data-remove-compra"));
        await reload();
        window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
      });
    });

    el.querySelectorAll("[data-adjust]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const delta = Number(btn.getAttribute("data-adjust"));
        const compraId = btn.getAttribute("data-compra");
        try {
          await carteiraApi.ajustarParcelasCompra(compraId, delta);
        } catch (err) {
          showErrorModal(err.message, "erro ao ajustar parcela");
          return;
        }
        await reload();
      });
    });

    el.querySelector('[data-action="add-compra"]').addEventListener("click", () => {
      openCompraParceladaModal({
        accounts: accountsFlat(),
        onSaved: async () => {
          await reload();
          window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
        },
      });
    });

    el.querySelector('[data-action="fatura-prev-month"]').addEventListener("click", () => {
      faturaMes = shiftMonth(faturaMes, -1);
      reloadFatura();
    });
    el.querySelector('[data-action="fatura-next-month"]').addEventListener("click", () => {
      faturaMes = shiftMonth(faturaMes, 1);
      reloadFatura();
    });

    if (focusId) focusRow(el.querySelector(`[data-parcela-id="${focusId}"]`), "parcela");
  }

  await reload();
}