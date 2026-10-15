import { allowsMotion } from "./visual-effects.js";

/**
 * Barra de xp em texto (GAM-05) — "[######----]", mesmo estilo da barra
 * de progresso das conquistas. Usada no widget de perfil e na barra
 * lateral (components/sidebar-level.js).
 *
 * `setXpBar(el, pct, { from })` escreve a barra em `el`; com `from`
 * (porcentagem anterior) e movimento permitido (allowsMotion), preenche
 * bloco a bloco até o valor novo, em vez de pular direto.
 */

const DEFAULT_CELLS = 10;
const STEP_MS = 45;
const timers = new WeakMap();

function filledCells(pct, cells) {
  return Math.max(0, Math.min(cells, Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells)));
}

export function xpBar(pct, cells = DEFAULT_CELLS) {
  const filled = filledCells(pct, cells);
  return `[${"#".repeat(filled)}${"-".repeat(cells - filled)}]`;
}

function barFromFilled(filled, cells) {
  return `[${"#".repeat(filled)}${"-".repeat(cells - filled)}]`;
}

export function setXpBar(el, pct, { from = null, cells = DEFAULT_CELLS } = {}) {
  clearInterval(timers.get(el));
  const target = filledCells(pct, cells);
  let current = from == null ? target : filledCells(from, cells);
  if (current === target || !allowsMotion()) {
    el.textContent = barFromFilled(target, cells);
    return;
  }
  const step = current < target ? 1 : -1;
  el.textContent = barFromFilled(current, cells);
  const timer = setInterval(() => {
    current += step;
    el.textContent = barFromFilled(current, cells);
    if (current === target || !el.isConnected) clearInterval(timer);
  }, STEP_MS);
  timers.set(el, timer);
}
