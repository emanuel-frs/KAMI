/**
 * Motor do grid de widgets (decisão 17) — portado de kami_telas_final.html.
 *
 * Problemas resolvidos aqui:
 *   - cards se sobrepondo: grid-auto-rows:4px precisa de grid-row-end explicito
 *     em cada card, calculado pela altura real do conteúdo via ResizeObserver.
 *   - coluna única independente do tamanho: container ResizeObserver converte
 *     a largura real do grid (não da janela) para --wg-cols via breakpoints,
 *     e reconverte os data-span (em sextos) para colunas reais.
 *
 * Drag (reordenar) e resize manual (arrastar via ícones grip/resize,
 * ver icons.js) — portados do protótipo
 * (linhas ~1456-1698 do kami_telas_final.html), adaptados pra persistir via
 * onLayoutChange ao final de cada operação em vez de só mexer no DOM.
 */
import { WIDGET_CATALOG, widgetsForScreen } from "./registry.js";
import { icon } from "../components/icons.js";
import { escapeHtml } from "../components/format.js";
import { colsForWidth, packLayout } from "./grid-pack.js";
import {
  widgetsInDomOrder,
  announceToScreenReader,
  createKeyboardReorder,
  mountKeyboardHelpButton,
} from "./grid-teclado.js";
import { attachResizeHandle, attachDragHandle } from "./grid-arrastar.js";
import { t } from "../i18n.js";

const WG_UNITS  = 6;   // "sextos" — mesmo valor do protótipo
const WG_ROW    = 4;   // grid-auto-rows em px   (grid.css)
export const WG_GAP    = 16;  // column-gap em px       (grid.css)
const WG_ROW_MARGIN = 16; // espaço vertical entre cards, em px — aplicado como
                          // margin-bottom no card (grid.css), NÃO como row-gap
export const WG_MIN_H  = 88;  // altura mínima em px — nunca deixa o widget ilegível

// Passo ÚNICO de altura de card, em px.
//
// Por que 4 e não 6: o empacotamento vertical só é exato quando a altura do
// card cabe num número inteiro de linhas do grid. Com row-gap G, a área de N
// linhas é N*(WG_ROW+G)-G, então a altura só pode andar de (WG_ROW+G) em
// (WG_ROW+G) — com G=16 isso trava o passo em 24px, por menor que WG_ROW
// seja. É daí que vinha a folga: um card crescia 6px mas a área reservada
// dele só crescia de 24 em 24, e o card de baixo não se mexia.
//
// A solução é tirar o gap vertical do grid (row-gap: 0) e transformá-lo em
// margin-bottom do próprio card. Aí a área de N linhas é N*WG_ROW, e a
// margin-box do card é altura + WG_ROW_MARGIN. Basta WG_ROW dividir
// WG_ROW_MARGIN (4 divide 16) pra que TODA altura múltipla de 4 caia exata
// num número inteiro de linhas — folga zero, e o card seguinte acompanha
// cada passo do resize.
//
// (Antes disso havia ainda duas redes de altura incompatíveis: automático em
// múltiplos de 12px e manual "curado" em 24N-16. Como 24N-16 ≡ 8 (mod 24) e
// múltiplos de 12 ≡ 0 ou 12 (mod 24), elas nunca se cruzavam — era
// impossível chegar no tamanho padrão arrastando. Agora é tudo a mesma rede.)
const WG_SNAP = WG_ROW; // 4px
export const WG_RESIZE_STEP = WG_SNAP; // incremento da altura nos controles de resize
const WG_AUTO_SNAP = WG_SNAP;   // arredondamento da altura dos widgets automáticos

// Quantas linhas do grid a margin-box do card ocupa. Com row-gap: 0 a área de
// N linhas é exatamente N*WG_ROW, e a margin-box é altura + WG_ROW_MARGIN.
function gridRowsForHeight(height) {
  return Math.max(1, Math.ceil((height + WG_ROW_MARGIN) / WG_ROW));
}

/** Arredonda qualquer altura pra cima até o próximo múltiplo de WG_SNAP. */
function snapHeight(height) {
  return Math.max(WG_SNAP, Math.ceil(height / WG_SNAP) * WG_SNAP);
}

// aliases mantidos pra leitura do código nos dois contextos (manual/automático)
export const snapResizeHeight = snapHeight;
const snapAutoHeight = snapHeight;

