/**
 * Ícones SVG inline — estilo Lucide (outline, stroke=currentColor).
 *
 * Voltamos pra esse esquema depois de testar pixel art (PNG 16×16 via
 * CSS mask) pros mesmos ícones: em qualquer tamanho pequeno (9–14px,
 * a maioria dos usos no app) a pixel art downscalada fica com
 * serrilhado/corte visível, porque escalar arte de pixel por um fator
 * não-inteiro sempre degrada. SVG vetorial escala pra qualquer tamanho
 * sem perda, então resolve isso de raiz — ver assets/icons/*.svg pros
 * arquivos fonte (mesmo estilo/atributos em todos, pra ficar visualmente
 * consistente: stroke-width 1.75, cap/join quadrados).
 *
 * Por que markup embutido aqui (e não <img src="...svg">): um <img>
 * não herda cor de texto (currentColor) do CSS ao redor — ficaria preso
 * na cor "currentColor" resolvida no momento em que o SVG é carregado
 * como recurso externo, sem herdar hover/tema/estado ativo do elemento
 * pai. Inserindo o <svg> como HTML de verdade no DOM (via innerHTML),
 * o `stroke="currentColor"` do arquivo original resolve normalmente
 * contra a cor do elemento onde o ícone entra, então hover/tema mudam
 * a cor do ícone de graça, sem precisar gerar um asset por cor.
 *
 * Uso:
 *   import { icon } from "./icons.js";
 *   btn.innerHTML = icon("pencil") + " editar";
 *   el.innerHTML = `<span class="icon-btn-square" data-tooltip="remover">${icon("x", { size: 12 })}</span>`;
 */

// miolo (sem a tag <svg> externa) de cada ícone, extraído direto dos
// arquivos em assets/icons/*.svg — embutido aqui pra icon() poder
// montar o markup de forma síncrona (sem precisar de fetch()/await
// pra cada ícone renderizado).
const ICON_PATHS = {
  check: '<path d="M20 6 9 17l-5-5" />',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" />',
  grip: '<circle cx="12" cy="5" r="1" /> <circle cx="19" cy="5" r="1" /> <circle cx="5" cy="5" r="1" /> <circle cx="12" cy="12" r="1" /> <circle cx="19" cy="12" r="1" /> <circle cx="5" cy="12" r="1" /> <circle cx="12" cy="19" r="1" /> <circle cx="19" cy="19" r="1" /> <circle cx="5" cy="19" r="1" />',
  resize: '<path d="M11 19H5v-6" /> <path d="M13 5h6v6" /> <path d="M19 5 5 19" />',
  settings:
    '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /> <circle cx="12" cy="12" r="3" />',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /> <circle cx="16.5" cy="7.5" r="1.5" />',
  undo: '<path d="M3 7v6h6" /> <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />',
  download:
    '<path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" />',
  trending_up: '<path d="M16 7h6v6" /> <path d="m22 7-8.5 8.5-5-5L2 17" />',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />',
  x: '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
  "circle-help":
    '<circle cx="12" cy="12" r="10" /> <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /> <path d="M12 17h.01" />',
  "arrow-left": '<path d="m12 19-7-7 7-7" /> <path d="M19 12H5" />',
  "arrow-right": '<path d="M5 12h14" /> <path d="m12 5 7 7-7 7" />',
  receipt:
    '<path d="M12 17V7" /> <path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" /> <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" />',
  "trending-down": '<path d="M16 17h6v-6" /> <path d="m22 17-8.5-8.5-5 5L2 7" />',
  repeat:
    '<path d="m17 2 4 4-4 4" /> <path d="M3 11v-1a4 4 0 0 1 4-4h14" /> <path d="m7 22-4-4 4-4" /> <path d="M21 13v1a4 4 0 0 1-4 4H3" />',
  "credit-card": '<rect width="20" height="14" x="2" y="5" rx="2" /> <line x1="2" x2="22" y1="10" y2="10" />',
  target: '<circle cx="12" cy="12" r="10" /> <circle cx="12" cy="12" r="6" /> <circle cx="12" cy="12" r="2" />',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0" /> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />',
  zap: '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" />',
  "calendar-days":
    '<path d="M8 2v3" /> <path d="M16 2v3" /> <rect x="3" y="3" width="18" height="18" rx="2" /> <path d="M3 9h18" /> <path d="M8 13h.01" /> <path d="M12 13h.01" /> <path d="M16 13h.01" /> <path d="M8 17h.01" /> <path d="M12 17h.01" /> <path d="M16 17h.01" />',
  plus: '<path d="M5 12h14" /> <path d="M12 5v14" />',
  "trash-2":
    '<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
  clock: '<circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" />',
  "bell-ring":
    '<path d="M10.268 21a2 2 0 0 0 3.464 0" /> <path d="M22 8c0-2.3-.8-4.3-2-6" /> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /> <path d="M4 2C2.8 3.7 2 5.7 2 8" />',
  // adicionados pra fechar o levantamento de glifos unicode usados como
  // ícone (item "sem emoji/glifo cru") — mesmo estilo outline/Lucide
  // do resto do arquivo, sem asset novo em assets/icons/ por enquanto.
  "refresh-cw":
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" /> <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /> <path d="M8 16H3v5" />',
  "external-link":
    '<path d="M15 3h6v6" /> <path d="M10 14 21 3" /> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2" /> <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />',
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2" /> <path d="M15 7h2a5 5 0 1 1 0 10h-2" /> <line x1="8" x2="16" y1="12" y2="12" />',
  "chevron-down": '<path d="m6 9 6 6 6-6" />',
  "chevron-right": '<path d="m9 18 6-6-6-6" />',
  minus: '<path d="M5 12h14" />',
  square: '<rect width="18" height="18" x="3" y="3" rx="2" />',
};

const NAMES = new Set(Object.keys(ICON_PATHS));

/**
 * @param {string} name
 * @param {{ size?: number, className?: string, title?: string, fill?: string, strokeWidth?: number }} [opts]
 *   `title` — se passado, expõe o ícone como role="img"+aria-label pra
 *   leitor de tela (os ícones sozinhos não têm texto ao lado, ex: drag
 *   handle/resize). Sem título, some do leitor de tela (aria-hidden).
 *   `fill`/`strokeWidth` — sobrescrevem os atributos padrão do SVG
 *   (fill="none", stroke-width="1.75") caso algum ícone precise
 *   aparecer preenchido ou com traço diferente num contexto específico.
 */
export function icon(name, opts = {}) {
  if (!NAMES.has(name)) return "";
  const { size = 14, className = "", title = "", fill = "none", strokeWidth = 1.75 } = opts;
  const inner = ICON_PATHS[name];
  const a11y = title ? `role="img" aria-label="${title}"` : `aria-hidden="true"`;
  return (
    `<svg class="icon icon-${name}${className ? ` ${className}` : ""}" ${a11y} ` +
    `xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="${fill}" stroke="currentColor" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="square" stroke-linejoin="miter">${inner}</svg>`
  );
}
