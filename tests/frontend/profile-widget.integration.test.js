import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("widget de perfil renderiza o estado recebido pela API", async (t) => {
  const dom = new JSDOM('<div class="card"><div id="widget"></div></div>', {
    url: "http://localhost/",
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    getComputedStyle: globalThis.getComputedStyle,
    canvasGetContext: dom.window.HTMLCanvasElement.prototype.getContext,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    font: "",
    measureText: () => ({ width: 8 }),
  });

  t.after(() => {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previous.navigator,
    });
    globalThis.getComputedStyle = previous.getComputedStyle;
    dom.window.HTMLCanvasElement.prototype.getContext = previous.canvasGetContext;
    dom.window.close();
  });

  t.mock.method(globalThis, "fetch", async (url) => {
    const payloads = {
      "/api/perfil": { display_name: "<Kami>", avatar_ascii: "K", accent_color: "#fff" },
      "/api/nucleo/attributes": [
        { name: "Carreira", current_xp: 100 },
        { name: "Finanças", current_xp: 50 },
      ],
      "/api/nucleo/achievements": [
        { unlocked_at: "2026-09-12T10:00:00" },
        { unlocked_at: null },
      ],
    };
    const path = new URL(url).pathname;
    return {
      ok: true,
      status: 200,
      json: async () => payloads[path],
    };
  });

  const { render } = await import("../../frontend/js/widgets/profile.js");
  const widget = document.querySelector("#widget");
  await render(widget, {});

  assert.equal(widget.querySelector("b").textContent, "<Kami>");
  assert.equal(widget.querySelector("#pw-avatar-ascii").textContent, "K");
  assert.match(widget.textContent, /xp total\s*150/);
  assert.match(widget.textContent, /conquistas\s*1\/2/);
  assert.match(widget.innerHTML, /&lt;Kami&gt;/);
  assert.doesNotMatch(widget.innerHTML, /<Kami>/);
});