function spanFromStyle(value, fallback) {
  const m = /span\s+(\d+)/.exec(value || "");
  return m ? parseInt(m[1], 10) : fallback;
}

/**
 * Aplica packLayout nos cards (e no placeholder do arrasto) na ordem do DOM.
 * A largura de cada card fica em data-scaled (applyScaled/setScaled) e a
 * altura natural em data-rows (placeCard); o crescimento das faixas vem por
 * min-height — o `height` do card continua sendo o do conteúdo (ou o
 * manual), e é ele que é salvo.
 */
export function packCards(container, cols, { alinhar = true } = {}) {
  const els = [...container.querySelectorAll(":scope > .card, :scope > .wg-placeholder")];
  const pos = packLayout(
    els.map((el) => ({
      span: parseInt(el.dataset.scaled, 10) || spanFromStyle(el.style.gridColumnEnd, 1),
      rows: parseInt(el.dataset.rows, 10) || spanFromStyle(el.style.gridRowEnd, gridRowsForHeight(WG_MIN_H)),
      pinned: el.hasAttribute("data-pinned"),
    })),
    cols,
    { alinhar }
  );
  els.forEach((el, i) => {
    const p = pos[i];
    el.style.gridColumn = `${p.col} / span ${p.span}`;
    el.style.gridRow = `${p.row} / span ${p.rows}`;
    const natural = parseInt(el.dataset.rows, 10);
    el.style.minHeight = natural && p.rows > natural ? `${p.rows * WG_ROW - WG_ROW_MARGIN}px` : "";
  });
}

export function currentCols(container) {
  return (
    parseInt(getComputedStyle(container).getPropertyValue("--wg-cols"), 10) ||
    WG_UNITS
  );
}

/**
 * Converte um span em sextos para colunas reais da grade atual.
 * Ex: span=3 (metade da linha) numa grade de 4 colunas → 2 colunas.
 */
function unitToScaled(unit, cols) {
  return Math.max(1, Math.min(cols, Math.round((unit / WG_UNITS) * cols)));
}

/** Inverso de unitToScaled — usado pra persistir o resize manual em sextos. */
function scaledToUnit(scaled, cols) {
  return Math.max(1, Math.min(WG_UNITS, Math.round((scaled / cols) * WG_UNITS)));
}

export function getScaled(card, cols) {
  return unitToScaled(parseInt(card.dataset.span, 10) || 2, cols);
}

/**
 * Largura em colunas reais que o card ocupa AGORA. Não mexe no
 * data-span (a largura salva, em sextos): o mínimo de conteúdo numa grade
 * estreita alarga só o desenho. Antes o data-span era reescrito aqui e, no
 * próximo arrasto numa janela de 4 colunas, a largura distorcida era salva.
 */
function applyScaled(card, scaled, cols) {
  scaled = Math.max(1, Math.min(cols, scaled));
  card.dataset.scaled = String(scaled);
  card.style.gridColumnEnd = `span ${scaled}`; // a coluna de início é do packCards
}

/** Resize manual: a pessoa escolheu a largura — essa vira a salva. */
export function setScaled(card, scaled, cols) {
  scaled = Math.max(1, Math.min(cols, scaled));
  card.dataset.span = scaledToUnit(scaled, cols);
  card.dataset.scaled = String(scaled);
  card.style.gridColumnEnd = `span ${scaled}`; // a coluna de início é do packCards
}

/**
 * Mede a altura que o card precisaria SEM nenhuma altura forçada, na
 * largura atual — ou seja, a altura real do conteúdo. Limpa o height
 * inline, força um reflow síncrono lendo getBoundingClientRect, e
 * restaura o valor original. Usado tanto durante o arrasto do resize
 * manual (regra 3) quanto pra "curar" alturas manuais já persistidas
 * (ex: vindas do backend) que ficaram menores do que o conteúdo precisa.
 */
