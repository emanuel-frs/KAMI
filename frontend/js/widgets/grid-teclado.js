/**
 * Grid de widgets — mover e redimensionar pelo teclado (modo de edição),
 * com aviso para leitor de tela e o botão de ajuda dos atalhos.
 * MAN-02: saiu de widgets/grid.js, que continua com as medidas, o encaixe
 * na tela e o initGrid.
 */
import { WIDGET_CATALOG } from "./registry.js";
import { icon } from "../components/icons.js";
import { openWidgetShortcutsModal } from "../modals/widget-shortcuts-modal.js";
import {
  WG_MIN_H,
  WG_RESIZE_STEP,
  snapResizeHeight,
  currentCols,
  getScaled,
  setScaled,
  contentMinHeight,
  minScaled,
  maxScaled,
  placeCard,
} from "./grid.js";

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
export function widgetsInDomOrder(container, widgets) {
  const order = [...container.querySelectorAll(":scope > .card")].map(
    (c) => c.dataset.widget
  );
  const byType = new Map(widgets.map((w) => [w.widget_type, w]));
  return order.map((type) => byType.get(type)).filter(Boolean);
}

/**
 * Cards que podem ser reordenados — exclui o fixo (data-pinned, ex:
 * profile), que nunca sai da posição 1/1 (mesma regra do drag de
 * mouse, ver onMove() em attachDragHandle e pinnedFirst()). Usado
 * tanto pelo drag quanto pela reordenação por teclado como a "lista de
 * posições possíveis".
 */
function movableCards(container) {
  return [...container.querySelectorAll(":scope > .card:not([data-pinned])")];
}

/**
 * Devolve [primeiroCard, últimoCard] (só os reordenáveis) da mesma
 * linha visual do card passado — usado pelos atalhos "início/fim da
 * linha" (Shift+Home/End e Ctrl/Cmd+Shift+←/→) da reordenação por
 * teclado. `null` se o card não estiver (ainda) renderizado em
 * nenhuma linha.
 */
function movableRowBounds(container, card) {
  const row = rowsOf(container).find((r) => r.includes(card));
  if (!row) return null;
  const movable = row.filter((c) => !c.hasAttribute("data-pinned"));
  return movable.length ? [movable[0], movable[movable.length - 1]] : null;
}

/**
 * Move `card` `steps` posições à frente (positivo) ou pra trás
 * (negativo) dentro de movableCards(), reinserindo-o no DOM
 * imediatamente antes/depois do card que hoje ocupa a posição de
 * destino — mesma técnica (`el.before()`/`el.after()`) já usada pelo
 * placeholder do drag de mouse (ver attachDragHandle/onMove), só que
 * movendo o card de verdade em vez de um placeholder. Clampa nas
 * bordas em vez de estourar; devolve `false` quando não houve
 * movimento real (já estava na borda, ou nada pra mover). Usado pelas
 * setas da reordenação por teclado (ver createKeyboardReorder()).
 */
function stepCard(container, card, steps) {
  const list = movableCards(container);
  const from = list.indexOf(card);
  if (from === -1 || steps === 0) return false;
  const to = Math.max(0, Math.min(list.length - 1, from + steps));
  if (to === from) return false;
  const ref = list[to];
  if (to > from) ref.after(card);
  else ref.before(card);
  return true;
}

/**
 * Move `card` pra primeira ou última posição reordenável do grid
 * inteiro — Ctrl/Cmd+Shift+↑/↓ da reordenação por teclado.
 */
function moveCardToGridEdge(container, card, edge) {
  const list = movableCards(container);
  if (list.length < 2) return false;
  const target = edge === "start" ? list[0] : list[list.length - 1];
  if (target === card) return false;
  target[edge === "start" ? "before" : "after"](card);
  return true;
}

/**
 * Move `card` pro início ou fim da SUA linha visual atual —
 * Shift+Home/End e Ctrl/Cmd+Shift+←/→ da reordenação por teclado.
 */
