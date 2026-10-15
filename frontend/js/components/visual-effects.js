import { store } from "../state/store.js";
import { prefersReducedMotion } from "./a11y.js";

/**
 * Preferência de efeitos visuais da gamificação (GAM-04), salva no perfil
 * (user_profile.efeitos_visuais):
 *   - completo:  tela cheia de subida de nível + linhas de xp + avisos
 *   - sutil:     linhas de xp + avisos, sem a tela cheia
 *   - desligado: só os avisos (toasts), sem nada animado
 *
 * `prefers-reduced-motion` do sistema não muda a escolha, só tira o
 * movimento: quem tem `completo` continua vendo a tela de nível, parada.
 *
 * `wireVisualEffects()` (app.js) espelha a escolha em
 * <html data-effects="..."> pra o CSS esconder o que não deve aparecer
 * (ex: xp-feedback.css some com `desligado`).
 */
export const EFFECT_MODES = ["completo", "sutil", "desligado"];

export function effectsMode() {
  const mode = store.get("profile")?.efeitos_visuais;
  return EFFECT_MODES.includes(mode) ? mode : "completo";
}

/** Se dá pra animar agora: efeitos não desligados e sistema sem reduced-motion. */
export function allowsMotion() {
  return effectsMode() !== "desligado" && !prefersReducedMotion();
}

function applyMode() {
  document.documentElement.dataset.effects = effectsMode();
}

export function wireVisualEffects() {
  applyMode();
  store.subscribe("profile", applyMode);
}
