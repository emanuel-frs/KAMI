import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

// arquivo próprio (e não dentro de progress-watcher.test.js): o watcher e o
// toast guardam estado de módulo (foto anterior, pilha de toasts presa ao
// DOM do primeiro teste) — cada arquivo roda num processo novo.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot(xp) {
  return {
    "/api/nucleo/player": {
      level: 1, total_xp: xp, current_level_xp: 0, xp_for_next_level: 100, pct: 0,
      streak_current: 1, streak_best: 1, active_today: true, achievements_unlocked: 0, achievements_total: 0,
    },
    "/api/nucleo/attributes": [
      { name: "organizacao", current_xp: xp, current_level: 1, is_active: true, pct: 0, xp_for_next_level: 100 },
    ],
    "/api/nucleo/achievements": [],
  };
}

test(
  "progress-watcher avisa missão concluída e missão desfeita (GAM-07)",
  withDom("<body></body>", async (dom, t) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    t.after(() => {
      delete globalThis.CustomEvent;
      delete globalThis.requestAnimationFrame;
    });

    const mission = (concluida) => ({
      hoje: "2026-10-09", semana_inicio: "2026-10-05", semana_fim: "2026-10-11",
      diarias: [{ id: "m1", tipo: "link", titulo: "salve um link", atributo: "organizacao",
                  xp_bonus: 10, progresso: concluida ? 1 : 0, quantidade: 1, concluida }],
      semanal: null,
    });
    let state = { ...snapshot(0), "/api/nucleo/missoes": mission(false) };
    t.mock.method(globalThis, "fetch", async (url) => {
      const path = new URL(url).pathname;
      return { ok: true, status: 200, json: async () => state[path] ?? {} };
    });

    const { startProgressWatcher } = await import("../../frontend/js/components/progress-watcher.js");
    const { post, del } = await import("../../frontend/js/api/client.js");
    startProgressWatcher();
    await wait(50);

    state = { ...snapshot(12), "/api/nucleo/missoes": mission(true) };
    await post("/api/organizacao/links", {});
    await wait(400);
    // GAM-15: aviso "estilo Steam" em tamanho menor
    const popup = document.querySelector(".ach-pop.small");
    assert.ok(popup, "aviso de missão concluída deveria aparecer");
    assert.equal(popup.querySelector(".sr-only").textContent, "missão concluída: salve um link. +10 xp");

    state = { ...snapshot(0), "/api/nucleo/missoes": mission(false) };
    await del("/api/organizacao/links/1");
    await wait(400);
    const lines = [...document.querySelectorAll(".xp-feed-item.neg")].map((el) => el.textContent);
    assert.ok(lines.some((l) => l.includes("missão desfeita") && l.includes("salve um link")));
  })
);
