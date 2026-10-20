// P-23 — aviso de layout novo (components/layout-novidade.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(dom, t, telas) {
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const chamadas = [];
  const anteriores = { nucleo: [{ widget_type: "log", width: 4, height: null, config_json: null }] };
  t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
    const path = new URL(url).pathname;
    const metodo = opts.method || "GET";
    chamadas.push(`${metodo} ${path} ${opts.body || ""}`);
    const json = (b) => ({ ok: true, status: 200, json: async () => b });
    if (path === "/api/dashboard/novidade" && metodo === "GET") return json({ versao: 2, telas });
    if (path === "/api/dashboard/novidade") {
      const aplicar = JSON.parse(opts.body).aplicar;
      return json(aplicar ? { aplicadas: telas, anteriores } : { aplicadas: [], anteriores: {} });
    }
    return json([]);
  });
  const { store } = await import("../../frontend/js/state/store.js");
  store.set("profile", { efeitos_visuais: "desligado", som_ativo: false });
  const { resetBackendConnection } = await import("../../frontend/js/api/client.js");
  resetBackendConnection();
  t.after(() => {
    resetBackendConnection();
    delete globalThis.CustomEvent;
    delete globalThis.requestAnimationFrame;
  });
  const { oferecerLayoutNovo } = await import("../../frontend/js/components/layout-novidade.js");
  let recarregou = 0;
  return { chamadas, oferecer: () => oferecerLayoutNovo({ recarregarTela: async () => recarregou++ }), recargas: () => recarregou };
}

const toast = (re) => [...document.querySelectorAll(".toast-item")].find((el) => re.test(el.textContent));
const botao = (el, nome) => [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === nome);

test(
  "sem tela diferente do padrão novo: nenhum aviso",
  withDom("<body></body>", async (dom, t) => {
    const { oferecer } = await setup(dom, t, []);
    await oferecer();
    assert.equal(toast(/layout novo/), undefined);
  })
);

test(
  "aplicar troca as telas, recarrega e o desfazer manda o layout anterior de volta",
  withDom("<body></body>", async (dom, t) => {
    const { oferecer, chamadas, recargas } = await setup(dom, t, ["nucleo", "financas"]);
    await oferecer();
    const aviso = toast(/layout novo das telas/);
    assert.match(aviso.textContent, /núcleo e finanças/);

    botao(aviso, "aplicar").click();
    await wait(260); // o toast fecha com uma animação de 200ms antes de sair do documento
    assert.ok(chamadas.some((c) => c.startsWith('POST /api/dashboard/novidade {"aplicar":true}')));
    assert.equal(recargas(), 1);
    assert.equal(toast(/layout novo das telas/), undefined); // fechou ao resolver

    botao(toast(/layout novo aplicado/), "desfazer").click();
    await wait(30);
    assert.ok(chamadas.some((c) => c.startsWith("PUT /api/dashboard/nucleo") && c.includes('"log"')));
    assert.equal(recargas(), 2);
  })
);

test(
  "agora não: dispensa sem mexer no layout",
  withDom("<body></body>", async (dom, t) => {
    const { oferecer, chamadas, recargas } = await setup(dom, t, ["nucleo"]);
    await oferecer();
    botao(toast(/layout novo das telas/), "agora não").click();
    await wait(30);
    assert.ok(chamadas.some((c) => c.startsWith('POST /api/dashboard/novidade {"aplicar":false}')));
    assert.equal(recargas(), 0);
  })
);
