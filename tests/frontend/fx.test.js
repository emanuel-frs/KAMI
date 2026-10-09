import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(dom, t, { mode = "completo", reduced = false } = {}) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.CustomEvent = dom.window.CustomEvent;
  dom.window.matchMedia = () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} });
  t.after(() => {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
    delete globalThis.CustomEvent;
  });
  return import("../../frontend/js/state/store.js").then(({ store }) => store.set("profile", { efeitos_visuais: mode }));
}

test(
  "fxAllows: completo libera tudo, sutil só o nível sutil, desligado e reduced-motion nada",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { fxAllows } = await import("../../frontend/js/components/fx.js");
    const { store } = await import("../../frontend/js/state/store.js");
    assert.deepEqual([fxAllows("completo"), fxAllows("sutil")], [true, true]);
    store.set("profile", { efeitos_visuais: "sutil" });
    assert.deepEqual([fxAllows("completo"), fxAllows("sutil")], [false, true]);
    store.set("profile", { efeitos_visuais: "desligado" });
    assert.deepEqual([fxAllows("completo"), fxAllows("sutil")], [false, false]);
    store.set("profile", { efeitos_visuais: "completo" });
    dom.window.matchMedia = () => ({ matches: true });
    assert.deepEqual([fxAllows("completo"), fxAllows("sutil")], [false, false]);
  })
);

test(
  "texto digitado chega no texto completo em até ~300 ms; pular termina na hora",
  withDom('<div id="a"></div><div id="b"></div>', async (dom, t) => {
    await setup(dom, t);
    const { typeText, skipEffects } = await import("../../frontend/js/components/fx.js");
    const a = document.querySelector("#a");
    typeText(a, "conquistas — galeria");
    assert.equal(a.textContent, "");
    await wait(350);
    assert.equal(a.textContent, "conquistas — galeria");

    const b = document.querySelector("#b");
    typeText(b, "missões do dia");
    skipEffects();
    assert.equal(b.textContent, "missões do dia");
  })
);

test(
  "títulos dos cards são digitados sem perder o resto do cabeçalho",
  withDom('<div id="root"><div class="card"><div class="card-head">log recente<button>x</button></div></div></div>', async (dom, t) => {
    await setup(dom, t);
    const { typeCardTitles } = await import("../../frontend/js/components/fx.js");
    const head = document.querySelector(".card-head");
    typeCardTitles(document.querySelector("#root"));
    await wait(350);
    assert.equal(head.textContent, "log recentex");
    assert.ok(head.querySelector("button"));
  })
);

test(
  "números rolam do valor anterior até o novo (e não animam na 1ª vez nem com efeitos desligados)",
  withDom('<span id="n"></span>', async (dom, t) => {
    await setup(dom, t);
    const { rollNumber } = await import("../../frontend/js/components/fx.js");
    const { store } = await import("../../frontend/js/state/store.js");
    const n = document.querySelector("#n");
    rollNumber(n, 100, { key: "k" });
    assert.equal(n.textContent, "100");
    rollNumber(n, 200, { key: "k" });
    await wait(120);
    const mid = Number(n.textContent);
    assert.ok(mid > 100 && mid < 200, `deveria estar no meio: ${mid}`);
    await wait(500);
    assert.equal(n.textContent, "200");

    store.set("profile", { efeitos_visuais: "desligado" });
    rollNumber(n, 300, { key: "k" });
    assert.equal(n.textContent, "300");
  })
);

test(
  "entrada de tela: cards ganham o liga-CRT escalonado só com efeitos completo",
  withDom('<main id="p"><div class="card"></div><div class="card"></div></main>', async (dom, t) => {
    await setup(dom, t, { mode: "sutil" });
    const { pageEnter } = await import("../../frontend/js/components/fx.js");
    const root = document.querySelector("#p");
    pageEnter(root);
    assert.equal(root.querySelectorAll(".fx-crt").length, 0);

    const { store } = await import("../../frontend/js/state/store.js");
    store.set("profile", { efeitos_visuais: "completo" });
    pageEnter(root);
    const cards = root.querySelectorAll(".card.fx-crt");
    assert.equal(cards.length, 2);
    assert.equal(cards[1].style.getPropertyValue("--fx-delay"), "35ms");
    assert.equal(document.querySelectorAll(".fx-scan").length, 0); // varredura da tela inteira saiu no teste
    await wait(950);
    assert.equal(root.querySelectorAll(".fx-crt").length, 0);
  })
);
