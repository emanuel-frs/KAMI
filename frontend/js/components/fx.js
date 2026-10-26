import { prefersReducedMotion } from "./a11y.js";
import { effectsMode } from "./visual-effects.js";

/**
 * Efeitos visuais do app inteiro (GAM-15) — movimento no estilo de terminal
 * antigo, sem mudar o design. Regras combinadas com o Emanuel em 2026-10-09:
 *
 *   completo:  tudo — texto digitado, números rolando, liga-CRT dos cards,
 *              brilho e clique
 *   sutil:     só o que não atrasa a leitura — números rolando (o brilho e
 *              o clique "pressionado" são CSS, ver css/fx.css)
 *   desligado: nada
 *
 * `prefers-reduced-motion` tira todo movimento (o brilho fica, sem
 * transição). Nada atrasa o uso: animações de entrada < ~300 ms, e
 * qualquer clique ou tecla durante elas encerra tudo na hora (skipEffects).
 *
 * Os efeitos de CSS dependem de <html data-effects> (visual-effects.js);
 * os de JS consultam `fxAllows(nivel)` aqui.
 */

const TYPE_MS_PER_CHAR = 18;
const TYPE_MAX_MS = 260;
const ROLL_MS = 450;
const CRT_STAGGER_MS = 35;
const CRT_MAX_STAGGER = 8;

/** Se um efeito do nível pedido ("completo" ou "sutil") pode rodar agora. */
export function fxAllows(level) {
  if (prefersReducedMotion()) return false;
  const mode = effectsMode();
  if (mode === "desligado") return false;
  return level === "sutil" ? true : mode === "completo";
}

// ── pular: clique/tecla durante uma animação encerra tudo ─────────────

const running = new Set(); // funções que terminam cada animação em andamento

function track(finish) {
  running.add(finish);
  return () => running.delete(finish);
}

export function skipEffects() {
  for (const finish of [...running]) finish();
  running.clear();
  document.querySelectorAll(".fx-crt").forEach((c) => c.classList.remove("fx-crt"));
  document.documentElement.classList.add("fx-skip");
  requestAnimationFrame(() => document.documentElement.classList.remove("fx-skip"));
}

export function wireEffectSkip() {
  const skip = () => {
    if (running.size || document.querySelector(".fx-crt")) skipEffects();
  };
  window.addEventListener("pointerdown", skip, true);
  window.addEventListener("keydown", skip, true);
}

// ── texto digitado ────────────────────────────────────────────────────

/**
 * Digita `text` num nó de texto (ou elemento) letra a letra, com o tempo
 * total limitado a TYPE_MAX_MS — título longo digita mais rápido, nunca
 * atrasa. Sem permissão (fxAllows), escreve direto.
 */
export function typeText(node, text = node.textContent, { level = "completo" } = {}) {
  const write = (value) => {
    node.textContent = value;
  };
  if (!fxAllows(level) || !text) {
    write(text);
    return;
  }
  const perChar = Math.min(TYPE_MS_PER_CHAR, TYPE_MAX_MS / text.length);
  let shown = 0;
  write("");
  let untrack = () => {};
  const timer = setInterval(() => {
    shown += 1;
    write(text.slice(0, shown));
    if (shown >= text.length) finish();
  }, perChar);
  function finish() {
    clearInterval(timer);
    write(text);
    untrack();
  }
  untrack = track(finish);
}

/** Digita o título (primeiro texto solto) de cada .card-head dentro de `root`. */
export function typeCardTitles(root) {
  if (!fxAllows("completo")) return;
  root.querySelectorAll(".card-head").forEach((head) => {
    // widgets do grid: o título fica num .card-label (I18N-04)
    const alvo = head.querySelector(":scope > .card-label") || head;
    const node = [...alvo.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (node) typeText(node, node.textContent);
  });
}

// ── números rolando ───────────────────────────────────────────────────

const lastValues = new Map();

/**
 * Escreve `value` em `el`; se o mesmo `key` já mostrou outro número antes
 * (ex: o card de perfil sendo redesenhado depois de uma ação), conta do
 * valor antigo até o novo em ROLL_MS. `format` formata cada passo.
 */
export function rollNumber(el, value, { key, format = (n) => String(n) } = {}) {
  const from = key ? lastValues.get(key) : undefined;
  if (key) lastValues.set(key, value);
  if (from == null || from === value || !fxAllows("sutil")) {
    el.textContent = format(value);
    return;
  }
  const start = performance.now();
  let frame = null;
  let untrack = () => {};
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / ROLL_MS);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(Math.round(from + (value - from) * eased));
    if (t < 1) frame = requestAnimationFrame(step);
    else finish();
  };
  function finish() {
    cancelAnimationFrame(frame);
    el.textContent = format(value);
    untrack();
  }
  untrack = track(finish);
  frame = requestAnimationFrame(step);
}

// ── entrada de tela: liga-CRT dos cards ───────────────────────────────
// (a varredura de scanline na tela inteira foi testada e saiu: "parece só
// uma linha descendo do nada" — o efeito fica só nos elementos)

/** Cada card "liga" como um monitor antigo, um logo depois do outro. */
export function crtCards(root) {
  if (!fxAllows("completo")) return;
  const cards = [...root.querySelectorAll(".card")];
  cards.forEach((card, i) => {
    card.style.setProperty("--fx-delay", `${Math.min(i, CRT_MAX_STAGGER) * CRT_STAGGER_MS}ms`);
    card.classList.add("fx-crt");
    card.addEventListener("animationend", () => card.classList.remove("fx-crt"), { once: true });
  });
  // garantia: nenhum card fica preso na animação (aba em segundo plano etc.)
  setTimeout(() => cards.forEach((c) => c.classList.remove("fx-crt")), 900);
}

/** Tudo o que acontece quando uma tela termina de montar (app.js::showPage). */
export function pageEnter(root) {
  crtCards(root);
  typeCardTitles(root);
}