export function contentMinHeight(card) {
  const prevHeight = card.style.height;
  const prevMinHeight = card.style.minHeight; // crescimento das faixas — não é conteúdo
  const prevAlignSelf = card.style.alignSelf;
  const prevManual = card.dataset.manual;
  card.style.height = "";
  card.style.minHeight = "";
  // Com align-self:stretch, medir sem quebrar o stretch ainda devolveria
  // a altura da área de linhas antiga, e não a altura intrínseca do conteúdo.
  card.style.alignSelf = "start";
  // listas roláveis (log/conquistas) removem seu max-height via CSS
  // quando [data-manual] está presente (ver widgets.css) — sem tirar
  // isso daqui também, a medição pegaria a altura cheia e sem teto da
  // lista inteira, e o "mínimo" pro resize virava do tamanho de todo
  // o conteúdo em vez do teto padrão (a lista já rola por dentro, não
  // precisa de mais que isso pra não cortar informação).
  delete card.dataset.manual;
  const h = Math.ceil(card.getBoundingClientRect().height);
  card.style.height = prevHeight;
  card.style.minHeight = prevMinHeight;
  card.style.alignSelf = prevAlignSelf;
  if (prevManual !== undefined) card.dataset.manual = prevManual;
  return h;
}

/**
 * Mede a largura mínima real do conteúdo (min-content — a mais estreita
 * em que nada precisa ser cortado, texto ainda pode quebrar linha à
 * vontade) via um clone invisível fora da tela. Não toca no card real
 * nem no grid ao vivo, então não causa flicker/relayout visível.
 * Cacheada em dataset.contentMinW — o conteúdo de um widget já
 * renderizado não muda de estrutura, só de dados, então uma medição
 * basta (é invalidada explicitamente depois que o widget termina de
 * carregar de verdade, ver createCard()).
 */
function contentMinWidth(card) {
  if (card.dataset.contentMinW) return parseFloat(card.dataset.contentMinW);
  const clone = card.cloneNode(true);
  clone.style.position = "fixed";
  clone.style.visibility = "hidden";
  clone.style.pointerEvents = "none";
  clone.style.left = "-99999px";
  clone.style.top = "0";
  clone.style.width = "min-content";
  clone.style.height = "auto";
  clone.style.gridColumn = "";
  clone.style.gridRowEnd = "";
  document.body.appendChild(clone);
  const w = Math.ceil(clone.getBoundingClientRect().width);
  document.body.removeChild(clone);
  card.dataset.contentMinW = String(w);
  return w;
}

export function minScaled(card, cols) {
  const catalogMin = unitToScaled(parseInt(card.dataset.minSpan, 10) || 1, cols);

  // piso adicional baseado no conteúdo real (regra 3) — converte a
  // largura mínima medida pro número de colunas "scaled" equivalente,
  // usando o mesmo passo de coluna (colStep) que o resize manual usa.
  const gridRect = card.parentElement?.getBoundingClientRect();
  if (!gridRect || gridRect.width === 0) return catalogMin;
  const colStep = (gridRect.width - WG_GAP * (cols - 1)) / cols + WG_GAP;
  const contentMin = Math.ceil((contentMinWidth(card) + WG_GAP) / colStep);

  return Math.max(catalogMin, Math.min(contentMin, cols));
}

export function maxScaled(card, cols) {
  return unitToScaled(parseInt(card.dataset.maxSpan, 10) || WG_UNITS, cols);
}

/**
 * Aplica gridColumn e gridRowEnd no card de acordo com:
 *   - data-span / data-min-span / data-max-span (em sextos)
 *   - altura real do card em px (via getBoundingClientRect)
 *
 * Se a altura ainda for 0 (antes do primeiro paint), mantém o span
 * inicial de 12 rows (≈ 96px) pra evitar colapso visual.
 */
