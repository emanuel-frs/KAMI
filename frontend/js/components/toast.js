import { icon } from "./icons.js";
import { escapeHtml } from "./format.js";

/**
 * Toast empilhável (diferente do singleton de backup-reminder.js — aqui
 * pode ter mais de um visível ao mesmo tempo, ex: dois lembretes de
 * calendário disparando perto um do outro). Usado por
 * components/calendar-notifications.js pros lembretes de evento e pro
 * resumo diário de "vencendo hoje".
 *
 * Auto-some depois de `duration` ms (default 8s) a menos que o mouse
 * esteja em cima — mesma UX de toast convencional (pausa a contagem em
 * hover pra não sumir enquanto o usuário está lendo/clicando).
 */

let stackEl = null;

function ensureStack() {
  if (stackEl) return stackEl;
  stackEl = document.createElement("div");
  stackEl.className = "toast-stack";
  stackEl.id = "toast-stack";
  document.body.appendChild(stackEl);
  return stackEl;
}

/**
 * @param {{ title: string, message?: string, iconName?: string, duration?: number, onClick?: () => void }} opts
 */
export function showToast({ title, message = "", iconName = "bell-ring", duration = 8000, onClick } = {}) {
  const stack = ensureStack();

  const el = document.createElement("div");
  el.className = "toast-item";
  el.innerHTML = `
    <span class="toast-icon">${icon(iconName, { size: 14 })}</span>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ""}
    </div>
    <button type="button" class="toast-close" aria-label="dispensar">${icon("x", { size: 11 })}</button>
  `;

  if (onClick) {
    el.classList.add("clickable");
    el.addEventListener("click", (e) => {
      if (e.target.closest(".toast-close")) return;
      onClick();
      dismiss();
    });
  }

  let hideTimer = null;
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(dismiss, duration);
  }
  function dismiss() {
    clearTimeout(hideTimer);
    el.classList.remove("open");
    setTimeout(() => el.remove(), 200);
  }

  el.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  el.addEventListener("mouseleave", scheduleHide);
  el.querySelector(".toast-close").addEventListener("click", dismiss);

  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("open"));
  scheduleHide();

  return dismiss;
}
