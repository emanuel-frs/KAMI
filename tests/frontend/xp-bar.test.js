import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("xpBar arredonda e limita a porcentagem", async () => {
  const { xpBar } = await import("../../frontend/js/components/xp-bar.js");
  assert.equal(xpBar(0), "[----------]");
  assert.equal(xpBar(62), "[######----]");
  assert.equal(xpBar(150), "[##########]");
  assert.equal(xpBar(50, 4), "[##--]");
});

test(
  "setXpBar preenche bloco a bloco e respeita efeitos desligados",
  withDom('<span id="b"></span>', async () => {
    const { store } = await import("../../frontend/js/state/store.js");
    const { setXpBar } = await import("../../frontend/js/components/xp-bar.js");
    const el = document.querySelector("#b");

    store.set("profile", { efeitos_visuais: "completo" });
    setXpBar(el, 50, { from: 0 });
    assert.equal(el.textContent, "[----------]");
    await wait(400);
    assert.equal(el.textContent, "[#####-----]");

    store.set("profile", { efeitos_visuais: "desligado" });
    setXpBar(el, 80, { from: 50 });
    assert.equal(el.textContent, "[########--]");
  })
);
