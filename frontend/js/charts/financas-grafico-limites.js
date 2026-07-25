import * as walletApi from "../api/wallet.js";
import { escapeHtml } from "../components/format.js";

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando limites…</div>';

  async function reload() {
    let banks;
    try {
      banks = await walletApi.listBanks();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar limites: ${err.message}</div>`;
      return;
    }
    const contasComCredito = banks.flatMap((b) =>
      b.accounts
        .filter((a) => a.possui_credito && a.limite_total)
        .map((a) => ({ ...a, bankNome: b.nome }))
    );
    draw(contasComCredito);
  }

  function draw(contas) {
    el.innerHTML = `
      <div class="chart-limites-list">
        ${contas.length ? contas.map((a) => {
          const pct = Math.max(0, Math.min(100, Math.round(((a.fatura_atual || 0) / a.limite_total) * 100)));
          const nivel = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";
          return `
            <div class="lim-row">
              <span class="lim-label">${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}</span>
              <div class="lim-bar-track"><div class="bar-fill lim-${nivel}" style="width:${pct}%;"></div></div>
              <span class="lim-valor">${pct}%<span class="lim-valor-detail"> (${brl(a.fatura_atual || 0)} de ${brl(a.limite_total)})</span></span>
            </div>`;
        }).join("") : `<div class="wallet-empty">nenhuma conta com crédito e limite definido.</div>`}
      </div>
    `;
  }

  await reload();
  window.addEventListener("kami:wallet-changed", reload);
}