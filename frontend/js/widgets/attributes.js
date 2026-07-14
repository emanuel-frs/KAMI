// js/widgets/attributes.js
import { getAttributes } from "../api/nucleo.js";
import { escapeHtml } from "./format.js";

/** Barras de nível por atributo — clicar filtra o widget log.js (evento global). */
export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando atributos…</div>';
  let attributes;
  try {
    attributes = await getAttributes();
  } catch (err) {
    el.innerHTML = `<div class="empty-state">erro ao carregar atributos: ${err.message}</div>`;
    return;
  }

  let activeFilter = "all";

  function draw() {
    const allRow = `
      <div class="attr-row${activeFilter === "all" ? " on" : ""}" data-filter="all">
        <span class="label">todos</span>
        <div class="bar-track"><div class="bar-fill" style="width:100%"></div></div>
        <b>—</b>
      </div>`;
    const rows = attributes
      .map(
        (a) => `
      <div class="attr-row${activeFilter === a.name ? " on" : ""}" data-filter="${a.name}">
        <span class="label">${escapeHtml(a.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${a.pct}%"></div></div>
        <b>lvl ${a.current_level}</b>
      </div>`
      )
      .join("");
    el.innerHTML = allRow + rows;
  }

  draw();

  el.addEventListener("click", (e) => {
    const row = e.target.closest("[data-filter]");
    if (!row) return;
    activeFilter = row.dataset.filter;
    draw();
    window.dispatchEvent(
      new CustomEvent("kami:nucleo-filter", { detail: { attribute: activeFilter } })
    );
  });

  // atualiza níveis/pct quando uma ação é registrada em outro widget da tela
  window.addEventListener("kami:action-registered", async () => {
    try {
      attributes = await getAttributes();
      draw();
    } catch {
      /* silencioso — próxima ação ou reload manual resolve */
    }
  });
}