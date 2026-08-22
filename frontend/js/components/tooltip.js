/**
 * Tooltip genérico via portal em <body> — substitui o antigo
 * `[data-tooltip]::after` (position:absolute, tooltip.css).
 *
 * Motivo: qualquer ancestral com overflow-y:auto (ex: .subs-list,
 * .dividas-list, .contas-fixas-list, .renda-list — todas com
 * max-height + scroll) corta um `::after` position:absolute do botão
 * quando a linha está perto do topo visível da lista, não importa o
 * z-index. `.compras-parceladas-list` nunca teve esse corte só porque
 * é a única lista sem overflow-y:auto — não é um mecanismo de tooltip
 * diferente, é ausência do problema, não da causa.
 *
 * Mesma estratégia de portal já usada em custom-select.js: no
 * `mouseover`/`focusin` de qualquer `[data-tooltip]`, cria/reposiciona
 * um único `<div class="tooltip-portal">` fixo em `body`
 * (`position: fixed`), calculado via `getBoundingClientRect()` do
 * alvo — imune a `overflow` de qualquer ancestral porque não vive
 * mais dentro da árvore do card. Remove no `mouseout`/`focusout`.
 *
 * Um elemento único e reaproveitado (em vez de um por alvo) porque só
 * um tooltip pode estar visível por vez.
 *
 * Chamado uma única vez em app.js (wireTooltips()) — delegado no
 * document, então funciona pra qualquer `[data-tooltip]` presente
 * agora ou inserido depois (listas de finanças recarregam via
 * innerHTML o tempo todo), sem precisar religar nada por widget.
 *
 * Exceção: `.hm-cell` (heatmap de aprendizado,
 * widget-aprendizado-heatmap.css) já tem tooltip próprio via
 * `::before` — precisou fugir do `::after` genérico porque esse
 * pseudo-elemento já é o marcador de milestone (estrela) ali, então
 * duplicaria (`::after` desligado explicitamente + `::before` custom,
 * multi-linha, largura própria). Esse seletor fica de fora do portal
 * pra não mostrar os dois tooltips ao mesmo tempo.
 *
 * CSS injetado pelo próprio módulo (mesmo motivo do custom-select.js:
 * não depender de um .css externo estar no lugar certo do pipeline).
 * O antigo tooltip.css (regras `::after`) fica só com `.icon-btn-square`
 * (não relacionado a tooltip em si).
 */

const STYLE_ID = "tooltip-portal-styles";
const CSS = `
.tooltip-portal {
  position: fixed;
  background: var(--panel);
  color: var(--text-bright);
  font-size: 9.5px;
  padding: 4px 7px;
  border: 1px solid var(--border);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition: opacity .12s, transform .12s;
  z-index: 5000;
  box-sizing: border-box;
}
.tooltip-portal.show { opacity: 1; transform: translateY(0); }
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

let portalEl = null;
let currentTarget = null;

function ensurePortal() {
  if (portalEl) return portalEl;
  ensureStyles();
  portalEl = document.createElement("div");
  portalEl.className = "tooltip-portal";
  document.body.appendChild(portalEl);
  return portalEl;
}

/** posiciona centralizado acima do alvo, com fallback pros cantos
 *  (mesma ideia de #btn-open-help/.drag-handle/.resize-handle no
 *  tooltip.css antigo — ancora pela borda quando centralizar estouraria
 *  a viewport) e fallback pra abrir embaixo se não couber em cima. */
function positionFor(target, el) {
  const rect = target.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // precisa medir com opacity 0 já visível no DOM pra ter largura real
  el.style.left = "0px";
  el.style.top = "0px";
  const elRect = el.getBoundingClientRect();
  const w = elRect.width;
  const h = elRect.height;

  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(4, Math.min(left, vw - w - 4));

  let top = rect.top - h - 6;
  if (top < 4) top = rect.bottom + 6; // não cabe em cima, abre embaixo
  top = Math.max(4, Math.min(top, vh - h - 4));

  el.style.left = left + "px";
  el.style.top = top + "px";
}

function show(target) {
  if (target.classList.contains("hm-cell")) return; // tooltip próprio via ::before, ver header do arquivo
  const text = target.getAttribute("data-tooltip");
  if (!text) return;
  const el = ensurePortal();
  currentTarget = target;
  el.textContent = text;
  el.classList.remove("show");
  positionFor(target, el);
  // força reposicionar depois do texto trocar (largura mudou) antes de mostrar
  requestAnimationFrame(() => {
    if (currentTarget !== target) return;
    positionFor(target, el);
    el.classList.add("show");
  });
}

function hide(target) {
  if (currentTarget !== target) return;
  currentTarget = null;
  portalEl?.classList.remove("show");
}

function hideImmediately() {
  currentTarget = null;
  portalEl?.classList.remove("show");
}

/** Liga os listeners globais (delegados) uma única vez pro app inteiro.
 *
 * Usa `mouseover`/`mouseout` em vez de `mouseenter`/`mouseleave`, e
 * `focusin`/`focusout` em vez de `focus`/`blur`: os últimos de cada par
 * não fazem bubble (delegação via `capture:true` no document é válida
 * pela spec, mas é um padrão frágil entre engines — WebKit, que o Tauri
 * usa no Linux/macOS, historicamente tem inconsistências aí). Os
 * primeiros de cada par fazem bubble nativamente, então a delegação no
 * document funciona de forma confiável em qualquer engine sem
 * depender de capture. */
export function wireTooltips() {
  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest?.("[data-tooltip]");
    if (!target) return;
    // relatedTarget = de onde o mouse veio; se ainda está dentro do
    // próprio target (ex: veio de um filho pra outro), não é uma nova
    // entrada — evita reabrir/reposicionar à toa a cada pixel.
    if (target.contains(e.relatedTarget)) return;
    show(target);
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target.closest?.("[data-tooltip]");
    if (!target) return;
    if (target.contains(e.relatedTarget)) return; // ainda dentro do target
    hide(target);
  });

  document.addEventListener("focusin", (e) => {
    const target = e.target.closest?.("[data-tooltip]");
    if (target) show(target);
  });

  document.addEventListener("focusout", (e) => {
    const target = e.target.closest?.("[data-tooltip]");
    if (target) hide(target);
  });

  // qualquer scroll/resize invalida a posição calculada — esconder é
  // mais simples e seguro que reposicionar a cada pixel (mesmo padrão
  // de custom-select.js pro dropdown).
  document.addEventListener("scroll", () => hideImmediately(), true);
  window.addEventListener("resize", () => hideImmediately());
  document.addEventListener("click", () => hideImmediately(), true);
}
