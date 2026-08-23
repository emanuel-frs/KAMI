import { listEmailCache } from "../api/organizacao.js";
import { icon } from "./icons.js";
import { openNotificationsModal } from "../modals/notifications-modal.js";

/**
 * Sino de notificações geral (rodapé da sidebar, ao lado do ícone de
 * configurações) — montado uma vez em app.js (boot()).
 *
 * Notificações v2.1: o sino em si virou só um botão + badge — clicar
 * nele abre modals/notifications-modal.js (calendário + e-mail juntos
 * no mesmo lugar). Antes disso este arquivo também desenhava um
 * popover próprio só com e-mail (`.nbell-pop`, ancorado tipo tooltip
 * no botão), que cortava na tela em telas menores por causa desse
 * posicionamento — motivo principal da migração pro modal central.
 *
 * A contagem do badge continua sendo só de e-mail (não lidos, de
 * contas não silenciadas) — o outro sino (topo da tela de calendário,
 * pages/calendario.js) já mostra a contagem de "vencendo em breve"
 * separadamente; os dois abrem o mesmo modal, só a bolinha de cada um
 * conta coisas diferentes.
 */

let badgeEl = null;
let btn = null;

async function unreadCount() {
  try {
    const cache = await listEmailCache({ exclude_muted: true, is_read: false });
    return cache.length;
  } catch (err) {
    console.error("notification-bell: falha ao carregar contagem de notificações:", err);
    return 0;
  }
}

async function renderBadge() {
  if (!badgeEl) return;
  const n = await unreadCount();
  if (n > 0) {
    badgeEl.textContent = n > 99 ? "99+" : String(n);
    badgeEl.hidden = false;
  } else {
    badgeEl.hidden = true;
  }
}

export function wireNotificationBell() {
  btn = document.getElementById("btn-open-notifications");
  if (!btn) return;

  btn.innerHTML = icon("bell", { size: 14 });
  badgeEl = document.createElement("span");
  badgeEl.className = "nbell-badge";
  badgeEl.hidden = true;
  btn.appendChild(badgeEl);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openNotificationsModal();
  });

  // primeira contagem pro badge já no boot, sem precisar abrir o modal
  renderBadge();
}

/**
 * Reconsulta a contagem e redesenha o badge — chamado por
 * email-sync-scheduler.js depois de um sync automático trazer
 * mensagens novas, e por pages/organizacao.js depois de silenciar/
 * dessilenciar ou ler algo que deveria refletir aqui na hora.
 */
export async function refreshNotificationBell() {
  if (!btn) return; // sino ainda não montado (ex: chamada antes do boot terminar)
  await renderBadge();
}
