// Tela com widgets desmontada no meio do carregamento (trocar o idioma
// remonta a tela): a montagem velha não pode continuar — nem reescrever o
// container da tela nova, nem chamar onReady de novo (a assinatura do
// perfil que sobrava chamava as dicas com o grid já desmontado:
// "null is not an object (evaluating 'container.querySelectorAll')").
//
// Fica em frontend-carga/ (fora da medição de cobertura): importar o
// dashboard puxa o grid inteiro, e o Node conta todo arquivo importado.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "../frontend/helpers/dom.js";

test(
  "dashboard: montagem interrompida pelo unmount não segue nem chama onReady",
  withDom(`<!doctype html><body><main id="pagina"></main></body>`, async (dom, t) => {
    const pendentes = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      const u = new URL(url);
      const json = (v) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (u.pathname.startsWith("/api/dashboard/")) {
        // o layout só responde quando o teste mandar
        return new Promise((ok) => pendentes.push(() => ok(json(u.pathname.endsWith("/padrao") ? [] : []))));
      }
      return json({});
    });
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    // o grid usa mais do DOM do que o helper põe no global
    const extras = ["MutationObserver", "HTMLElement", "Node", "getComputedStyle", "innerWidth", "innerHeight", "matchMedia"]
      .filter((k) => !(k in globalThis));
    dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    for (const k of extras) globalThis[k] = typeof dom.window[k] === "function" && k !== "HTMLElement" && k !== "Node" && k !== "MutationObserver" ? dom.window[k].bind(dom.window) : dom.window[k];
    t.after(() => {
      for (const k of extras) delete globalThis[k];
      delete globalThis.ResizeObserver;
      delete globalThis.CustomEvent;
      delete globalThis.requestAnimationFrame;
    });
    const { createDashboardPage } = await import("../../frontend/js/pages/dashboard.js");
    const container = dom.window.document.querySelector("#pagina");
    const prontos = [];
    const pagina = createDashboardPage("teste", { onReady: (grid, c) => prontos.push(c) });

    const primeira = pagina.mount(container);
    await new Promise((r) => setTimeout(r, 20));
    pagina.unmount(); // trocou o idioma: desmonta…
    const segunda = pagina.mount(container); // …e monta de novo
    await new Promise((r) => setTimeout(r, 20));
    while (pendentes.length) pendentes.shift()();
    await Promise.all([primeira, segunda]);

    assert.equal(prontos.length, 1, "só a montagem viva chama onReady");
    assert.equal(container.querySelectorAll(".wg-toolbar").length, 1);
    pagina.unmount();
  })
);
