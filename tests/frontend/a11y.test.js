import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

test(
  "prefersReducedMotion espelha matchMedia(prefers-reduced-motion: reduce)",
  withDom("<div></div>", async (dom) => {
    const { prefersReducedMotion } = await import("../../frontend/js/components/a11y.js?motion");

    let queried = null;
    dom.window.matchMedia = (query) => {
      queried = query;
      return { matches: true };
    };
    assert.equal(prefersReducedMotion(), true);
    assert.equal(queried, "(prefers-reduced-motion: reduce)");

    dom.window.matchMedia = () => ({ matches: false });
    assert.equal(prefersReducedMotion(), false);
  })
);

test(
  "makeFocusable expõe role/tabindex/aria-label e ativa por Enter/Espaço",
  withDom("<span id=\"el\"></span>", async (t) => {
    const { makeFocusable } = await import("../../frontend/js/components/a11y.js?focusable");

    assert.equal(makeFocusable(null), null);

    const el = document.getElementById("el");
    let activations = 0;
    makeFocusable(el, { label: "editar item", onActivate: () => activations++ });

    assert.equal(el.getAttribute("role"), "button");
    assert.equal(el.getAttribute("tabindex"), "0");
    assert.equal(el.getAttribute("aria-label"), "editar item");

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    assert.equal(activations, 2, "só Enter/Espaço sem modificador devem ativar");
  })
);

test(
  "makeFocusable respeita role customizado, aria-expanded e ignora eventos vindos de um filho",
  withDom("<div id=\"parent\"><span id=\"child\"></span></div>", async () => {
    const { makeFocusable } = await import("../../frontend/js/components/a11y.js?focusable2");

    const parent = document.getElementById("parent");
    const child = document.getElementById("child");
    let activations = 0;
    makeFocusable(parent, { role: "option", expanded: true, onActivate: () => activations++ });

    assert.equal(parent.getAttribute("role"), "option");
    assert.equal(parent.getAttribute("aria-expanded"), "true");

    child.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(activations, 0, "evento disparado por um filho não deve ativar o pai");
  })
);

test(
  "makeFocusable cai pra .click() no elemento quando onActivate não é passado",
  withDom("<span id=\"el\"></span>", async () => {
    const { makeFocusable } = await import("../../frontend/js/components/a11y.js?focusable3");

    const el = document.getElementById("el");
    let clicked = false;
    el.addEventListener("click", () => (clicked = true));
    makeFocusable(el);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(clicked, true);
  })
);

test(
  "announce cria a região aria-live sob demanda e escreve o texto após o delay",
  withDom("<body></body>", async (dom, t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { announce } = await import("../../frontend/js/components/a11y.js?announce");

    announce("trilha movida para a posição 2 de 5");
    const region = document.getElementById("kami-announcer");
    assert.ok(region, "região aria-live deveria existir");
    assert.equal(region.getAttribute("aria-live"), "polite");
    assert.equal(region.getAttribute("role"), "status");
    // texto é limpo antes e só aplicado depois do setTimeout
    assert.equal(region.textContent, "");

    t.mock.timers.tick(30);
    assert.equal(region.textContent, "trilha movida para a posição 2 de 5");
  })
);
