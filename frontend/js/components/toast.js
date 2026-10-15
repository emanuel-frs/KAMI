import { icon } from "./icons.js";
import { escapeHtml } from "./format.js";
import { fxAllows, typeText } from "./fx.js";
import { playSound } from "./sound.js";

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

/**
 * GAM-15: com efeitos "completo", título e mensagem aparecem digitados. O
 * texto completo vai antes num span sr-only — a região viva anuncia a
 * frase inteira uma vez, não letra a letra — e o texto visível fica
 * aria-hidden.
 */
function typeToast(el, title, message) {
  if (!fxAllows("completo")) return;
  const body = el.querySelector(".toast-body");
  body.insertAdjacentHTML("afterbegin", `<span class="sr-only">${escapeHtml(message ? `${title}. ${message}` : title)}</span>`);
  const titleEl = body.querySelector(".toast-title");
  const messageEl = body.querySelector(".toast-message");
  titleEl.setAttribute("aria-hidden", "true");
  messageEl?.setAttribute("aria-hidden", "true");
  typeText(titleEl, title);
  if (messageEl) typeText(messageEl, message);
}

/** A pilha de avisos do canto — os avisos "estilo Steam" (achievement-popup.js) entram nela também. */
export function toastStack() {
  return ensureStack();
}

function ensureStack() {
  if (stackEl) return stackEl;
  stackEl = document.createElement("div");
  stackEl.className = "toast-stack";
  stackEl.id = "toast-stack";
  // região viva: leitores de tela anunciam cada toast novo sem mover o
  // foco. "polite" espera o usuário terminar o que está sendo lido.
  // aria-atomic=false → anuncia só o item adicionado, não a pilha toda.
  stackEl.setAttribute("role", "status");
  stackEl.setAttribute("aria-live", "polite");
  stackEl.setAttribute("aria-atomic", "false");
  stackEl.setAttribute("aria-relevant", "additions");
  document.body.appendChild(stackEl);
  return stackEl;
}

// Uma região viva só costuma anunciar mudanças depois de já existir no
// DOM — se ela nascesse junto com o primeiro toast, esse primeiro aviso
// passaria em branco. Cria a pilha vazia já no carregamento do módulo.
if (typeof document !== "undefined" && document.body) ensureStack();

/**
 * @param {{ title: string, message?: string, iconName?: string, duration?: number, onClick?: () => void, sound?: boolean }} opts
 */
export function showToast({ title, message = "", iconName = "bell-ring", duration = 8000, onClick, sound = true } = {}) {
  // GAM-13: bipe de aviso — `sound: false` quando quem chama já toca um
  // som próprio (subida de nível, conquista com efeitos desligados)
  if (sound) playSound("aviso");
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
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.addEventListener("click", (e) => {
      if (e.target.closest(".toast-close")) return;
      onClick();
      dismiss();
    });
    // div não é focável/ativável por teclado por padrão (ver
    // role="button"+tabindex acima, que só resolve a metade da
    // navegação) — sem isto quem usa teclado conseguia dar Tab até
    // aqui mas nunca conseguia "clicar" de fato.
    el.addEventListener("keydown", (e) => {
      if (e.target.closest(".toast-close")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
        dismiss();
      }
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
  // quem navega por teclado precisa da mesma pausa que o hover dá:
  // sem isto o toast sumia (8s) enquanto o foco ainda estava nele.
  el.addEventListener("focusin", () => clearTimeout(hideTimer));
  el.addEventListener("focusout", (e) => {
    if (!el.contains(e.relatedTarget)) scheduleHide();
  });
  el.querySelector(".toast-close").addEventListener("click", dismiss);

  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("open"));
  typeToast(el, title, message);
  scheduleHide();

  return dismiss;
}
