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
    // GAM-15: os títulos dos toasts aparecem digitados — espera o título
    // inteiro (até 3 s) em vez de um tempo fixo, que não bastava com a
    // suíte toda rodando (jsdom 30)
    const titulosAgora = () => [...document.querySelectorAll(".toast-title")].map((el) => el.textContent);
    for (let i = 0; i < 60 && !titulosAgora().includes("aprendizado subiu pro nível 2"); i++) await wait(50);

    const line = document.querySelector(".xp-feed-item");
    assert.ok(line, "linha de xp deveria aparecer");
    assert.match(line.textContent, /\+20 xp/);
    assert.match(line.textContent, /aprendizado/);
    const toasts = [...document.querySelectorAll(".toast-title")].map((el) => el.textContent);
    assert.ok(toasts.includes("aprendizado subiu pro nível 2"));
    // nível GERAL com efeitos "completo" (padrão): tela cheia, não toast
    assert.ok(!toasts.includes("nível 2 alcançado"));
    const overlay = document.querySelector(".level-up");
    assert.ok(overlay, "tela de subida de nível deveria abrir");
    assert.equal(overlay.getAttribute("role"), "dialog");
    assert.match(overlay.textContent, /nível 1 → 2/);
    overlay.dismiss();
    // GAM-15: conquista vira o aviso "estilo Steam" (.ach-pop), não toast
    const popups = () => [...document.querySelectorAll(".ach-pop .sr-only")].map((el) => el.textContent);
    assert.ok(popups().some((t) => t.startsWith("conquista desbloqueada: trilha em dia")));
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
    assert.equal(popups().filter((t) => t.startsWith("conquista desbloqueada")).length, 1);
    const lines = [...document.querySelectorAll(".xp-feed-item.neg")].map((el) => el.textContent);
    assert.ok(lines.some((t) => t.includes("conquista bloqueada") && t.includes("trilha em dia")));

    // efeitos "sutil": subida do nível geral vira toast, sem tela cheia
    const { store } = await import("../../frontend/js/state/store.js");
    store.set("profile", { efeitos_visuais: "sutil" });
    await wait(250);
    state = snapshot({ xp: 110, level: 2, playerLevel: 2, unlocked: true });
    await put("/api/aprendizado/milestones/m1", { status: "concluido" });
    for (let i = 0; i < 60 && !titulosAgora().includes("nível 2 alcançado"); i++) await wait(50);
    assert.equal(document.querySelectorAll(".level-up").length, 0);
    const toastsSutil = [...document.querySelectorAll(".toast-title")].map((el) => el.textContent);
    assert.ok(toastsSutil.includes("nível 2 alcançado"));
  })
);
