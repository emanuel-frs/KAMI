/**
 * Grid de widgets — arrastar (alça de mover) e redimensionar (alça do
 * canto) com o mouse.
 * MAN-02: saiu de widgets/grid.js, que continua com as medidas, o encaixe
 * na tela e o initGrid.
 */
import { icon } from "../components/icons.js";
import {
  WG_GAP,
  WG_MIN_H,
  snapResizeHeight,
  packCards,
  currentCols,
  getScaled,
  setScaled,
  contentMinHeight,
  minScaled,
  maxScaled,
  placeCard,
} from "./grid.js";

/**
 * Handle de resize (⋰, canto inferior direito) — largura em frações da
 * linha (ajusta os vizinhos da mesma linha pra não estourar), altura livre
 * com mínimo garantido. Persiste a nova largura via onLayoutChange ao soltar.
 */
export function attachResizeHandle(card, container, getCommit, pauseObservers, resumeObservers) {
  if (card.querySelector(":scope > .resize-handle")) return;

  const badge = document.createElement("div");
  badge.className = "wg-size-badge";
  card.appendChild(badge);

  const handle = document.createElement("div");
  handle.className = "resize-handle";
  handle.dataset.tooltip =
    "arraste pra redimensionar";
  handle.innerHTML = icon("resize", { size: 12, title: "redimensionar widget" });
  card.appendChild(handle);

  const reset = document.createElement("div");
  reset.className = "resize-reset";
  reset.dataset.tooltip = "voltar ao tamanho automático";
  reset.innerHTML = icon("undo", { size: 11, title: "voltar ao tamanho automático" });
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
      const newH = snapResizeHeight(Math.max(floor, startH + dy));
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
      // sem faixas durante o resize manual: o card mostra a altura que a
      // pessoa está escolhendo, não a alinhada
      packCards(container, cols, { alinhar: false });
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
 * Handle de drag (ícone "grip", no card-head) — arrasta o card inteiro pra
 * reordenar dentro do grid, usando um placeholder que segue o cursor entre
 * os cards vizinhos. Persiste a nova ordem via onLayoutChange ao soltar.
 */
export function attachDragHandle(card, container, getCommit, pauseObservers, resumeObservers, kw) {
  const head = card.querySelector(":scope > .card-head");
  if (!head || head.querySelector(":scope > .drag-handle")) return;

  // <button> (não <span>) — precisa entrar na ordem de Tab e receber
  // Enter/Espaço pra viabilizar a reordenação por teclado (ver kw.* /
  // createKeyboardReorder() em initGrid). O reset visual de botão
  // nativo (fundo/borda/padding) fica em card-base.css .drag-handle.
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "drag-handle";
  handle.tabIndex = -1;
  handle.dataset.tooltip = "arraste pra reordenar";
  handle.innerHTML = icon("grip", { size: 12, title: "arraste pra reordenar" });
  handle.setAttribute("aria-pressed", "false");
  head.insertBefore(handle, head.firstChild);

  // aria-label com a posição atual só é calculado quando a alça
  // recebe foco (em vez de mantido sempre atualizado) — mais barato, e
  // é exatamente o momento em que um leitor de tela precisa da
  // informação; kw.describeHandle() sabe a posição/total atuais na
  // hora porque lê o DOM ao vivo.
  handle.addEventListener("focus", () => kw?.describeHandle(card, handle));

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    // se havia uma reordenação por teclado pendente (em outro card,
    // ou neste mesmo), o mouse assume — cancela sem persistir, mesma
    // semântica do Esc.
    kw?.cancelIfActive({ silent: true });
    pauseObservers();
    document.body.classList.add("kami-dragging");
    card.classList.add("dragging-card");

    const rect = card.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = "wg-placeholder";
    placeholder.dataset.scaled = card.dataset.scaled || "";
    placeholder.dataset.rows = card.dataset.rows || "";
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
        const ref = before ? target.previousElementSibling : target.nextElementSibling;
        if (ref !== placeholder) {
          target[before ? "before" : "after"](placeholder);
          // a posição é calculada pelo Kami (packLayout), não pelo navegador:
          // reempacota pra prévia mostrar onde o card vai cair
          packCards(container, currentCols(container));
        }
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
