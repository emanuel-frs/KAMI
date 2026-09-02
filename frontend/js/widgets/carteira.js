import * as carteiraApi from "../api/carteira.js";
import { fitAsciiText } from "../components/ascii.js";
import { escapeHtml } from "../components/format.js";
import { openContaModal } from "../modals/conta-modal.js";
import { icon } from "../components/icons.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { showPromptModal } from "../modals/prompt-modal.js";
import { showErrorModal } from "../modals/err-modal.js";

function brl(v) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pctLimite(a) {
  if (!a.limite_total) return 0;
  return Math.max(0, Math.min(100, Math.round((a.fatura_atual / a.limite_total) * 100)));
}
function bankIconInner(bank) {
  if (bank.icon_ascii) return `<pre>${escapeHtml(bank.icon_ascii)}</pre>`;
  const fallback = bank.nome.slice(0, 2).toUpperCase();
  return `<span class="ph">${fallback}</span>`;
}
function accountCardHtml(bank, a) {
  const editBtn = `<span class="ba-edit" data-edit-account="${a.id}" data-bank-id="${bank.id}" data-tooltip="editar conta">${icon("pencil", { size: 11 })}</span>`;
  const removeBtn = `<span class="ba-remove" data-remove-account="${a.id}" data-tooltip="remover conta">${icon("x", { size: 11 })}</span>`;
  let saldoBlock = "";
  if (a.possui_saldo) saldoBlock = `<div class="ba-row"><span>saldo atual</span><b>${brl(a.saldo_atual)}</b></div>`;
  let creditoBlock = "";
  if (a.possui_credito) {
    const pct = pctLimite(a);
    creditoBlock = `
      <div class="ba-row"><span>fatura atual</span><b>${brl(a.fatura_atual)}</b></div>
      <div class="ba-credito-block">
        <div class="ba-limit"><div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div></div>
        <div class="ba-foot"><span>${pct}% do limite de ${brl(a.limite_total)}</span><span>vencimento dia ${a.dia_vencimento || "—"}</span></div>
      </div>`;
  }
  if (!a.possui_saldo && !a.possui_credito) saldoBlock = `<div class="ba-empty-flags">sem saldo nem crédito configurado</div>`;
  return `
    <div class="bank-account">
      <div class="ba-head"><span class="ba-name">${escapeHtml(a.nome)}</span><span class="ba-actions">${editBtn}${removeBtn}</span></div>
      ${saldoBlock}${creditoBlock}
    </div>`;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando carteira…</div>';
  let banks = [];
  let expandedBankId = null;
  let boundWalletChanged = null;

  function draw() {
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-account">+ nova conta</button>
      </div>
      <div class="wallet-stack">
        ${banks.length ? banks.map((b) => {
          const expanded = b.id === expandedBankId;
          let accountsHtml = "";
          if (expanded) {
            const scrollStyle = b.accounts.length > 2 ? 'style="max-height:184px; overflow-y:auto;"' : "";
            accountsHtml = `<div class="bank-accounts" ${scrollStyle}>${b.accounts.map((a) => accountCardHtml(b, a)).join("")}</div>`;
          }
          return `
            <div class="bank-item${expanded ? " expanded" : ""}" data-bank-id="${b.id}">
              <div class="bank-head" data-toggle-bank="${b.id}">
                <div class="bank-icon">${bankIconInner(b)}</div>
                <div class="bank-name">${escapeHtml(b.nome)}</div>
                <div class="bank-count">${b.accounts.length}</div>
                <span class="bank-edit" data-edit-bank="${b.id}" data-tooltip="renomear banco">${icon("pencil", { size: 11 })}</span>
                <span class="bank-remove" data-remove-bank="${b.id}" data-tooltip="apagar banco">${icon("x", { size: 11 })}</span>
              </div>
              ${accountsHtml}
            </div>`;
        }).join("") : `<div class="wallet-empty">nenhuma conta ainda — clique em "+ nova conta".</div>`}
      </div>
    `;

    banks.forEach((b) => {
      if (b.icon_ascii) {
        const pre = el.querySelector(`[data-bank-id="${b.id}"] .bank-icon pre`);
        if (pre) fitAsciiText(pre, b.icon_ascii, { container: pre.parentElement, maxHeight: 24, maxFont: 6, minFont: 0.35, paddingX: 4, paddingY: 4 });
      }
    });

    el.querySelectorAll("[data-toggle-bank]").forEach((node) => {
      node.addEventListener("click", () => {
        const id = node.getAttribute("data-toggle-bank");
        expandedBankId = expandedBankId === id ? null : id;
        draw();
      });
    });
    el.querySelectorAll("[data-edit-account]").forEach((node) => {
      node.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const accId = node.getAttribute("data-edit-account");
        const bankId = node.getAttribute("data-bank-id");
        const bank = banks.find((b) => b.id === bankId);
        const account = bank?.accounts.find((a) => a.id === accId);
        if (!bank || !account) return;
        openContaModal({
          banks,
          account,
          bankName: bank.nome,
          onSaved: async () => {
            await reload();
            window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
          },
        });
      });
    });
    el.querySelectorAll("[data-remove-account]").forEach((node) => {
      node.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const ok = await showConfirmModal("remover essa conta?", { title: "remover conta", confirmText: "remover", danger: true });
        if (!ok) return;
        await carteiraApi.deleteAccount(node.getAttribute("data-remove-account"));
        await reload();
        window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
      });
    });
    el.querySelectorAll("[data-edit-bank]").forEach((node) => {
      node.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const bankId = node.getAttribute("data-edit-bank");
        const bank = banks.find((b) => b.id === bankId);
        if (!bank) return;
        const novoNome = await showPromptModal("nome do banco", {
          title: "renomear banco",
          defaultValue: bank.nome,
          confirmText: "salvar",
        });
        if (novoNome === null) return;
        const nome = novoNome.trim();
        if (!nome) {
          showErrorModal("o nome não pode ficar em branco.", "atenção");
          return;
        }
        await carteiraApi.updateBank(bankId, { nome, icon_ascii: bank.icon_ascii });
        await reload();
      });
    });
    el.querySelectorAll("[data-remove-bank]").forEach((node) => {
      node.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const bankId = node.getAttribute("data-remove-bank");
        const bank = banks.find((b) => b.id === bankId);
        if (!bank) return;
        const n = bank.accounts.length;
        const msg = n > 0
          ? `apagar "${bank.nome}" também remove ${n} conta${n === 1 ? "" : "s"} dele. essa ação não pode ser desfeita.`
          : `apagar o banco "${bank.nome}"? essa ação não pode ser desfeita.`;
        const ok = await showConfirmModal(msg, { title: "apagar banco", confirmText: "apagar", danger: true });
        if (!ok) return;
        await carteiraApi.deleteBank(bankId);
        if (expandedBankId === bankId) expandedBankId = null;
        await reload();
        window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
      });
    });
    el.querySelector('[data-action="add-account"]')?.addEventListener("click", () => {
      openContaModal({
        banks,
        onSaved: async () => {
          await reload();
          window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
        },
      });
    });
  }

  async function reload() {
    try {
      banks = await carteiraApi.listBanks();
      if (!banks.some((b) => b.id === expandedBankId)) {
        expandedBankId = null;
      }
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar carteira: ${err.message}</div>`;
      return;
    }
    draw();
  }

  await reload();

  // atualiza quando uma transação/transferência mexe em saldo/fatura em
  // outro widget (financas-registros.js) — mesmo padrão do
  // 'kami:action-registered' que attributes.js já escuta
  boundWalletChanged = reload;
  window.addEventListener("kami:wallet-changed", boundWalletChanged);
}