export function placeCard(card, cols) {
  let scaled = getScaled(card, cols);
  const min = minScaled(card, cols);
  const max = maxScaled(card, cols);
  if (scaled < min) scaled = min;
  if (scaled > max) scaled = max;
  applyScaled(card, scaled, cols);

  // Cards com .editing (ex: profile.js em modo de edição) controlam a
  // própria altura via grid-row-end manualmente (scrollHeight + folga
  // pros campos/botões). Se o ResizeObserver daqui recalculasse em
  // cima disso a cada mudança de tamanho, entraria em disputa com o
  // valor que o widget acabou de definir (fórmulas diferentes, sem a
  // mesma folga) — por isso a altura "não seguia a lógica".
  if (card.classList.contains("editing")) return;

  // cura alturas manuais persistidas (vindas do backend, ou de um resize
  // manual antigo) que ficaram menores que o conteúdo real precisa —
  // ex: conteúdo assíncrono que carregou depois e cresceu, ou um valor
  // salvo desatualizado. Nunca deixa a informação aparecer cortada.
  if (card.dataset.manual === "1" && card.style.height) {
    const min = Math.max(WG_MIN_H, contentMinHeight(card));
    const current = parseInt(card.style.height, 10);
    if (!Number.isNaN(current) && current < min) {
      card.style.height = `${snapHeight(min)}px`;
    } else if (!Number.isNaN(current) && current !== snapHeight(current)) {
      // realinha valores antigos persistidos (que estavam na rede 24N-16)
      // pra rede atual de 6px, sem nunca encolher abaixo do conteúdo
      card.style.height = `${snapHeight(current)}px`;
    }
  }

  // Cards automáticos devem ser dimensionados pelo conteúdo, não pela área
  // de linhas que ainda está aplicada — mas a altura final é arredondada
  // pro próximo múltiplo de WG_SNAP (6px) e aplicada como height explícito,
  // em vez de confiar no align-self:stretch até a área de linha do grid
  // (que sobraria até 20px de folga embaixo do conteúdo). Como o resize
  // manual usa exatamente o mesmo passo, o tamanho padrão é alcançável
  // na mão, e o padrão em si fica o mais justo possível ao conteúdo.
  let h;
  if (card.dataset.manual === "1" && card.style.height) {
    h = parseInt(card.style.height, 10) || card.getBoundingClientRect().height;
  } else {
    const raw = contentMinHeight(card);
    h = raw > 0 ? snapAutoHeight(raw) : 0;
    card.style.height = h > 0 ? `${h}px` : "";
  }
  if (h > 0) {
    const rowSpan = gridRowsForHeight(h);
    card.style.gridRowEnd = `span ${rowSpan}`;
    card.dataset.rows = String(rowSpan);
  }
  // se h === 0 mantém o span inicial definido em render() — o ResizeObserver
  // vai corrigir assim que o conteúdo tiver dimensões reais

  const badge = card.querySelector(":scope > .wg-size-badge");
  if (badge && badge.textContent !== `${scaled}/${cols}`) badge.textContent = `${scaled}/${cols}`;

  // toda mudança de tamanho reempacota a grade (uma vez por frame): sem
  // isso, um card que terminou de carregar ficava com a posição velha até
  // o próximo resize da janela
  schedulePack(card.parentElement);
}

const pendingPack = new WeakMap();
function schedulePack(container) {
  if (!container?.classList?.contains("widget-grid") || pendingPack.has(container)) return;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
  pendingPack.set(container, true);
  raf(() => {
    pendingPack.delete(container);
    if (container.isConnected && !document.body.classList.contains("kami-resizing")) {
      packCards(container, currentCols(container));
    }
  });
}

/**
 * Recalcula --wg-cols a partir da largura atual do container e relayout
 * todos os cards. Chamado pelo ResizeObserver do container e pelo
 * MutationObserver quando cards são add/remove.
 */
function syncGrid(container) {
  const width = container.getBoundingClientRect().width;
  if (width === 0) return; // container ainda não está no DOM visível
  const cols = colsForWidth(width);
  container.style.setProperty("--wg-cols", cols);
  container.querySelectorAll(":scope > .card").forEach((card) =>
    placeCard(card, cols)
  );
  packCards(container, cols);
}

/**
 * Inicializa o grid num container existente.
 *
 * @param {HTMLElement} container - div que vai virar .widget-grid
 * @param {object} options
 * @param {string}   options.screen           - 'perfil' | 'nucleo'
 * @param {Array}    options.widgets          - layout vindo da API
 * @param {Function} options.onLayoutChange   - callback(widgets) pra persistir
 * @returns {{ destroy: Function, setWidgets: Function }}
 */
