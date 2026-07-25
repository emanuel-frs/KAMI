import * as walletApi from "../api/wallet.js";

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando resumo…</div>';

  async function reload() {
    let summary;
    try {
      summary = await walletApi.getWalletSummary();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar resumo: ${err.message}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="financas-resumo-widget">
        <div class="resumo-card possui">
          <div class="rc-label">total possuído</div>
          <div class="rc-value">${brl(summary.total_possui)}</div>
        </div>
        <div class="resumo-card a-pagar">
          <div class="rc-label">total a pagar</div>
          <div class="rc-value">${brl(summary.total_a_pagar)}</div>
        </div>
      </div>
    `;
  }

  await reload();
  window.addEventListener("kami:wallet-changed", reload);
}
