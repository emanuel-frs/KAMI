// ICO-01 — ícone do app na cor de destaque (components/icone-tema.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(dom, t, { jaAplicou = false } = {}) {
  globalThis.localStorage = dom.window.localStorage;
  if (jaAplicou) localStorage.setItem("kami:icone-tema-aplicado", "1");
  const chamadas = [];
  dom.window.__TAURI__ = { core: { invoke: async (cmd, args) => { chamadas.push([cmd, args.cor]); return ["janela"]; } } };
  const { store } = await import("../../frontend/js/state/store.js");
  const mod = await import("../../frontend/js/components/icone-tema.js");
  mod._resetIconeTemaForTests();
  t.after(() => delete globalThis.localStorage);
  return { store, mod, chamadas };
}

test(
  "desligado e nunca ligado: não chama o Rust (nada a desfazer)",
  withDom("<body></body>", async (dom, t) => {
    const { store, mod, chamadas } = await setup(dom, t);
    store.set("profile", { accent_color: "#e08fa0", icone_tema: false });
    mod.wireIconeTema();
    await wait(10);
    assert.deepEqual(chamadas, []);
  })
);

test(
  "ligado: aplica a cor; trocar a cor reaplica; desligar volta o padrão",
  withDom("<body></body>", async (dom, t) => {
    const { store, mod, chamadas } = await setup(dom, t);
    store.set("profile", { accent_color: "#e08fa0", icone_tema: true });
    mod.wireIconeTema();
    await wait(10);
    store.set("profile", { accent_color: "#5ac8c8", icone_tema: true });
    await wait(10);
    store.set("profile", { accent_color: "#5ac8c8", icone_tema: true, display_name: "x" }); // nada muda no ícone
    await wait(10);
    store.set("profile", { accent_color: "#5ac8c8", icone_tema: false });
    await wait(10);
    assert.deepEqual(chamadas, [
      ["aplicar_icone_tema", "coral"],
      ["aplicar_icone_tema", "turquesa"],
      ["aplicar_icone_tema", null],
    ]);
  })
);

test(
  "desligado mas ligado numa execução anterior: desfaz na abertura",
  withDom("<body></body>", async (dom, t) => {
    const { store, mod, chamadas } = await setup(dom, t, { jaAplicou: true });
    store.set("profile", { accent_color: "#e08fa0", icone_tema: false });
    mod.wireIconeTema();
    await wait(10);
    assert.deepEqual(chamadas, [["aplicar_icone_tema", null]]);
    assert.equal(localStorage.getItem("kami:icone-tema-aplicado"), null);
  })
);
