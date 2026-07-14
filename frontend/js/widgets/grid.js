/**
 * Motor do grid de widgets (decisão 17) — portado de kami_telas_final.html.
 *
 * Problemas resolvidos aqui:
 *   - cards se sobrepondo: grid-auto-rows:8px precisa de grid-row-end explicito
 *     em cada card, calculado pela altura real do conteúdo via ResizeObserver.
 *   - coluna única independente do tamanho: container ResizeObserver converte
 *     a largura real do grid (não da janela) para --wg-cols via breakpoints,
 *     e reconverte os data-span (em sextos) para colunas reais.
 *
 * Drag (reordenar) e resize manual (arrastar ⠿ e ⋰) — portados do protótipo
 * (linhas ~1456-1698 do kami_telas_final.html), adaptados pra persistir via
 * onLayoutChange ao final de cada operação em vez de só mexer no DOM.
 */
import { WIDGET_CATALOG, widgetsForScreen } from "./registry.js";

const WG_UNITS  = 6;   // "sextos" — mesmo valor do protótipo
const WG_ROW    = 8;   // grid-auto-rows em px  (widgets.css)
const WG_GAP    = 16;  // gap em px              (widgets.css)
const WG_MIN_H  = 90;  // altura mínima em px — nunca deixa o widget ilegível

// largura real do container → número de colunas reais da grade.
// Abaixo de 1400px mantém os mesmos degraus fixos de sempre (telas
// pequenas/médias não se beneficiam de mais granularidade). A partir
// daí, cresce proporcional à largura real em vez de travar num teto
// fixo — senão monitores ultrawide/4K ficam com widgets enormes e
// espaço desperdiçado. WG_UNITS (sextos) continua sendo só a precisão
// de armazenamento do span de cada widget, independe de quantas
// colunas reais existem — a conversão em unitToScaled já é proporcional.
const WG_COL_TARGET = 220; // largura "confortável" de coluna, em px, a partir da qual abre mais uma
const WG_MAX_COLS = 12;    // teto de sanidade — evita colunas ínfimas em telas absurdamente largas

function colsForWidth(w) {
  if (w < 680) return 1;
  if (w < 1000) return 2;
  if (w < 1400) return 4;
  const cols = Math.floor((w + WG_GAP) / (WG_COL_TARGET + WG_GAP));
  return Math.max(6, Math.min(WG_MAX_COLS, cols));
}

