/**
 * Ícones SVG inline — item 15.3 (decisão 24: trocar emoji/glifo unicode
 * por SVG do Lucide, versionado localmente, sem CDN/bundler).
 *
 * Os paths abaixo são cópia exata dos arquivos em
 * frontend/assets/icons/*.svg (ver NOTICE.md nessa pasta pra licença e
 * pro que foi ajustado no traçado original do Lucide). Ficam duplicados
 * aqui de propósito: os .svg são a fonte versionada/abrível num editor,
 * isso aqui é a forma de embutir sem um fetch por render — mesma lógica
 * de "100% local, sem bundler" que já vale pro resto do app.
 *
 * Uso:
 *   import { icon } from "./icons.js";
 *   btn.innerHTML = icon("pencil") + " editar";
 *   el.innerHTML = `<span class="icon-btn-square" data-tooltip="remover">${icon("x", { size: 12 })}</span>`;
 */

const PATHS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  grip:
    '<circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="5" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="19" r="1"/><circle cx="5" cy="19" r="1"/>',
  resize: '<path d="M11 19H5v-6"/><path d="M13 5h6v6"/><path d="M19 5 5 19"/>',
  settings:
    '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  key:
    '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r="1.5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  trending_up: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  star:
    '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "circle-help":
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
};

/**
 * @param {keyof typeof PATHS} name
 * @param {{ size?: number, className?: string, fill?: boolean, strokeWidth?: number, title?: string }} [opts]
 *   `fill` — preenche o ícone (currentColor) em vez de só contorno.
 *   Usado no star "sólido" das conquistas, pra manter o peso visual que
 *   o ★ unicode tinha ali; o resto do app usa outline (fill:none).
 *   `title` — se passado, injeta um <title> pra leitor de tela (os
 *   ícones sozinhos não têm texto ao lado, ex: drag handle/resize).
 */
export function icon(name, opts = {}) {
  const d = PATHS[name];
  if (!d) return "";
  const { size = 14, className = "", fill = false, strokeWidth = 1.75, title = "" } = opts;
  const titleTag = title ? `<title>${title}</title>` : "";
  return (
    `<svg class="icon icon-${name}${className ? ` ${className}` : ""}" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="${title ? "false" : "true"}">` +
    `${titleTag}${d}</svg>`
  );
}