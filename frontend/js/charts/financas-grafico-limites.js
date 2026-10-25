import * as carteiraApi from "../api/carteira.js";
import { escapeHtml } from "../components/format.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { t } from "../i18n.js";

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("graf.carregando_limites")}</div>`;

  async function reload() {
    let banks;
    try {
      banks = await carteiraApi.listBanks();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("graf.erro_limites", { erro: err.message }))}</div>`;
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
              <div class="lim-top">
                <span class="lim-label" data-tooltip="${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}">${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}</span>
                <span class="lim-pct">${pct}%</span>
              </div>
              <div class="lim-bar-track"><div class="bar-fill lim-${nivel}" style="width:${pct}%;"></div></div>
              <span class="lim-valor-detail">${t("graf.de", { usado: brl(a.fatura_atual || 0), total: brl(a.limite_total) })}</span>
            </div>`;
        }).join("") : `<div class="wallet-empty">${t("graf.sem_limite")}</div>`}
      </div>
    `;
  }

  await reload();
  listenWhileConnected(el, "kami:wallet-changed", reload);
}