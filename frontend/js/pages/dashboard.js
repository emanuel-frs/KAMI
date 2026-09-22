import { getLayout, saveLayout } from "../api/dashboard.js";
import { initGrid, availableToAdd } from "../widgets/grid.js";
import { WIDGET_CATALOG, loadWidgetCatalog } from "../widgets/registry.js";
import { registerScreenShortcuts, clearScreenShortcuts } from "../components/shortcuts.js";
import { announce } from "../components/a11y.js";

/**
 * Nome da tela como aparece em "nesta tela — …" no Alt+H (o `screen` é a
 * chave técnica, sem acento).
 */
const SCREEN_LABELS = {
  perfil: "perfil",
  nucleo: "núcleo",
  financas: "finanças",
  carreira: "carreira",
};

/**
 * Dicas do modo de teclado do grid de widgets (widgets/grid.js) pro
 * Alt+H. São só informativas — não é Alt+tecla, o Ctrl+D e as setas já
 * funcionam dentro do próprio grid — então entram como `hints`, não
 * como `actions` (ver components/shortcuts.js). Ficam aqui, e não em
 * cada página, porque o grid é o mesmo nas telas que usam
 * createDashboardPage: registrar num lugar só cobre todas e evita que
 * a lista fique diferente de uma tela pra outra.
 *
 * Se o comportamento de teclado em grid.js mudar (createKeyboardReorder),
 * atualizar também esta lista e modals/widget-shortcuts-modal.js.
 */
const GRID_KEYBOARD_HINTS = [
  { combos: [["Ctrl", "D"]], label: "entrar no modo de seleção de widgets" },
  { combos: [["←"], ["→"], ["↑"], ["↓"]], label: "escolher ou mover o widget" },
  { combos: [["Enter"]], label: "selecionar o widget · de novo: salvar" },
  { combos: [["Shift", "←"], ["Shift", "→"]], label: "ajustar a largura" },
  { combos: [["Shift", "↑"], ["Shift", "↓"]], label: "ajustar a altura" },
  { combos: [["Esc"]], label: "sair do modo (cancela o que não foi salvo)" },
  { combos: [["?"]], label: "explicação completa do modo de teclado" },
];

/**
 * Perfil, Núcleo e Finanças são as três telas com dashboard configurável
 * (decisão 17) — compartilham exatamente o mesmo mecanismo de toolbar
 * "+ adicionar widget" + popover de catálogo + grid.js, só mudando o
 * `screen`. Em vez de duplicar isso nos três arquivos de página, cada
 * um vira só uma chamada a createDashboardPage(screen, options).
 *
 * options.title / options.tag / options.description são opcionais —
 * quando fornecidos, renderizam o cabeçalho de página (page-head +
 * page-sub). Se omitidos (caso atual de perfil.js e nucleo.js), a tela
 * fica só com a toolbar + grid, sem cabeçalho nenhum.
 */
