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
  "cor e tema ficam lembrados pra pintar a tela do PIN antes do perfil chegar (SEG-02)",
  withDom("<body></body>", async (dom, t) => {
    globalThis.localStorage = dom.window.localStorage;
    t.after(() => delete globalThis.localStorage);
    const { store } = await import("../../frontend/js/state/store.js");
    const { wireTheme, restaurarAparencia } = await import("../../frontend/js/components/tema.js");
    wireTheme();
    store.set("profile", { accent_color: "#ff8800", tema: "ambar" });

    // "próxima abertura": documento limpo, perfil ainda não carregou
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.tema;
    restaurarAparencia();
    assert.equal(document.documentElement.style.getPropertyValue("--accent"), "#ff8800");
    assert.equal(document.documentElement.dataset.tema, "ambar");

    // valor estranho guardado não vira CSS
    localStorage.setItem("kami:aparencia", JSON.stringify({ accent: "red; background:url(x)", tema: "<script>" }));
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.tema;
    restaurarAparencia();
    assert.equal(document.documentElement.style.getPropertyValue("--accent"), "");
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