function moveCardToRowEdge(container, card, edge) {
  const bounds = movableRowBounds(container, card);
  if (!bounds) return false;
  const [start, end] = bounds;
  const target = edge === "start" ? start : end;
  if (target === card) return false;
  target[edge === "start" ? "before" : "after"](card);
  return true;
}

/**
 * Reaplica uma ordem completa (array de cards) no DOM, na sequência
 * exata dada — usado só pra desfazer uma reordenação por teclado
 * cancelada (Esc), restaurando o snapshot tirado no momento em que o
 * card foi selecionado. Não é o caminho "quente" (cada passo de
 * movimento usa stepCard/moveCardTo*Edge, que são O(1) via
 * before()/after()) — aqui reinserir tudo em sequência é o jeito mais
 * simples de garantir a ordem exata sem ter que calcular o diff entre
 * a ordem atual e a original.
 */
function restoreCardOrder(container, orderedCards) {
  let ref = container.querySelector(":scope > .card[data-pinned]") || null;
  orderedCards.forEach((c) => {
    if (ref) ref.after(c);
    else container.prepend(c);
    ref = c;
  });
}

function restoreCardSize(card, snapshot) {
  card.dataset.span = snapshot.span;
  if (snapshot.height === "") {
    card.style.height = "";
  } else {
    card.style.height = snapshot.height;
  }
  if (snapshot.manual) card.dataset.manual = "1";
  else delete card.dataset.manual;
  placeCard(card, currentCols(card.parentElement));
}

/** true se `el` é um campo de formulário (ou está dentro de um) — usado
 * pra não capturar "?" (abrir modal de atalhos) nem outras teclas de
 * reordenação enquanto o usuário está digitando dentro de um widget. */