export function createDashboardPage(screen, options = {}) {
  const { title, tag = "v1", description, onReady } = options;
  let grid = null;
  let currentWidgets = [];
  let onDocClick = null;
  let shortcutsToken = null;
  let openCatalog = null; // abre o popover "+ adicionar widget" (Alt+N); só existe com a tela montada

  /**
   * Widgets com removable:false pro `screen` atual precisam SEMPRE
   * estar presentes — ex: o widget "profile" na tela perfil. Como
   * getLayout() só devolve o que já foi salvo, uma tela nova (ou
   * zerada) chega aqui sem eles e a tela fica vazia. Aqui a gente
   * garante que entrem na lista antes do primeiro render, e persiste
   * de volta pra não repetir essa injeção toda hora.
   */
  function withRequiredWidgets(widgets) {
    const required = Object.entries(WIDGET_CATALOG)
      .filter(([, def]) => def.screens.includes(screen) && def.removable === false)
      .map(([type, def]) => ({ type, def }));
    const requiredTypes = new Set(required.map((r) => r.type));

    const missing = required.filter(
      ({ type }) => !widgets.some((w) => w.widget_type === type)
    );
    const missingAsWidgets = missing.map(({ type, def }) => ({
      widget_type: type,
      width: def.default_span,
      height: null,
      config_json: null,
    }));

    /**
     * Widgets "pinned" (hoje: só profile) precisam ficar SEMPRE na frente
     * do array, mesmo quando já existiam no layout salvo — o CSS
     * (data-pinned, grid-column/row-start:1 !important) só evita a
     * sobreposição visual se o card já for o primeiro no DOM (ver
     * grid.js). Widgets apenas obrigatórios (removable:false) mas NÃO
     * pinned — ex: carreira_perfil, que é obrigatório mas deliberadamente
     * arrastável (ver carreira-perfil.js) — não entram nessa reordenação:
     * forçá-los pro início aqui desfazia o reorder salvo pelo usuário a
     * cada vez que a tela era montada (o bug reportado — tamanho salvava,
     * posição não). Esses só precisam estar PRESENTES; sua posição vem
     * do layout salvo como qualquer outro widget.
     */
    const pinnedTypes = new Set(
      required.filter(({ def }) => def.pinned).map((r) => r.type)
    );
    const pinnedMissing = missingAsWidgets.filter((w) => pinnedTypes.has(w.widget_type));
    const otherMissing = missingAsWidgets.filter((w) => !pinnedTypes.has(w.widget_type));
    const pinnedExisting = widgets.filter((w) => pinnedTypes.has(w.widget_type));
    const rest = widgets.filter((w) => !pinnedTypes.has(w.widget_type));
    const reordered = [...pinnedMissing, ...pinnedExisting, ...otherMissing, ...rest];

    const changed =
      missing.length > 0 ||
      reordered.length !== widgets.length ||
      reordered.some((w, i) => w.widget_type !== widgets[i]?.widget_type);

    return { widgets: reordered, changed };
  }

  async function mount(container) {
    // Registrado ANTES do primeiro await de propósito: as dicas são
    // estáticas (não dependem do grid já montado) e, se ficassem depois
    // do await, uma navegação rápida poderia rodar o unmount() desta
    // tela antes do registro — e o registro tardio sobrescreveria o da
    // tela nova (clearScreenShortcuts só limpa o token que ainda é o atual).
    shortcutsToken = registerScreenShortcuts({
      name: SCREEN_LABELS[screen] || screen,
      actions: [
        // "N" de "novo", mesma tecla de "nova trilha" em aprendizado.
        // `when`: só vale depois que o botão existe (o mount é assíncrono).
        { code: "KeyN", label: "adicionar widget (abre a lista)", run: () => openCatalog?.(), when: () => !!openCatalog },
      ],
      hints: GRID_KEYBOARD_HINTS,
    });

    // precisa estar resolvido antes de qualquer leitura de WIDGET_CATALOG
    // abaixo (withRequiredWidgets, initGrid, popover) — cacheado em
    // registry.js, então navegar entre perfil/núcleo/finanças não refaz
    // a requisição depois da primeira vez
    await loadWidgetCatalog();

    const headHtml = title
      ? `
        <div class="page-head">
          <h1>${title}</h1>
          <span class="tag-v1">${tag}</span>
        </div>
        ${description ? `<p class="page-sub">${description}</p>` : ""}
        <hr class="rule">
      `
      : "";

    container.innerHTML = `
      ${headHtml}
      <div class="wg-toolbar">
        <button type="button" class="btn sm" id="${screen}-add-widget"
          aria-expanded="false" aria-controls="${screen}-catalog-pop" aria-keyshortcuts="Alt+N"
          data-tooltip="adicionar widget (Alt+N)">+ adicionar widget</button>
        <div class="wg-catalog-pop" id="${screen}-catalog-pop" role="group" aria-label="widgets disponíveis"></div>
      </div>
      <div id="${screen}-grid"></div>
    `;

    const gridEl = container.querySelector(`#${screen}-grid`);
    const addButton = container.querySelector(`#${screen}-add-widget`);
    const pop = container.querySelector(`#${screen}-catalog-pop`);

    const loaded = await getLayout(screen);
    const { widgets: withRequired, changed } = withRequiredWidgets(loaded);
    currentWidgets = withRequired;
    if (changed) saveLayout(screen, currentWidgets);

    grid = initGrid(gridEl, {
      screen,
      widgets: currentWidgets,
      onLayoutChange: (widgets) => {
        currentWidgets = widgets; // mantém a cópia local em sync (ex: depois de um remove)
        saveLayout(screen, widgets);
      },
    });

    function renderPopover() {
      const options = availableToAdd(screen, currentWidgets);
      // <button> (não <div>): entra na ordem de Tab e Enter/Espaço ativam
      // sem nenhum código extra — antes só o clique do mouse funcionava.
      pop.innerHTML = options.length
        ? `<div class="wgc-head">adicionar widget</div>${options
            .map(
              (w) => `
              <button type="button" class="wg-catalog-item" data-add="${w.type}">
                <span>${w.label}</span>${w.cross_module ? '<span class="wgc-tag">cross-module</span>' : ""}
              </button>`
            )
            .join("")}`
        : `<div class="wgc-head">adicionar widget</div><div class="wg-catalog-empty" tabindex="-1">todos os widgets disponíveis já estão na tela</div>`;
    }

    const popItems = () => [...pop.querySelectorAll(".wg-catalog-item")];
    const isPopOpen = () => pop.classList.contains("open");

    function openPop() {
      renderPopover();
      pop.classList.add("open");
      addButton.setAttribute("aria-expanded", "true");
      // o foco vai pro primeiro item (ou pro aviso de "lista vazia", que
      // assim é lido pelo leitor de tela) — sem isso quem usa teclado abria
      // a lista e o Tab seguia pro resto da página, sem entrar nela.
      (popItems()[0] || pop.querySelector(".wg-catalog-empty"))?.focus();
    }

    function closePop({ returnFocus = false } = {}) {
      if (!isPopOpen()) return;
      pop.classList.remove("open");
      addButton.setAttribute("aria-expanded", "false");
      if (returnFocus) addButton.focus();
    }

    openCatalog = openPop;

    addButton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isPopOpen()) closePop();
      else openPop();
    });

    addButton.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowDown" && !isPopOpen()) {
        e.preventDefault();
        openPop();
      } else if (e.key === "Escape" && isPopOpen()) {
        e.preventDefault();
        e.stopPropagation(); // o Esc é só do popover, não fecha modal/dicas por baixo
        closePop();
      }
    });

    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePop({ returnFocus: true });
        return;
      }
      // Tab sai da lista: fecha e deixa o foco seguir o caminho normal
      // (não usa focusout: no WebKit um botão clicado com o mouse pode não
      // receber foco, e fechar no blur engoliria o clique no item).
      if (e.key === "Tab") {
        closePop();
        return;
      }
      const items = popItems();
      const i = items.indexOf(document.activeElement);
      if (i === -1) return;
      let next = null;
      if (e.key === "ArrowDown") next = items[(i + 1) % items.length];
      else if (e.key === "ArrowUp") next = items[(i - 1 + items.length) % items.length];
      else if (e.key === "Home") next = items[0];
      else if (e.key === "End") next = items[items.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    });

    pop.addEventListener("click", (e) => {
      const item = e.target.closest("[data-add]");
      if (!item) return;
      const catalogEntry = WIDGET_CATALOG[item.dataset.add];
      currentWidgets = [
        ...currentWidgets,
        { widget_type: item.dataset.add, width: catalogEntry.default_span, height: null, config_json: null },
      ];
      grid.setWidgets(currentWidgets);
      saveLayout(screen, currentWidgets);
      // o item clicado some junto com a lista — devolve o foco pro botão
      // (senão cai no <body>) e conta pro leitor de tela o que aconteceu.
      closePop({ returnFocus: true });
      announce(`${catalogEntry.label} adicionado à tela.`);
    });

    onDocClick = (e) => {
      if (!e.target.closest(".wg-toolbar")) closePop();
    };
    document.addEventListener("click", onDocClick);

    // hook opcional pra quem envolve createDashboardPage e precisa do
    // grid já montado (hoje só nucleo.js, pra etapa 5 do onboarding —
    // dicas contextuais); perfil.js não passa isso e nada muda pra ele
    onReady?.(grid, container);
  }

  function unmount() {
    clearScreenShortcuts(shortcutsToken);
    shortcutsToken = null;
    openCatalog = null;
    grid?.destroy();
    grid = null;
    if (onDocClick) document.removeEventListener("click", onDocClick);
    onDocClick = null;
  }

  return { mount, unmount };
}