import { store } from "../state/store.js";

/**
 * Cursor do mouse em pixel art (GAM-15): seta e "mãozinha" desenhadas em
 * grade, miolo PRETO e borda na cor de destaque ATUAL (pedido do Emanuel em
 * 2026-10-09) — troca junto quando a cor muda em configurações.
 *
 * Como: cada cursor vira um SVG (crispEdges) num data URI, guardado numa
 * variável CSS no <html> (--fx-cursor-default, --fx-cursor-pointer,
 * --fx-cursor-text, -grab, -grabbing, -nwse-resize — ver CURSORS). Pra não
 * ter que caçar as ~130 declarações de cursor espalhadas pelo CSS do app, as regras das folhas de
 * estilo (todas locais, mesma origem) são reescritas uma vez pra apontar
 * pras variáveis — e de novo quando um <style> novo entra no <head> (ex:
 * custom-select.js injeta o dele sob demanda). `cursor:pointer` inline em
 * HTML gerado é coberto por um seletor de atributo em css/fx.css, e campos
 * de texto ganham o cursor de texto em pixel art lá também.
 *
 * Não depende da preferência de efeitos: é estilo, não movimento.
 */

// tamanho de cada pixel da arte, em px de CSS — 1 = tamanho de cursor
// comum (no teste, 2 ficou grande demais); em tela HiDPI o SVG continua nítido
const PX = 1;

// "B" borda (cor de destaque) · "F" miolo (preto) · "." transparente
const ARROW = [
  "B...........",
  "BB..........",
  "BFB.........",
  "BFFB........",
  "BFFFB.......",
  "BFFFFB......",
  "BFFFFFB.....",
  "BFFFFFFB....",
  "BFFFFFFFB...",
  "BFFFFFFFFB..",
  "BFFFFFBBBBB.",
  "BFFBFFB.....",
  "BFB.BFFB....",
  "BB..BFFB....",
  "B....BFFB...",
  ".....BFFB...",
  "......BB....",
];
const HAND = [
  ".....BB.........",
  "....BFFB........",
  "....BFFB........",
  "....BFFB........",
  "....BFFBBB......",
  "....BFFBFFBBB...",
  "....BFFBFFBFFBB.",
  ".BB.BFFBFFBFFBFB",
  "BFFBBFFFFFFFFBFB",
  "BFFFBFFFFFFFFFFB",
  ".BFFFFFFFFFFFFFB",
  "..BFFFFFFFFFFFFB",
  "..BFFFFFFFFFFFB.",
  "...BFFFFFFFFFFB.",
  "....BFFFFFFFFB..",
  "....BFFFFFFFFB..",
  "....BBBBBBBBBB..",
];

const TEXT = [
  "BBB.BBB",
  "BFFBFFB",
  "BBBFBBB",
  "..BFB..",
  "..BFB..",
  "..BFB..",
  "..BFB..",
  "..BFB..",
  "..BFB..",
  "..BFB..",
  "..BFB..",
  "BBBFBBB",
  "BFFBFFB",
  "BBB.BBB",
];
const GRAB = [
  "......BB........",
  "...BB.BFBBB.....",
  "..BFFBBFBFFB....",
  "..BFFBBFBFFBBB..",
  "...BFFBFBFFBFFB.",
  "...BFFFFFFFBFFB.",
  ".BB.BFFFFFFFFFB.",
  "BFFBBFFFFFFFFFB.",
  "BFFFBFFFFFFFFB..",
  ".BFFFFFFFFFFFB..",
  "..BFFFFFFFFFFB..",
  "..BFFFFFFFFFB...",
  "...BFFFFFFFFB...",
  "....BFFFFFFB....",
  "....BFFFFFFB....",
  "....BBBBBBBB....",
];
const GRABBING = [
  "................",
  "................",
  "................",
  "....BB.BB.BB....",
  "...BFFBFFBFFBB..",
  "...BFFFFFFFFBFB.",
  "..BBFFFFFFFFFFB.",
  ".BFFBFFFFFFFFFB.",
  ".BFFFFFFFFFFFB..",
  "..BFFFFFFFFFFB..",
  "...BFFFFFFFFFB..",
  "...BFFFFFFFFB...",
  "....BFFFFFFB....",
  "....BFFFFFFB....",
  "....BBBBBBBB....",
  "................",
];
const NWSE = [
  "BBBBBB.......",
  "BFFFFB.......",
  "BFFFB........",
  "BFFFFB.......",
  "BFBFFFB......",
  "BB.BFFFB.....",
  "....BFFFB....",
  ".....BFFFB.BB",
  "......BFFFBFB",
  ".......BFFFFB",
  "........BFFFB",
  ".......BFFFFB",
  ".......BBBBBB",
];

// tipo de cursor do CSS → [arte, ponto ativo x, y (em pixels da arte)].
// São TODOS os tipos que o app usa (grep "cursor:" em css/ e js/); um tipo
// novo que aparecer cai no cursor do sistema até ganhar arte aqui.
export const CURSORS = {
  default: [ARROW, 0, 0],
  pointer: [HAND, 5, 0],
  text: [TEXT, 3, 7],
  grab: [GRAB, 8, 8],
  grabbing: [GRABBING, 8, 8],
  "nwse-resize": [NWSE, 6, 6],
};

/** SVG da arte como data URI, pronto pra `cursor: url(...)`. */
export function cursorSvg(grid, accent) {
  const w = grid[0].length;
  const h = grid.length;
  let rects = "";
  grid.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === "B" || c === "F") {
        rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c === "B" ? accent : "#000"}"/>`;
      }
    });
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * PX}" height="${h * PX}" ` +
    `viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function currentAccent() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return value || "#8fbf8f";
}

export function applyCursorColors() {
  const accent = currentAccent();
  const root = document.documentElement.style;
  for (const [name, [art, x, y]] of Object.entries(CURSORS)) {
    root.setProperty(`--fx-cursor-${name}`, `${cursorSvg(art, accent)} ${x * PX} ${y * PX}, ${name}`);
  }
}

const REWRITE = Object.fromEntries(Object.keys(CURSORS).map((name) => [name, `var(--fx-cursor-${name})`]));

function rewriteRules(rules) {
  for (const rule of rules) {
    if (rule.cssRules) rewriteRules(rule.cssRules); // @media etc.
    const cursor = rule.style?.cursor;
    if (cursor && REWRITE[cursor]) rule.style.setProperty("cursor", REWRITE[cursor], rule.style.getPropertyPriority("cursor"));
  }
}

export function rewriteCursorRules() {
  for (const sheet of document.styleSheets) {
    try {
      rewriteRules(sheet.cssRules);
    } catch {
      // folha de outra origem (não deveria existir — CSP 'self') — ignora
    }
  }
}

export function wirePixelCursor() {
  applyCursorColors();
  rewriteCursorRules();
  document.documentElement.classList.add("fx-pixel-cursor");
  // a cor de destaque muda pelo perfil (app.js aplica --accent no <html>)
  store.subscribe("profile", () => requestAnimationFrame(applyCursorColors));
  new MutationObserver(() => rewriteCursorRules()).observe(document.head, { childList: true });
}
