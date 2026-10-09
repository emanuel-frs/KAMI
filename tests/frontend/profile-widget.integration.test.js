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
      "/api/nucleo/player": {
        level: 2, total_xp: 150, current_level_xp: 50, xp_for_next_level: 246, pct: 20,
        streak_current: 3, streak_best: 5, active_today: true,
        streak_protections: 2, streak_protections_max: 2, streak_protected_yesterday: true,
        streak_next_protection_in: 4,
        achievements_unlocked: 1, achievements_total: 2,
      },
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
  assert.match(widget.textContent, /nível\s*2/);
  assert.match(widget.textContent, /sequência\s*3 dias/);
  assert.equal(widget.querySelector(".pw-xp-bar").textContent, "[####----------------]");
  assert.match(widget.querySelector(".pw-xp-text").textContent, /20% · 50\/246 xp pro nível 3/);
  // GAM-06: chama de 3 dias (degrau 2) + proteções cheias + ontem protegido
  const flame = widget.querySelector(".pw-streak .streak-flame");
  assert.equal(flame.tagName.toLowerCase(), "svg");
  assert.equal(flame.dataset.stage, "2");
  assert.equal(widget.querySelector(".pw-protections").textContent, "[◆◆]");
  assert.match(widget.querySelector(".pw-streak").textContent, /ontem protegido/);
  assert.match(widget.querySelector(".pw-streak").textContent, /recorde 5/);
  assert.match(widget.innerHTML, /&lt;Kami&gt;/);
  assert.doesNotMatch(widget.innerHTML, /<Kami>/);
});
