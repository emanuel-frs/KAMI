import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot({ xp, level, playerLevel, unlocked }) {
  return {
    "/api/nucleo/player": {
      level: playerLevel, total_xp: xp, current_level_xp: 0, xp_for_next_level: 100, pct: 0,
      streak_current: 1, streak_best: 1, active_today: true,
      achievements_unlocked: unlocked ? 1 : 0, achievements_total: 1,
    },
    "/api/nucleo/attributes": [
      { name: "aprendizado", current_xp: xp, current_level: level, is_active: true, pct: 0, xp_for_next_level: 100 },
    ],
    "/api/nucleo/achievements": [
      {
        id: "a1", key: "marco_em_dia", title: "trilha em dia", description: "d", rule_type: "fixed",
        unlocked, unlocked_at: unlocked ? "2026-10-07T20:00:00-03:00" : null,
        progress_current: unlocked ? 1 : 0, progress_target: 1,
      },
    ],
  };
}

test(
  "progress-watcher mostra +xp, subida de nível e conquista depois de uma escrita",
  withDom("<body></body>", async (dom, t) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    t.after(() => {
      delete globalThis.CustomEvent;
      delete globalThis.requestAnimationFrame;
    });

    let state = snapshot({ xp: 90, level: 1, playerLevel: 1, unlocked: false });
    let gets = 0;
    t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
      const path = new URL(url).pathname;
      if ((opts.method ?? "GET") === "GET") gets += 1;
      return { ok: true, status: 200, json: async () => state[path] ?? {} };
    });

    const refreshes = [];
    dom.window.addEventListener("kami:action-registered", (e) => refreshes.push(e.detail));

    const { startProgressWatcher } = await import("../../frontend/js/components/progress-watcher.js");
    const { post, put } = await import("../../frontend/js/api/client.js");
    startProgressWatcher();
    await wait(50);

    // concluir um marco: +20 xp, sobe o atributo e o nível geral, libera conquista
    state = snapshot({ xp: 110, level: 2, playerLevel: 2, unlocked: true });
    await put("/api/aprendizado/milestones/m1", { status: "concluido" });
    await wait(400);

    const line = document.querySelector(".xp-feed-item");
    assert.ok(line, "linha de xp deveria aparecer");
    assert.match(line.textContent, /\+20 xp/);
    assert.match(line.textContent, /aprendizado/);
    const toasts = [...document.querySelectorAll(".toast-title")].map((el) => el.textContent);
    assert.ok(toasts.includes("aprendizado subiu pro nível 2"));
    assert.ok(toasts.includes("nível 2 alcançado"));
    assert.ok(toasts.includes("conquista desbloqueada: trilha em dia"));
    assert.equal(refreshes.length, 1);

    // escrita de layout não dispara nova foto
    const before = gets;
    await put("/api/dashboard/nucleo", { widgets: [] });
    await wait(400);
    assert.equal(gets, before);

    // estorno aparece apagado; a conquista que deixou de valer volta a bloquear
    state = snapshot({ xp: 90, level: 1, playerLevel: 1, unlocked: false });
    await post("/api/aprendizado/milestones/m1/x", {});
    await wait(400);
    const neg = document.querySelector(".xp-feed-item.neg");
    assert.ok(neg, "estorno deveria aparecer como linha negativa");
    assert.match(neg.textContent, /−20 xp/);
    const achievementToasts = [...document.querySelectorAll(".toast-title")].filter((el) =>
      el.textContent.startsWith("conquista desbloqueada")
    );
    assert.equal(achievementToasts.length, 1);
    const lines = [...document.querySelectorAll(".xp-feed-item.neg")].map((el) => el.textContent);
    assert.ok(lines.some((t) => t.includes("conquista bloqueada") && t.includes("trilha em dia")));
  })
);
