import * as walletApi from "../api/wallet.js";
import { escapeHtml } from "./format.js";
import { openCompraParceladaModal } from "./compra-parcelada-modal.js";
import { showErrorModal } from "./err-model.js";
import { showConfirmModal } from "./confirm-modal.js";

/**
 * Widget "compras parceladas". A progressão (parcela_atual) vem
 * calculada do backend (calendário + ajuste manual). Os botões ‹ ›
 * chamam walletApi.ajustarParcelasCompra pra adiantar/desfazer um
 * adiantamento — não mexe em fatura/saldo, só no rótulo de progresso
 * (a reserva no limite já foi feita inteira na criação da compra).
 */

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando compras parceladas…</div>';
  let compras = [];
  let banks = [];

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
        walletApi.listComprasParceladas(),
        walletApi.listBanks(),
      ]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar compras parceladas: ${err.message}</div>`;
      return;
    }
    draw();
  }

  function draw() {
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
            <div class="compra-parcelada-row${c.quitada ? " quitada" : ""}">
              <div class="cp-top">
                <span class="cp-nome">${escapeHtml(c.nome)}</span>
                <span class="cp-remove" data-remove-compra="${c.id}" data-tooltip="remover (desfaz a reserva no limite, se tinha conta)">×</span>
              </div>
              <div class="cp-meta">
                <div class="cp-parcela-adjust">
                  <button type="button" class="cp-adjust-btn" data-adjust="-1" data-compra="${c.id}" data-tooltip="desfazer um adiantamento">‹</button>
                  <span class="cp-parcela">${c.parcela_atual}/${c.num_parcelas}${ajusteTag}${c.quitada ? " · quitada" : ""}</span>
                  <button type="button" class="cp-adjust-btn" data-adjust="1" data-compra="${c.id}" data-tooltip="adiantar uma parcela">›</button>
                </div>
                <span class="cp-valor">${brl(c.valor_parcela)}<span class="cp-valor-total"> de ${brl(c.valor_total)}</span></span>
              </div>
              <div class="cp-conta">${contaLabel}</div>
            </div>`;
        }).join("") : `<div class="wallet-empty">nenhuma compra parcelada cadastrada.</div>`}
      </div>
    `;

    el.querySelectorAll("[data-remove-compra]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal(
          "remover essa compra parcelada? isso desfaz a reserva no limite, se tinha conta vinculada.",
          { title: "remover compra parcelada", confirmText: "remover", danger: true }
        ))) return;
        await walletApi.deleteCompraParcelada(btn.getAttribute("data-remove-compra"));
        await reload();
        window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
      });
    });

    el.querySelectorAll("[data-adjust]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const delta = Number(btn.getAttribute("data-adjust"));
        const compraId = btn.getAttribute("data-compra");
        try {
          await walletApi.ajustarParcelasCompra(compraId, delta);
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
  }

  await reload();
}