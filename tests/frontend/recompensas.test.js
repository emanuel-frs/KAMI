import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

test(
  "aparência (2.1.0) vai pro <html>: cores calculadas, textura e onde ela aparece",
  withDom("<body></body>", async () => {
    const { store } = await import("../../frontend/js/state/store.js");
    const { wireTheme } = await import("../../frontend/js/components/tema.js");
    wireTheme();
    const root = document.documentElement;
    store.set("profile", { accent_color: "#8fbf8f", aparencia: { textura: "crt", textura_lugares: { tela: true, menu: false, componentes: true } } });
    assert.equal(root.dataset.textura, "crt");
    assert.ok("txTela" in root.dataset && "txComp" in root.dataset);
    assert.ok(!("txMenu" in root.dataset));
    assert.equal(root.style.getPropertyValue("--bg"), "#000000");
    assert.match(root.style.getPropertyValue("--kami-textura"), /^url\("data:image\/svg\+xml,/);
    // o tema "âmbar" de antes é uma paleta; sem textura, nenhum lugar ligado
    store.set("profile", { accent_color: "#8fbf8f", aparencia: { paleta: "ambar", textura: "nenhuma" } });
    assert.equal(root.style.getPropertyValue("--bg"), "#080603");
    assert.equal(root.dataset.textura, "nenhuma");
    assert.ok(!("txTela" in root.dataset));
    // o filtro do avatar foi criado e acompanha a cor
    assert.ok(document.getElementById("kami-avatar-cores-matriz"));
  })
);

test(
  "a aparência fica lembrada pra pintar a tela do PIN antes do perfil chegar (SEG-02)",
  withDom("<body></body>", async (dom, t) => {
    globalThis.localStorage = dom.window.localStorage;
    t.after(() => delete globalThis.localStorage);
    const { store } = await import("../../frontend/js/state/store.js");
    const { wireTheme, restaurarAparencia } = await import("../../frontend/js/components/tema.js");
    const root = document.documentElement;
    wireTheme();
    store.set("profile", { accent_color: "#ff8800", aparencia: { paleta: "ambar", textura: "grade" } });

    // "próxima abertura": documento limpo, perfil ainda não carregou
    root.removeAttribute("style");
    delete root.dataset.textura;
    restaurarAparencia();
    assert.equal(root.style.getPropertyValue("--accent"), "#ff8800");
    assert.equal(root.style.getPropertyValue("--bg"), "#080603");
    assert.equal(root.dataset.textura, "grade");

    // cache de antes da 2.1.0 ({accent, tema}) ainda funciona
    localStorage.setItem("kami:aparencia", JSON.stringify({ accent: "#c9a0dc", tema: "ambar" }));
    root.removeAttribute("style");
    restaurarAparencia();
    assert.equal(root.style.getPropertyValue("--accent"), "#c9a0dc");
    assert.equal(root.style.getPropertyValue("--bg"), "#080603");

    // valor estranho guardado não vira CSS
    localStorage.setItem("kami:aparencia", JSON.stringify({
      vars: { "--accent": "red; background:url(x)", "--bg": "#123456", "x;y": "#000000" },
      dados: { textura: "<script>", txTela: "sim" },
      avatar: "1; drop table",
    }));
    root.removeAttribute("style");
    restaurarAparencia();
    assert.equal(root.style.getPropertyValue("--accent"), "");
    assert.equal(root.style.getPropertyValue("--bg"), "#123456");
    assert.equal(root.dataset.textura, "scanline");
    assert.ok(!("txTela" in root.dataset));
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
