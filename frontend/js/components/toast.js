import { icon } from "./icons.js";
import { escapeHtml } from "./format.js";
import { fxAllows, typeText } from "./fx.js";
import { playSound } from "./sound.js";
import { estaNoDocumento } from "./no-documento.js";
import { t } from "../i18n.js";

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
 *
 * CONF-01 (avisos de erro, components/error-notice.js):
 *   - `variant: "erro"` → borda e ícone vermelhos, som "erro";
 *   - `duration: 0` → não some sozinho, só no ✕ (erro não pode sumir
 *     antes de ser lido — decisão do Emanuel);
 *   - `actions: [{ label, onClick(botão) }]` → botões pequenos embaixo da
 *     mensagem (ex.: "copiar detalhes"). O onClick recebe o próprio botão
 *     (pra trocar o rótulo, ex. "copiado ✓"). O clique numa ação não fecha
 *     o toast, a menos que o onClick devolva true (ou uma Promise que resolve true).
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
  // isConnected: se o documento foi trocado (testes com jsdom novo), a
  // pilha antiga ficou solta — cria outra no documento atual
  if (estaNoDocumento(stackEl)) return stackEl;
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
 * @param {{ title: string, message?: string, iconName?: string, duration?: number, onClick?: () => void,
 *           sound?: boolean, variant?: "erro", actions?: { label: string, onClick: (btn: HTMLButtonElement) => (boolean|void) }[] }} opts
 */
export function showToast({
  title,
  message = "",
  iconName = "bell-ring",
  duration = 8000,
  onClick,
  sound = true,
  variant,
  actions = [],
} = {}) {
  // GAM-13: bipe de aviso — `sound: false` quando quem chama já toca um
  // som próprio (subida de nível, conquista com efeitos desligados)
  if (sound) playSound(variant === "erro" ? "erro" : "aviso");
  const stack = ensureStack();

  const el = document.createElement("div");
  el.className = "toast-item" + (variant ? ` toast-${variant}` : "");
  el.innerHTML = `
    <span class="toast-icon">${icon(iconName, { size: 14 })}</span>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ""}
      ${actions.length ? `<div class="toast-actions">${actions
        .map((a, i) => `<button type="button" class="btn sm" data-toast-action="${i}">${escapeHtml(a.label)}</button>`)
        .join("")}</div>` : ""}
    </div>
    <button type="button" class="toast-close" aria-label="${t("geral.dispensar")}">${icon("x", { size: 11 })}</button>
  `;
  el.querySelectorAll("[data-toast-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = actions[Number(btn.dataset.toastAction)].onClick(btn);
      // ação assíncrona (ex.: aplicar o layout novo): fecha quando resolver com true
      if (r === true) dismiss();
      else if (typeof r?.then === "function") r.then((v) => v === true && dismiss(), () => {});
    });
  });

  if (onClick) {
    // EST-03 (axe "nested-interactive"): o aviso inteiro era role="button"
    // com o fechar e as ações dentro — botão dentro de botão confunde o
    // leitor de tela. Agora um botão transparente cobre o aviso (irmão do
    // conteúdo, não pai): clique em qualquer lugar e Enter/Espaço abrem;
    // fechar e ações ficam por cima dele, separados.
    el.classList.add("clickable");
    const abrir = document.createElement("button");
    abrir.type = "button";
    abrir.className = "toast-abrir";
    abrir.setAttribute("aria-label", message ? `${title}. ${message}` : title);
    abrir.addEventListener("click", () => {
      onClick();
      dismiss();
    });
    el.prepend(abrir);
  }

  let hideTimer = null;
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (duration > 0) hideTimer = setTimeout(dismiss, duration);
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
