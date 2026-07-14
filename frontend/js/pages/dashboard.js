import { getLayout, saveLayout } from "../api/dashboard.js";
import { initGrid, availableToAdd } from "../widgets/grid.js";
import { WIDGET_CATALOG } from "../widgets/registry.js";

/**
 * Perfil e Núcleo são as duas únicas telas com dashboard configurável
 * (decisão 17) — compartilham exatamente o mesmo mecanismo de toolbar
 * "+ adicionar widget" + popover de catálogo + grid.js, só mudando o
 * `screen`. Em vez de duplicar isso nos dois arquivos de página, cada
 * um vira só uma chamada a createDashboardPage(screen, options).
 *
 * options.title / options.tag / options.description são opcionais —
 * quando fornecidos, renderizam o cabeçalho de página (page-head +
 * page-sub). Se omitidos (caso atual de perfil.js e nucleo.js), a tela
 * fica só com a toolbar + grid, sem cabeçalho nenhum.
 */
export function createDashboardPage(screen, options = {}) {
  const { title, tag = "v1", description } = options;
  let grid = null;
  let currentWidgets = [];
  let onDocClick = null;

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
     * Não basta injetar os widgets faltantes — precisa também GARANTIR
     * que os não-removíveis (ex: profile) fiquem sempre na frente do
     * array, mesmo quando já existiam no layout salvo (ex: usuário
     * arrastou o widget pra outra posição antes dessa regra existir,
     * ou salvou um layout antigo). O CSS (data-pinned, grid-column/row-
     * start:1 !important) só evita a sobreposição visual se o card já
     * for o primeiro no DOM — auto-placement do grid não "reserva"
     * espaço pra um item que vai ser forçado depois. Por isso a ordem
     * do array também precisa ser corrigida aqui, não só a presença.
     */
    const existingRequired = widgets.filter((w) => requiredTypes.has(w.widget_type));
    const rest = widgets.filter((w) => !requiredTypes.has(w.widget_type));
    const reordered = [...missingAsWidgets, ...existingRequired, ...rest];

    const changed =
      missing.length > 0 ||
      reordered.length !== widgets.length ||
      reordered.some((w, i) => w.widget_type !== widgets[i]?.widget_type);

    return { widgets: reordered, changed };
  }

  async function mount(container) {
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
        <button type="button" class="btn sm" id="${screen}-add-widget">+ adicionar widget</button>
        <div class="wg-catalog-pop" id="${screen}-catalog-pop"></div>
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
      pop.innerHTML = options.length
        ? `<div class="wgc-head">adicionar widget</div>${options
            .map(
              (w) => `
              <div class="wg-catalog-item" data-add="${w.type}">
                <span>${w.label}</span>${w.cross_module ? '<span class="wgc-tag">cross-module</span>' : ""}
              </div>`
            )
            .join("")}`
        : `<div class="wgc-head">adicionar widget</div><div class="wg-catalog-empty">todos os widgets disponíveis já estão na tela</div>`;
    }

    addButton.addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = !pop.classList.contains("open");
      if (opening) renderPopover();
      pop.classList.toggle("open", opening);
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
      pop.classList.remove("open");
    });

    onDocClick = (e) => {
      if (!e.target.closest(".wg-toolbar")) pop.classList.remove("open");
    };
    document.addEventListener("click", onDocClick);
  }

  function unmount() {
    grid?.destroy();
    grid = null;
    if (onDocClick) document.removeEventListener("click", onDocClick);
    onDocClick = null;
  }

  return { mount, unmount };
}