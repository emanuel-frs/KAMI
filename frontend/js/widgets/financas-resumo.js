import * as carteiraApi from "../api/carteira.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { escapeHtml, fmtMoeda } from "../components/format.js";
import { t } from "../i18n.js";

function brl(v) {
  return fmtMoeda(v);
}

export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("resumo.carregando")}</div>`;

  async function reload() {
    let summary;
    try {
      summary = await carteiraApi.getWalletSummary();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("resumo.erro", { erro: err.message }))}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="financas-resumo-widget">
        <div class="resumo-card possui">
          <div class="rc-label">${t("resumo.possui")}</div>
          <div class="rc-value">${brl(summary.total_possui)}</div>
        </div>
        <div class="resumo-card a-pagar">
          <div class="rc-label">${t("resumo.a_pagar")}</div>
          <div class="rc-value">${brl(summary.total_a_pagar)}</div>
        </div>
      </div>
    `;
  }

  await reload();
  listenWhileConnected(el, "kami:wallet-changed", reload);
}
