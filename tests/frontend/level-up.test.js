import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("asciiBanner monta LEVEL UP em 6 linhas na fonte do splash", async () => {
  const { asciiBanner } = await import("../../frontend/js/components/level-up.js");
  const rows = asciiBanner("LEVEL UP").split("\n");
  assert.equal(rows.length, 6);
  assert.ok(rows[0].startsWith("██╗"));
});

test(
  "tela de nível: foco no botão, Esc fecha e devolve o foco; sem movimento com efeitos desligados",
  withDom('<button id="antes">x</button>', async (dom) => {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    const { store } = await import("../../frontend/js/state/store.js");
    const { wireVisualEffects } = await import("../../frontend/js/components/visual-effects.js");
    const { showLevelUp } = await import("../../frontend/js/components/level-up.js");

    store.set("profile", { efeitos_visuais: "desligado" });
    wireVisualEffects();
    assert.equal(document.documentElement.dataset.effects, "desligado");

    document.querySelector("#antes").focus();
    showLevelUp({ level: 3, previousLevel: 2, totalXp: 500 });
    const overlay = document.querySelector(".level-up");
    assert.ok(overlay);
    assert.ok(!overlay.classList.contains("animated"));
    assert.equal(document.activeElement, overlay.querySelector(".level-up-close"));

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(250);
    assert.equal(document.querySelector(".level-up"), null);
    assert.equal(document.activeElement.id, "antes");

    store.set("profile", { efeitos_visuais: "completo" });
    assert.equal(document.documentElement.dataset.effects, "completo");
    delete globalThis.requestAnimationFrame;
  })
);
