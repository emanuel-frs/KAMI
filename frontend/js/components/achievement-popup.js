import { escapeHtml } from "./format.js";
import { fxAllows, typeText } from "./fx.js";
import { icon } from "./icons.js";
import { effectsMode } from "./visual-effects.js";
import { showToast, toastStack } from "./toast.js";

/**
 * Aviso de conquista "estilo Steam" (GAM-15): um card próprio que sobe do
 * canto inferior direito, com o ícone em destaque, o rótulo ("conquista
 * desbloqueada"), o nome digitado e uma borda que brilha uma vez; fica
 * ~5 s e desce. Missão concluída e sequência salva usam o mesmo modelo, em
 * tamanho menor (`small`).
 *
 * Preferência de efeitos: completo = tudo animado; sutil = aparece sem
 * animação (mesmo card); desligado = vira o toast normal (toast.js). O
 * som (GAM-13, components/sound.js) se pendura em `kami:achievement-popup`,
 * disparado aqui.
 *
 * Acessível: entra na pilha dos toasts, que já é região aria-live (o texto
 * completo vai num span sr-only, porque o nome "digitado" mudaria letra a
 * letra pro leitor de tela); clicável e ativável por teclado quando tem `onClick`; a contagem
 * pra sumir pausa com mouse/foco em cima.
 */

const DURATION_MS = 5200;

/**
 * @param {{ label: string, title: string, detail?: string, iconName?: string,
 *           small?: boolean, onClick?: () => void, kind?: string }} opts
 */
export function showAchievementPopup({ label, title, detail = "", iconName = "star", small = false, onClick, kind = "conquista" }) {
  window.dispatchEvent(new CustomEvent("kami:achievement-popup", { detail: { kind } }));

  if (effectsMode() === "desligado") {
    return showToast({ title: `${label}: ${title}`, message: detail, iconName, onClick, sound: false });
  }

  const animated = fxAllows("completo");
  const el = document.createElement("div");
  el.className = `ach-pop${small ? " small" : ""}${animated ? " animated" : ""}`;
  el.innerHTML = `
    <span class="ach-pop-icon" aria-hidden="true">${icon(iconName, { size: small ? 18 : 26 })}</span>
    <span class="ach-pop-body" aria-hidden="true">
      <span class="ach-pop-label">${escapeHtml(label)}</span>
      <span class="ach-pop-title"></span>
      ${detail ? `<span class="ach-pop-detail">${escapeHtml(detail)}</span>` : ""}
    </span>
    <span class="sr-only">${escapeHtml(`${label}: ${title}${detail ? `. ${detail}` : ""}`)}</span>
  `;

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, DURATION_MS);
  };
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove("open");
    setTimeout(() => el.remove(), animated ? 320 : 0);
  }

  if (onClick) {
    el.classList.add("clickable");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    const activate = () => {
      onClick();
      dismiss();
    };
    el.addEventListener("click", activate);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  }
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", schedule);
  el.addEventListener("focusin", () => clearTimeout(timer));
  el.addEventListener("focusout", schedule);

  toastStack().appendChild(el); // mesma pilha dos toasts: se empilham em vez de sobrepor
  requestAnimationFrame(() => el.classList.add("open"));
  const titleEl = el.querySelector(".ach-pop-title");
  if (animated) setTimeout(() => typeText(titleEl, title), 180); // digita depois de subir
  else titleEl.textContent = title;
  schedule();
  return dismiss;
}
