import { listEmailCache, listEmailAccounts } from "../api/organizacao.js";

/**
 * Widget cross-module (decisão 17) — resumo do módulo Organização
 * visível em Perfil/Núcleo. v1 sem resumo por IA (item 7.1 do
 * projeto): só contagem de não lidos.
 */
export async function render(el, widget) {
  let cache, accounts;
  try {
    [cache, accounts] = await Promise.all([listEmailCache(), listEmailAccounts()]);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">erro ao carregar notificações: ${err.message}</div>`;
    return;
  }

  const unread = cache.filter((e) => !e.is_read).length;
  el.innerHTML = `
    <div class="vm-row"><span class="k">e-mails não lidos </span><span class="v" style="color:${unread ? "var(--amber)" : "var(--text-bright)"};">${unread}</span></div>
    <div class="vm-row"><span class="k">contas conectadas </span><span class="v">${accounts.length}</span></div>
    <div style="color:var(--text-dim); font-size:10.5px; margin-top:8px;">v1 sem resumo por ia — só contagem de não lidos, puxada do módulo organização.</div>
  `;
}
