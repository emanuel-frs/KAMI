import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mouse(dom, type, target, relatedTarget = null) {
  target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, relatedTarget }));
}

test(
  "tooltip não pisca quando o widget é re-renderizado com o mouse em cima",
  withDom('<div id="card"><span data-tooltip="nível 3">nv 3</span></div><p id="fora">x</p>', async (dom) => {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.MouseEvent = dom.window.MouseEvent;
    const { wireTooltips } = await import("../../frontend/js/components/tooltip.js");
    wireTooltips();

    const card = document.querySelector("#card");
    mouse(dom, "mouseover", card.firstElementChild);
    await wait(20);
    const portal = document.querySelector(".tooltip-portal");
    assert.ok(portal.classList.contains("show"));

    // re-render (innerHTML): mouseout no antigo, mouseover no novo
    const seen = [];
    const observer = new dom.window.MutationObserver(() => seen.push(portal.classList.contains("show")));
    observer.observe(portal, { attributes: true, attributeFilter: ["class"] });
    const old = card.firstElementChild;
    card.innerHTML = '<span data-tooltip="nível 3">nv 3</span>';
    mouse(dom, "mouseout", old);
    mouse(dom, "mouseover", card.firstElementChild);
    await wait(150);
    observer.disconnect();
    assert.ok(portal.classList.contains("show"));
    assert.ok(!seen.includes(false), "o tooltip não deve sumir nem por um instante");

    // texto novo no mesmo lugar: atualiza sem esconder
    card.innerHTML = '<span data-tooltip="nível 4">nv 4</span>';
    mouse(dom, "mouseover", card.firstElementChild);
    assert.equal(portal.textContent, "nível 4");
    assert.ok(portal.classList.contains("show"));

    // sair de verdade esconde (depois do atraso curto)
    mouse(dom, "mouseout", card.firstElementChild, document.querySelector("#fora"));
    assert.ok(portal.classList.contains("show"));
    await wait(150);
    assert.ok(!portal.classList.contains("show"));
    delete globalThis.requestAnimationFrame;
    delete globalThis.MouseEvent;
  })
);