export function initGrid(container, { screen, widgets: initialWidgets, onLayoutChange }) {
  // Escopado à instância (guardado pra remover em destroy()) — antes isso
  // vazava um novo par de listeners globais a cada vez que a tela era
  // montada (toda navegação pra perfil/núcleo), acumulando pra sempre.
  const preventWindowDrop = (e) => e.preventDefault();
  window.addEventListener("dragover", preventWindowDrop);
  window.addEventListener("drop", preventWindowDrop);

  container.classList.add("widget-grid");

  let widgets = [...initialWidgets];
  const observedCards = new WeakSet();

  // a altura de um card mudou (conteúdo carregou, lista cresceu): placeCard
  // mede e agenda o reempacotamento (schedulePack, uma vez por frame)
  const cardRO = new ResizeObserver((entries) => {
    const cols = currentCols(container);
    entries.forEach((e) => placeCard(e.target, cols));
  });

  // o conteúdo do card chegou ou mudou (render assíncrono, lista
  // recarregada, alça/seta entrando no cabeçalho e quebrando o título em
  // duas linhas): mede de novo. O cardRO não basta — o card tem altura
  // explícita (placeCard), então o que cresce depois só rola por dentro ou
  // fica cortado, e o card não muda de tamanho. Era o que deixava cards
  // 10–20px curtos na abertura e um widget readicionado com a lista cortada
  // (antes o esticamento escondia). O selo de tamanho (escrito pelo próprio
  // placeCard) não conta, senão um alimentaria o outro.
  const bodyObservers = [];
  const medidaPendente = new WeakSet();
  function observarConteudo(card) {
    if (typeof MutationObserver !== "function") return;
    const obs = new MutationObserver((mutations) => {
      if (mutations.every((m) => m.target.closest?.(".wg-size-badge"))) return;
      if (medidaPendente.has(card)) return;
      medidaPendente.add(card);
      requestAnimationFrame(() => {
        medidaPendente.delete(card);
        if (card.isConnected) placeCard(card, currentCols(container));
      });
    });
    obs.observe(card, { childList: true, characterData: true, subtree: true });
    bodyObservers.push(obs);
  }

  const containerRO = new ResizeObserver(() => syncGrid(container));
  containerRO.observe(container);

  const mutationObs = new MutationObserver(() => syncGrid(container));
  mutationObs.observe(container, { childList: true });
  container.addEventListener("dragstart", (e) => e.preventDefault());

  // pausa os observers durante drag/resize manual — evita recálculo em
  // cascata (e a sensação de "tela atualizando") a cada pointermove
  function pauseObservers() {
    containerRO.disconnect();
    mutationObs.disconnect();
  }
  function resumeObservers() {
    containerRO.observe(container);
    mutationObs.observe(container, { childList: true });
    syncGrid(container); // um único recálculo final, não um por movimento
  }

  // ── persistência de drag/resize ─────────────────────────────────────────
  // getCommit(reorder) devolve uma função que, ao ser chamada, atualiza
  // `widgets` (com a nova ordem e/ou largura em sextos lida do DOM) e
  // dispara onLayoutChange. Passada como closure pra attachDragHandle /
  // attachResizeHandle poderem persistir sem conhecer a estrutura de widgets.
  function getCommit(reorder = false) {
    return () => {
      enforcePinnedFirst();
      if (reorder) widgets = pinnedFirst(widgetsInDomOrder(container, widgets));

      container.querySelectorAll(":scope > .card").forEach((card) => {
        const w = widgets.find((x) => x.widget_type === card.dataset.widget);
        if (!w) return;

        const def = WIDGET_CATALOG[card.dataset.widget];
        const minSpan = def?.min_span ?? 1;
        const maxSpan = def?.max_span ?? WG_UNITS;
        const span = parseInt(card.dataset.span, 10);
        if (!Number.isNaN(span)) {
          w.width = Math.max(minSpan, Math.min(maxSpan, span));
        }

        if (card.dataset.manual === "1" && card.style.height) {
          const h = parseInt(card.style.height, 10);
          if (!Number.isNaN(h)) w.height = h; // pixels puro, backend não valida unidade
        } else {
          w.height = null;
        }
      });

      onLayoutChange?.(widgets);
      kw.refreshAllLabels(); // índice "X de N" de cada alça pode ter mudado com o reorder
    };
  }

  // ── reordenação por teclado (alternativa completa ao drag de mouse) ─────
  const kw = createKeyboardReorder(container, getCommit);
  const kwHelpBtn = mountKeyboardHelpButton(container);

  // ── render ─────────────────────────────────────────────────────────────────

  render(widgets);

  function createCard(widget) {
    const def = WIDGET_CATALOG[widget.widget_type];
    if (!def) return null;

    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = -1;
    card.dataset.widget  = widget.widget_type;
    card.dataset.span    = widget.width    ?? def.default_span ?? 2;
    card.dataset.minSpan = def.min_span    ?? 1;
    card.dataset.maxSpan = def.max_span    ?? WG_UNITS;

    if (widget.height) {
      card.style.height   = `${widget.height}px`;
      card.dataset.manual = "1";
    }

    // palpite inicial (linhas de 4px) só até o ResizeObserver medir de verdade
    card.style.gridRowEnd = `span ${gridRowsForHeight(WG_MIN_H)}`;

    const removeBtn = def.removable !== false
      ? `<button type="button" class="widget-remove-btn push" data-remove="${widget.widget_type}" data-tooltip="${t("grid.remover")}" aria-label="${escapeHtml(t("grid.remover_aria", { widget: def.label }))}">${icon("x", { size: 11 })}</button>`
      : "";

    card.innerHTML = `
      <div class="card-head">
        <span class="card-label">${def.label}</span>${removeBtn}
      </div>
      <div class="card-body">
        <span style="color:var(--text-faint);font-size:10px;">${t("geral.carregando")}</span>
      </div>
    `;

    if (!observedCards.has(card)) {
      observedCards.add(card);
      cardRO.observe(card);
      observarConteudo(card);
    }

    attachDragHandle(card, container, getCommit, pauseObservers, resumeObservers, kw);
    attachResizeHandle(card, container, getCommit, pauseObservers, resumeObservers);

    import(def.component)
      .then((mod) => {
        mod.render(card.querySelector(".card-body"), widget);
        requestAnimationFrame(() => placeCard(card, currentCols(container)));
      })
      .catch((err) => {
        console.error(`erro ao carregar widget '${widget.widget_type}':`, err);
        card.querySelector(".card-body").innerHTML = `
          <span style="color:var(--text-faint);font-size:10px;">
            ${t("grid.erro_widget", { tipo: widget.widget_type })}
          </span>`;
        requestAnimationFrame(() => placeCard(card, currentCols(container)));
      });

    return card;
  }

  /**
   * Widgets fixos (removable:false, ex: profile) precisam ser os
   * primeiros no DOM pra CSS (.card[data-pinned], grid-column/row-
   * start:1 !important) garantir a posição 1/1 sem sobreposição —
   * o algoritmo de auto-placement do grid não reserva espaço pra um
   * item que só vai ser forçado depois. Segunda camada de proteção
   * além da ordenação já feita em pages/dashboard.js (withRequiredWidgets),
   * caso setWidgets/render seja chamado com uma ordem diferente.
   */
  function pinnedFirst(list) {
    // "pinned" (ex: profile) é distinto de "removable:false" (ex: também
    // carreira_perfil) — nem todo widget obrigatório é fixo na posição
    // 1/1. Usar removable:false aqui forçava QUALQUER widget obrigatório
    // pro início do array a cada commit de drag, desfazendo reorder do
    // usuário para widgets como carreira_perfil que são obrigatórios mas
    // deliberadamente arrastáveis (ver comentário em carreira-perfil.js).
    return [...list].sort((a, b) => {
      const aPinned = WIDGET_CATALOG[a.widget_type]?.pinned === true;
      const bPinned = WIDGET_CATALOG[b.widget_type]?.pinned === true;
      if (aPinned === bPinned) return 0;
      return aPinned ? -1 : 1;
    });
  }

  /**
   * Garantia final, física, de que o card fixo é o primeiro filho do
   * container — chamada depois de qualquer drag/resize/add/remove, não
   * só no render() inicial. O guard em onMove já evita soltar ANTES
   * dele, mas isso cobre qualquer outro caminho (ex: futuras mudanças
   * de código) que possa alterar a ordem do DOM sem passar por lá.
   */
  function enforcePinnedFirst() {
    const pinned = container.querySelector(":scope > .card[data-pinned]");
    if (pinned && container.firstElementChild !== pinned) {
      container.prepend(pinned);
      syncGrid(container); // a ordem do DOM mudou — recalcula posições
    }
  }

  // ── render usa createCard — só chamado na inicialização ou reset total ──
  function render(currentWidgets) {
    container.innerHTML = "";
    for (const widget of pinnedFirst(currentWidgets)) {
      const card = createCard(widget);
      if (card) container.appendChild(card);
    }
    kw.refreshAllLabels();
    requestAnimationFrame(() => syncGrid(container));
  }

  // ── delegação de eventos ───────────────────────────────────────────────────

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    // <button> real também dispara com Enter/Espaço — o pointer-events:none
    // do CSS só barra o mouse, então o bloqueio do tour precisa ser aqui.
    if (container.classList.contains("wg-tips-locked")) return;
    const type = btn.dataset.remove;
    const card = container.querySelector(`.card[data-widget="${type}"]`);
    const label = WIDGET_CATALOG[type]?.label || "widget";
    // o botão que tinha o foco some junto com o card: sem isso o foco cai
    // no <body> e quem usa teclado volta pro começo da página. Vai pro card
    // vizinho e, se era o único, pro botão "+ adicionar widget".
    let refocus = null;
    if (card?.contains(document.activeElement)) {
      const isCard = (el) => el?.classList?.contains("card");
      refocus = [card.nextElementSibling, card.previousElementSibling].find(isCard) || null;
      if (!refocus) {
        const toolbar = container.previousElementSibling;
        refocus = toolbar?.classList.contains("wg-toolbar")
          ? toolbar.querySelector("button:not(.wg-kw-help-btn)")
          : null;
      }
    }
    kw.cancelIfActive({ silent: true }); // evita um snapshot pendente apontar pra um card que vai sumir
    widgets = widgets.filter((w) => w.widget_type !== type);
    card?.remove();
    if (refocus) {
      if (refocus.classList.contains("card")) refocus.tabIndex = -1; // card só recebe foco por código
      refocus.focus({ preventScroll: true });
    }
    kw.refreshAllLabels(); // a posição "X de N" de todo mundo muda quando N diminui
    announceToScreenReader(t("grid.removido", { widget: label }));
    onLayoutChange?.(widgets);
  });

  // ── API pública ────────────────────────────────────────────────────────────

  function destroy() {
    containerRO.disconnect();
    mutationObs.disconnect();
    cardRO.disconnect();
    bodyObservers.forEach((obs) => obs.disconnect());
    window.removeEventListener("dragover", preventWindowDrop);
    window.removeEventListener("drop", preventWindowDrop);
    kw.destroy();
    kwHelpBtn?.remove();
    container.innerHTML = "";
    container.classList.remove("widget-grid");
  }

  /**
   * Substitui o layout inteiro — usado pela página ao adicionar/remover
   * um widget via popover do catálogo.
   */
  function setWidgets(newWidgets) {
    kw.cancelIfActive({ silent: true }); // idem — o layout inteiro pode ser trocado (render()) logo abaixo
    const existing = new Set(widgets.map(w => w.widget_type));
    const added = newWidgets.filter(w => !existing.has(w.widget_type));
    widgets = [...newWidgets];

    if (added.length > 0) {
      added.forEach(widget => {
        const card = createCard(widget);
        if (!card) return;
        // entra na posição que tem na lista (ex.: widget readicionado volta
        // pro lugar dele no layout padrão), não sempre no fim
        const after = newWidgets.slice(newWidgets.indexOf(widget) + 1)
          .map((w) => container.querySelector(`:scope > .card[data-widget="${w.widget_type}"]`))
          .find(Boolean);
        if (after) after.before(card);
        else container.appendChild(card);
      });
      kw.refreshAllLabels();
      requestAnimationFrame(() => syncGrid(container));
    } else {
      render(widgets);
    }
  }

  /**
   * Troca o layout inteiro, removendo/reordenando o que for preciso —
   * "restaurar padrão" e o desfazer (LAY-05). setWidgets só sabe ACRESCENTAR.
   */
  function resetWidgets(newWidgets) {
    kw.cancelIfActive({ silent: true });
    widgets = [...newWidgets];
    render(widgets);
  }

  /**
   * Trava/destrava drag, resize e remoção de widgets — usado pela
   * sequência de dicas contextuais (etapa 5) enquanto ela aponta pra um
   * card específico, pra evitar que o usuário mexa no grid no meio do
   * tour. Só CSS (ver .wg-tips-locked em card-base.css): não interfere
   * na lógica de drag/resize já existente, só bloqueia o ponto de
   * entrada (pointerdown nos handles).
   */
  function lockForTips() {
    kw.cancelIfActive({ silent: true }); // não deixa uma seleção pendente atravessar o tour
    container.classList.add("wg-tips-locked");
  }
  function unlockForTips() {
    container.classList.remove("wg-tips-locked");
  }

  return { destroy, setWidgets, resetWidgets, lockForTips, unlockForTips };
}

/**
 * Retorna os widgets do catálogo que ainda não estão no layout atual.
 * Usado pelo popover "adicionar widget".
 */
export function availableToAdd(screen, currentWidgets) {
  const present = new Set(currentWidgets.map((w) => w.widget_type));
  return widgetsForScreen(screen).filter(
    (w) => !present.has(w.type) && w.removable !== false
  );
}