function currentCols(container) {
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

function getScaled(card, cols) {
  return unitToScaled(parseInt(card.dataset.span, 10) || 2, cols);
}

function setScaled(card, scaled, cols) {
  scaled = Math.max(1, Math.min(cols, scaled));
  card.dataset.span = scaledToUnit(scaled, cols);
  card.style.gridColumnStart = "auto"; // era "" — isso deixava a regra CSS "span 2" do fallback vencer
  card.style.gridColumnEnd = `span ${scaled}`;
}

/**
 * Mede a altura que o card precisaria SEM nenhuma altura forçada, na
 * largura atual — ou seja, a altura real do conteúdo. Limpa o height
 * inline, força um reflow síncrono lendo getBoundingClientRect, e
 * restaura o valor original. Usado tanto durante o arrasto do resize
 * manual (regra 3) quanto pra "curar" alturas manuais já persistidas
 * (ex: vindas do backend) que ficaram menores do que o conteúdo precisa.
 */
function contentMinHeight(card) {
  const prevHeight = card.style.height;
  const prevManual = card.dataset.manual;
  card.style.height = "";
  // listas roláveis (log/conquistas) removem seu max-height via CSS
  // quando [data-manual] está presente (ver widgets.css) — sem tirar
  // isso daqui também, a medição pegaria a altura cheia e sem teto da
  // lista inteira, e o "mínimo" pro resize virava do tamanho de todo
  // o conteúdo em vez do teto padrão (a lista já rola por dentro, não
  // precisa de mais que isso pra não cortar informação).
  delete card.dataset.manual;
  const h = Math.ceil(card.getBoundingClientRect().height);
  card.style.height = prevHeight;
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

function minScaled(card, cols) {
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

function maxScaled(card, cols) {
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
function placeCard(card, cols) {
  let scaled = getScaled(card, cols);
  const min = minScaled(card, cols);
  const max = maxScaled(card, cols);
  if (scaled < min) scaled = min;
  if (scaled > max) scaled = max;
  setScaled(card, scaled, cols);

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
      card.style.height = `${min}px`;
    }
  }

  const h = card.getBoundingClientRect().height;
  if (h > 0) {
    const rowSpan = Math.max(1, Math.ceil((h + WG_GAP) / (WG_ROW + WG_GAP)));
    card.style.gridRowEnd = `span ${rowSpan}`;
  }
  // se h === 0 mantém o span inicial definido em render() — o ResizeObserver
  // vai corrigir assim que o conteúdo tiver dimensões reais

  const badge = card.querySelector(":scope > .wg-size-badge");
  if (badge) badge.textContent = `${scaled}/${cols}`;
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
}

/** Agrupa os cards de um grid por linha visual, comparando offsetTop. */
function rowsOf(container) {
  const cards = [...container.querySelectorAll(":scope > .card")];
  const rows = [];
  let lastTop = null;
  cards.forEach((c) => {
    const top = c.offsetTop;
    if (lastTop === null || Math.abs(top - lastTop) > 2) {
      rows.push([c]);
      lastTop = top;
    } else {
      rows[rows.length - 1].push(c);
    }
  });
  return rows;
}

/**
 * Reordena o array `widgets` (de fora) pra bater com a ordem atual dos
 * cards no DOM — chamado depois de soltar um card arrastado.
 */
function widgetsInDomOrder(container, widgets) {
  const order = [...container.querySelectorAll(":scope > .card")].map(
    (c) => c.dataset.widget
  );
  const byType = new Map(widgets.map((w) => [w.widget_type, w]));
  return order.map((type) => byType.get(type)).filter(Boolean);
}

/**
 * Handle de resize (⋰, canto inferior direito) — largura em frações da
 * linha (ajusta os vizinhos da mesma linha pra não estourar), altura livre
 * com mínimo garantido. Persiste a nova largura via onLayoutChange ao soltar.
 */
function attachResizeHandle(card, container, getCommit, pauseObservers, resumeObservers) {
  if (card.querySelector(":scope > .resize-handle")) return;

  const badge = document.createElement("div");
  badge.className = "wg-size-badge";
  card.appendChild(badge);

  const handle = document.createElement("div");
  handle.className = "resize-handle";
  handle.innerHTML = "⋰";
  handle.title =
    "arraste pra redimensionar — largura em frações da linha, altura livre (mínimo garantido)";
  card.appendChild(handle);

  const reset = document.createElement("div");
  reset.className = "resize-reset";
  reset.innerHTML = "↺";
  reset.title = "voltar ao tamanho automático";
  reset.onclick = () => {
    const cols = currentCols(container);
    card.style.height = "";
    card.dataset.span = card.dataset.origSpan ?? card.dataset.span;
    delete card.dataset.manual;
    placeCard(card, cols);
    getCommit()();
  };
  card.appendChild(reset);

  if (card.dataset.origSpan === undefined) {
    card.dataset.origSpan = card.dataset.span;
  }

  let startX, startY, startH, startScaled, colStep, cols;

  function onMove(e) {
    try {
      const dy = e.clientY - startY;
      // piso real = o maior entre o mínimo absoluto do app e a altura que
      // o conteúdo atual precisa pra não cortar nada (regra 3) — mede na
      // largura já aplicada nesse frame (a largura pode ter mudado no
      // mesmo drag, e isso afeta quebra de linha/altura do conteúdo)
      const floor = Math.max(WG_MIN_H, contentMinHeight(card));
      const newH = Math.max(floor, startH + dy);
      card.style.height = `${newH}px`;
      card.dataset.manual = "1";

      const dx = e.clientX - startX;
      const deltaCols = Math.round(dx / colStep);
      const min = minScaled(card, cols);
      const max = maxScaled(card, cols);
      const scaled = Math.max(min, Math.min(max, startScaled + deltaCols));
      setScaled(card, scaled, cols);

      placeCard(card, cols);

      // outros cards podem ter sido empurrados/puxados de linha pelo
      // auto-placement dense do grid — recalcula a altura (grid-row-end)
      // de todos, já que a posição deles pode ter mudado
      container.querySelectorAll(":scope > .card").forEach((c) => {
        if (c !== card) placeCard(c, cols);
      });
    } catch (err) {
      console.error("erro no resize:", err);
    }
  }

  function onUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    card.classList.remove("resizing");
    card.style.alignSelf = "";           // volta ao comportamento normal (align-self:start via CSS)
    document.body.classList.remove("kami-resizing");
    resumeObservers();
    getCommit()();
  }

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    document.addEventListener("dragstart", (e) => e.preventDefault());
    card.classList.add("resizing");
    card.style.alignSelf = "start";
    document.body.classList.add("kami-resizing");
    pauseObservers();
    startX = e.clientX;
    startY = e.clientY;
    const rect = card.getBoundingClientRect();
    startH = rect.height;
    cols = currentCols(container);
    const gridRect = container.getBoundingClientRect();
    colStep = (gridRect.width - WG_GAP * (cols - 1)) / cols + WG_GAP;
    startScaled = getScaled(card, cols);

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

/**
 * Handle de drag (⠿, no card-head) — arrasta o card inteiro pra reordenar
 * dentro do grid, usando um placeholder que segue o cursor entre os cards
 * vizinhos. Persiste a nova ordem via onLayoutChange ao soltar.
 */
function attachDragHandle(card, container, getCommit, pauseObservers, resumeObservers) {
  const head = card.querySelector(":scope > .card-head");
  if (!head || head.querySelector(":scope > .drag-handle")) return;

  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.innerHTML = "⠿";
  handle.title = "arraste pra reordenar";
  head.insertBefore(handle, head.firstChild);

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    pauseObservers();
    document.body.classList.add("kami-dragging");
    card.classList.add("dragging-card");

    const rect = card.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = "wg-placeholder";
    placeholder.style.gridColumn = card.style.gridColumn;
    placeholder.style.gridRowEnd = card.style.gridRowEnd;
    card.after(placeholder);

    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    card.style.width = `${rect.width}px`;
    card.style.position = "fixed";
    card.style.top = `${rect.top}px`;
    card.style.left = `${rect.left}px`;
    card.style.zIndex = 1000;
    card.style.pointerEvents = "none";
    document.body.appendChild(card);

    function onMove(ev) {
      card.style.top = `${ev.clientY - offY}px`;
      card.style.left = `${ev.clientX - offX}px`;
      const targets = [
        ...container.querySelectorAll(":scope > .card, :scope > .wg-placeholder"),
      ].filter((el) => el !== placeholder);
      const target = targets.find((el) => {
        const r = el.getBoundingClientRect();
        return (
          ev.clientX >= r.left &&
          ev.clientX <= r.right &&
          ev.clientY >= r.top &&
          ev.clientY <= r.bottom
        );
      });
      if (target) {
        // nunca deixa soltar ANTES do card fixo (ex: profile) — ele
        // precisa continuar sendo o primeiro no DOM pra CSS garantir
        // a posição 1/1 sem sobreposição (ver pinnedFirst()/render()).
        if (target.hasAttribute("data-pinned")) {
          target.after(placeholder);
          return;
        }
        const r = target.getBoundingClientRect();
        const before = ev.clientX < r.left + r.width / 2;
        target[before ? "before" : "after"](placeholder);
      }
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      card.style.position = "";
      card.style.top = "";
      card.style.left = "";
      card.style.width = "";
      card.style.zIndex = "";
      card.style.pointerEvents = "";
      placeholder.replaceWith(card);
      card.classList.remove("dragging-card");
      document.body.classList.remove("kami-dragging");
      resumeObservers();          // reconecta e faz 1 syncGrid final, não N durante o drag
      getCommit(true)();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
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

  const cardRO = new ResizeObserver((entries) => {
    const cols = currentCols(container);
    entries.forEach((e) => placeCard(e.target, cols));
  });

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
    };
  }

  // ── render ─────────────────────────────────────────────────────────────────

  render(widgets);

  function createCard(widget) {
    const def = WIDGET_CATALOG[widget.widget_type];
    if (!def) return null;

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.widget  = widget.widget_type;
    card.dataset.span    = widget.width    ?? def.default_span ?? 2;
    card.dataset.minSpan = def.min_span    ?? 1;
    card.dataset.maxSpan = def.max_span    ?? WG_UNITS;

    if (widget.height) {
      card.style.height   = `${widget.height}px`;
      card.dataset.manual = "1";
    }

    card.style.gridRowEnd = "span 12";

    const removeBtn = def.removable !== false
      ? `<span class="widget-remove-btn push" data-remove="${widget.widget_type}" title="remover widget">✕</span>`
      : "";

    card.innerHTML = `
      <div class="card-head">
        <span class="drag-handle" title="arrastar pra reordenar">⠿</span>
        ${def.label}${removeBtn}
      </div>
      <div class="card-body">
        <span style="color:var(--text-faint);font-size:10px;">carregando…</span>
      </div>
    `;
    card.querySelector(":scope > .card-head > .drag-handle")?.remove();

    if (!observedCards.has(card)) {
      observedCards.add(card);
      cardRO.observe(card);
    }

    attachDragHandle(card, container, getCommit, pauseObservers, resumeObservers);
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
            widget '${widget.widget_type}' — a implementar
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
    return [...list].sort((a, b) => {
      const aPinned = WIDGET_CATALOG[a.widget_type]?.removable === false;
      const bPinned = WIDGET_CATALOG[b.widget_type]?.removable === false;
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
    requestAnimationFrame(() => syncGrid(container));
  }

  // ── delegação de eventos ───────────────────────────────────────────────────

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const type = btn.dataset.remove;
    const card = container.querySelector(`.card[data-widget="${type}"]`);
    widgets = widgets.filter((w) => w.widget_type !== type);
    card?.remove();
    onLayoutChange?.(widgets);
  });

  // ── API pública ────────────────────────────────────────────────────────────

  function destroy() {
    containerRO.disconnect();
    mutationObs.disconnect();
    cardRO.disconnect();
    window.removeEventListener("dragover", preventWindowDrop);
    window.removeEventListener("drop", preventWindowDrop);
    container.innerHTML = "";
    container.classList.remove("widget-grid");
  }

  /**
   * Substitui o layout inteiro — usado pela página ao adicionar/remover
   * um widget via popover do catálogo.
   */
  function setWidgets(newWidgets) {
    const existing = new Set(widgets.map(w => w.widget_type));
    const added = newWidgets.filter(w => !existing.has(w.widget_type));
    widgets = [...newWidgets];

    if (added.length > 0) {
      added.forEach(widget => {
        const card = createCard(widget);
        if (card) container.appendChild(card);
      });
      requestAnimationFrame(() => syncGrid(container));
    } else {
      render(widgets);
    }
  }

  return { destroy, setWidgets };
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