function isEditableTarget(el) {
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

// região aria-live compartilhada por todas as instâncias do grid da
// página (só uma tela com grid fica montada por vez) — criada sob
// demanda, mesmo padrão singleton dos modais (ver modals/*.js).
// Anuncia pro leitor de tela cada passo da reordenação por teclado.
let kwLiveRegionEl = null;
export function announceToScreenReader(message) {
  if (!kwLiveRegionEl || !document.body.contains(kwLiveRegionEl)) {
    kwLiveRegionEl = document.getElementById("wg-kw-live-region");
    if (!kwLiveRegionEl) {
      kwLiveRegionEl = document.createElement("div");
      kwLiveRegionEl.id = "wg-kw-live-region";
      kwLiveRegionEl.className = "sr-only";
      kwLiveRegionEl.setAttribute("aria-live", "polite");
      kwLiveRegionEl.setAttribute("aria-atomic", "true");
      document.body.appendChild(kwLiveRegionEl);
    }
  }
  // limpa antes de setar — repete a mesma mensagem duas vezes seguidas
  // (ex: "já está na borda do grid.") sem isso não dispara um novo
  // anúncio em alguns leitores de tela, porque o texto não mudou.
  kwLiveRegionEl.textContent = "";
  requestAnimationFrame(() => {
    if (kwLiveRegionEl) kwLiveRegionEl.textContent = message;
  });
}

/**
 * Controle de teclado do grid. Ctrl+D entra em um modo próprio de
 * navegação: Tab fica bloqueado e as setas trocam o widget pré-selecionado.
 * Enter confirma esse widget para movimentação; as setas então alteram a
 * ordem, Shift+setas ajustam o tamanho e Enter salva as mudanças. A alça
 * continua sendo exclusivamente o alvo do drag com mouse.
 */
export function createKeyboardReorder(container, getCommit) {
  let mode = false;
  let preselected = null;
  let selected = null; // { card, snapshot: Card[] } | null

  function widgetLabel(card) {
    return WIDGET_CATALOG[card.dataset.widget]?.label || card.dataset.widget || "widget";
  }

  function positionOf(card) {
    const list = movableCards(container);
    return { index: list.indexOf(card), total: list.length };
  }

  function describeHandle(card, handle) {
    const { index, total } = positionOf(card);
    handle.setAttribute(
      "aria-label",
      `arrastar ${widgetLabel(card)}, posição ${index + 1} de ${total}.`
    );
    handle.setAttribute("aria-pressed", "false");
  }

  function focusCard(card) {
    if (!card) return;
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
  }

  function setPreselected(card) {
    if (preselected) preselected.classList.remove("kw-preselected");
    preselected = card;
    if (preselected) {
      preselected.classList.add("kw-preselected");
      focusCard(preselected);
      const { index, total } = positionOf(preselected);
      announceToScreenReader(`${widgetLabel(preselected)} pré-selecionado, posição ${index + 1} de ${total}.`);
    }
  }

  function movePreselection(direction) {
    const list = movableCards(container);
    const index = Math.max(0, list.indexOf(preselected));
    const cols = Math.max(1, currentCols(container));
    const delta = direction === "ArrowLeft" ? -1
      : direction === "ArrowRight" ? 1
      : direction === "ArrowUp" ? -cols
      : cols;
    const next = Math.max(0, Math.min(list.length - 1, index + delta));
    if (list[next] !== preselected) setPreselected(list[next]);
  }

  function enterMode() {
    const first = movableCards(container)[0];
    if (!first) return;
    mode = true;
    container.classList.add("wg-keyboard-mode");
    setPreselected(first);
    announceToScreenReader("Modo de seleção de widgets ativado. Use as setas para escolher um widget.");
  }

  function exitMode({ restore = false, silent = false } = {}) {
    if (selected && restore) {
      restoreCardOrder(container, selected.snapshot);
      restoreCardSize(selected.card, selected.sizeSnapshot);
      container.querySelectorAll(":scope > .card").forEach((card) => {
        if (card !== selected.card) placeCard(card, currentCols(container));
      });
    }
    selected?.card.classList.remove("kw-grabbed");
    preselected?.classList.remove("kw-preselected");
    selected = null;
    preselected = null;
    mode = false;
    container.classList.remove("wg-keyboard-mode");
    if (!silent) announceToScreenReader("Modo de seleção de widgets encerrado.");
  }

  function cancelIfActive({ silent = false } = {}) {
    if (mode) exitMode({ restore: Boolean(selected), silent });
  }

  function confirmSelection() {
    if (selected) {
      const card = selected.card;
      card.classList.remove("kw-grabbed");
      selected = null;
      setPreselected(card);
      getCommit(true)();
      announceToScreenReader(`${widgetLabel(card)} posição e tamanho salvos. Use as setas para escolher outro widget ou escape para sair.`);
      return;
    }
    if (preselected) {
      selected = {
        card: preselected,
        snapshot: movableCards(container),
        sizeSnapshot: {
          span: preselected.dataset.span,
          height: preselected.style.height,
          manual: preselected.dataset.manual === "1",
        },
      };
      selected.card.classList.remove("kw-preselected");
      selected.card.classList.add("kw-grabbed");
      announceToScreenReader(`${widgetLabel(selected.card)} selecionado para mover. Use as setas e enter para confirmar.`);
    }
  }

  function resizeSelected(direction) {
    const card = selected?.card;
    if (!card) return false;

    const cols = Math.max(1, currentCols(container));
    if (direction === "ArrowLeft" || direction === "ArrowRight") {
      const delta = direction === "ArrowLeft" ? -1 : 1;
      const next = Math.max(
        minScaled(card, cols),
        Math.min(maxScaled(card, cols), getScaled(card, cols) + delta)
      );
      if (next === getScaled(card, cols)) return false;
      setScaled(card, next, cols);
    } else {
      const currentHeight = card.dataset.manual === "1" && card.style.height
        ? parseInt(card.style.height, 10)
        : Math.ceil(card.getBoundingClientRect().height);
      const floor = Math.max(WG_MIN_H, contentMinHeight(card));
      const delta = direction === "ArrowUp" ? -WG_RESIZE_STEP : WG_RESIZE_STEP;
      const nextHeight = Math.max(
        snapResizeHeight(floor),
        snapResizeHeight(currentHeight + delta)
      );
      if (nextHeight === currentHeight) return false;
      card.style.height = `${nextHeight}px`;
      card.dataset.manual = "1";
    }

    placeCard(card, cols);
    container.querySelectorAll(":scope > .card").forEach((other) => {
      if (other !== card) placeCard(other, cols);
    });
    return true;
  }

  function onKeydown(e) {
    if (e.key === "?" && !isEditableTarget(e.target)) {
      e.preventDefault();
      cancelIfActive({ silent: true });
      openWidgetShortcutsModal();
      return;
    }

    if (!isEditableTarget(e.target) && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (!mode) enterMode();
      return;
    }

    if (!mode || container.classList.contains("wg-tips-locked") || isEditableTarget(e.target)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      exitMode({ restore: Boolean(selected) });
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      confirmSelection();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;

    e.preventDefault();
    if (selected) {
      if (e.shiftKey) {
        if (resizeSelected(e.key)) {
          focusCard(selected.card);
          announceToScreenReader(`${widgetLabel(selected.card)} redimensionado. Pressione Enter para salvar.`);
        }
        return;
      }
      const cols = Math.max(1, currentCols(container));
      const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -cols : cols;
      if (stepCard(container, selected.card, delta)) {
        focusCard(selected.card);
        announceToScreenReader(`${widgetLabel(selected.card)} movido.`);
      }
    } else {
      movePreselection(e.key);
    }
  }

  container.addEventListener("keydown", onKeydown);
  const onDocumentKeydown = (e) => {
    if (e.target.closest?.(".modal-backdrop.open")) return;
    if (mode && e.key === "Tab" && !isEditableTarget(e.target)) {
      e.preventDefault();
      return;
    }
    if (!isEditableTarget(e.target) && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (!mode) enterMode();
    }
  };
  document.addEventListener("keydown", onDocumentKeydown);
  return {
    describeHandle,
    cancelIfActive,
    /** Recalcula o aria-label de TODAS as alças do grid — chamado depois
     * de inserir cards no DOM em lote (render()/setWidgets()), já que
     * describeHandle() sozinho só é reacionado no foco de cada alça
     * (ver attachDragHandle) e cards recém-inseridos ainda não foram
     * focados por ninguém. */
    refreshAllLabels() {
      container.querySelectorAll(":scope > .card > .card-head > .drag-handle").forEach((h) => {
        const card = h.closest(".card");
        if (card) describeHandle(card, h);
      });
    },
    destroy() {
      cancelIfActive({ silent: true });
      container.removeEventListener("keydown", onKeydown);
      document.removeEventListener("keydown", onDocumentKeydown);
    },
  };
}

/**
 * Botão "?" de ajuda dos atalhos de teclado — inserido de preferência
 * dentro da .wg-toolbar (mesma barra do "+ adicionar widget", ver
 * dashboard.js) logo acima do grid; se essa barra não existir (algum
 * uso futuro de initGrid fora do padrão de createDashboardPage), cai
 * num botão solto logo antes do grid. Nunca é inserido DENTRO do
 * container do grid — ele é um item de CSS grid (.widget-grid,
 * display:grid) e um filho a mais ali entraria no auto-placement dos
 * widgets, empurrando/roubando espaço de um card de verdade.
 */
export function mountKeyboardHelpButton(container) {
  const parent = container.parentElement;
  if (!parent) return null;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wg-kw-help-btn";
  btn.dataset.tooltip = "atalhos de teclado (?)";
  btn.setAttribute("aria-label", "ver atalhos de teclado do grid de widgets");
  btn.innerHTML = icon("circle-help", { size: 13, title: "atalhos de teclado" });
  btn.addEventListener("click", () => openWidgetShortcutsModal());

  const toolbar = container.previousElementSibling?.classList.contains("wg-toolbar")
    ? container.previousElementSibling
    : null;

  if (toolbar) {
    toolbar.insertBefore(btn, toolbar.firstChild);
  } else {
    btn.classList.add("wg-kw-help-btn-standalone");
    parent.insertBefore(btn, container);
  }
  return btn;
}
