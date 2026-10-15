import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

// arquivo próprio pelo mesmo motivo de progress-watcher-missoes.test.js
// (estado de módulo do watcher e do toast)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function state(xp, log) {
  return {
    "/api/nucleo/player": {
      level: 1, total_xp: xp, current_level_xp: 0, xp_for_next_level: 1000, pct: 0,
      streak_current: 1, streak_best: 1, active_today: true, achievements_unlocked: 0, achievements_total: 0,
    },
    "/api/nucleo/attributes": [
      { name: "aprendizado", current_xp: xp, current_level: 1, is_active: true, pct: 0, xp_for_next_level: 1000 },
    ],
    "/api/nucleo/achievements": [],
    "/api/nucleo/missoes": { diarias: [], semanal: null },
    "/api/nucleo/log": log,
  };
}

const entry = (id, description, xp, source) => ({
  id, description, xp_gained: xp, source, categories: ["aprendizado"], created_at: "2026-10-09T10:00:00-03:00",
});

test(
  "bônus de xp aparecem cada um numa linha, descontados da linha da ação (GAM-08)",
  withDom("<body></body>", async (dom, t) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    t.after(() => {
      delete globalThis.CustomEvent;
      delete globalThis.requestAnimationFrame;
    });

    const old = [entry("old", "concluiu marco: a", 20, "aprendizado")];
    let current = state(100, old);
    t.mock.method(globalThis, "fetch", async (url) => {
      const path = new URL(url).pathname;
      return { ok: true, status: 200, json: async () => current[path] ?? {} };
    });

    const { startProgressWatcher } = await import("../../frontend/js/components/progress-watcher.js");
    const { put } = await import("../../frontend/js/api/client.js");
    startProgressWatcher();
    await wait(50);

    current = state(100 + 20 + 5 + 6, [
      entry("b2", "bônus · sequência de 14 dias 1,3×", 6, "bonus"),
      entry("b1", "bônus · primeira ação do dia", 5, "bonus"),
      entry("new", "concluiu marco: b", 20, "aprendizado"),
      ...old,
    ]);
    await put("/api/aprendizado/milestones/m2", { status: "concluido" });
    await wait(400);

    const lines = [...document.querySelectorAll(".xp-feed-item")].map((el) => ({
      text: el.textContent.replace(/\s+/g, " ").trim(),
      bonus: el.classList.contains("bonus"),
    }));
    assert.deepEqual(lines, [
      { text: "+20 xp· aprendizado", bonus: false },
      { text: "+5 xp· primeira ação do dia", bonus: true },
      { text: "+6 xp· sequência de 14 dias 1,3×", bonus: true },
    ]);
  })
);
