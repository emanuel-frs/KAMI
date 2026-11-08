// EST-03: components/clickable-a11y.js — ligado no boot desde a 2.0 (antes
// existia mas nunca era chamado): ícones de ação feitos de <span> viram
// botões de teclado, com nome e Enter/Espaço.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const HTML = `<!doctype html><body>
  <div class="sub-row"><span class="sub-name">Streaming</span>
    <span class="sub-remove" data-tooltip="remover"><svg aria-hidden="true"></svg></span></div>
  <div id="notas-itens" role="list">
    <div class="nota-item" role="listitem" data-nt-abrir="n1"><span class="nota-item-titulo">mercado</span><span class="nota-item-data">hoje</span></div>
  </div>
  <pre class="mini-avatar mini-avatar--vazio" id="sidebar-avatar">sem avatar ainda</pre>
</body>`;

test(
  "spans clicáveis viram botões de teclado; a nota segue item de lista; avatar vazio diz o que aparece",
  withDom(HTML, async (dom) => {
    globalThis.MutationObserver = dom.window.MutationObserver;
    globalThis.Element = dom.window.Element;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    const { wireClickableA11y } = await import("../../frontend/js/components/clickable-a11y.js");
    wireClickableA11y();
    const doc = dom.window.document;

    const x = doc.querySelector(".sub-remove");
    assert.equal(x.getAttribute("role"), "button");
    assert.equal(x.tabIndex, 0);
    assert.match(x.getAttribute("aria-label"), /remover.*Streaming/);
    let cliques = 0;
    x.addEventListener("click", () => cliques++);
    x.focus();
    x.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    x.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
    assert.equal(cliques, 2);

    const item = doc.querySelector(".nota-item");
    assert.equal(item.getAttribute("role"), "listitem");
    assert.equal(doc.querySelector(".nota-item-titulo").getAttribute("role"), "button");

    assert.match(doc.querySelector("#sidebar-avatar").getAttribute("aria-label"), /^sem avatar ainda — /);

    // o que entra depois (listas refeitas por innerHTML) também ganha
    doc.querySelector(".sub-row").insertAdjacentHTML("beforeend", '<span class="sub-remove" data-tooltip="remover"><svg aria-hidden="true"></svg></span>');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(doc.querySelectorAll('.sub-remove[role="button"]').length, 2);
    await new Promise((r) => setTimeout(r, 30)); // deixa o rAF da restauração de foco rodar antes de desmontar
    delete globalThis.MutationObserver;
    delete globalThis.Element;
    delete globalThis.requestAnimationFrame;
    delete globalThis.getComputedStyle;
  })
);
