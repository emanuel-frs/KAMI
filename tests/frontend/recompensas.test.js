import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

test(
  "tema de terminal (GAM-10) vira <html data-tema> e some no padrão",
  withDom("<body></body>", async () => {
    const { store } = await import("../../frontend/js/state/store.js");
    const { wireTheme } = await import("../../frontend/js/components/tema.js");
    wireTheme();
    assert.equal(document.documentElement.dataset.tema, undefined);
    store.set("profile", { tema: "crt" });
    assert.equal(document.documentElement.dataset.tema, "crt");
    store.set("profile", { tema: "padrao" });
    assert.equal(document.documentElement.dataset.tema, undefined);
    store.set("profile", { tema: "<script>" }); // valor desconhecido não entra
    assert.equal(document.documentElement.dataset.tema, undefined);
  })
);

test(
  "LEVEL UP mostra o que a subida desbloqueou",
  withDom("<body></body>", async (dom, t) => {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    t.after(() => delete globalThis.requestAnimationFrame);
    const { showLevelUp } = await import("../../frontend/js/components/level-up.js");
    const dismiss = showLevelUp({ level: 5, previousLevel: 4, totalXp: 900, unlocked: ['título "aprendiz"', "tema fósforo"] });
    assert.match(document.querySelector(".level-up-unlocked").textContent, /desbloqueado: título "aprendiz" · tema fósforo/);
    dismiss();
  })
);
