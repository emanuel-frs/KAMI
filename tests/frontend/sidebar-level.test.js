import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "barra lateral mostra nível e barra de xp e atualiza depois de uma ação",
  withDom('<div id="sidebar-level" hidden></div>', async (dom, t) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    t.after(() => {
      delete globalThis.CustomEvent;
      delete globalThis.requestAnimationFrame;
      delete globalThis.cancelAnimationFrame;
    });
    const streak = {
      streak_current: 12, active_today: true, streak_protections: 1, streak_protections_max: 2,
      streak_protected_yesterday: false, streak_next_protection_in: 2,
    };
    let player = { level: 3, pct: 40, current_level_xp: 167, xp_for_next_level: 417, ...streak };
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => player }));

    const { startSidebarLevel } = await import("../../frontend/js/components/sidebar-level.js");
    const { post } = await import("../../frontend/js/api/client.js");
    startSidebarLevel();
    await wait(50);

    const el = document.querySelector("#sidebar-level");
    assert.equal(el.hidden, false);
    assert.equal(el.querySelector(".sl-level").textContent, "nv 3");
    assert.equal(el.querySelector(".sl-bar").textContent, "[####------]");
    assert.match(el.querySelector(".sl-xp").dataset.tooltip, /faltam 250 pro nível 4/);
    // GAM-06: chama + dias + proteções
    assert.equal(el.querySelector(".sl-flame svg").dataset.stage, "3");
    assert.equal(el.querySelector(".sl-days").textContent, "12d");
    assert.equal(el.querySelector(".sl-protections").textContent, "◆◇");
    assert.match(el.querySelector(".sl-streak").dataset.tooltip, /1\/2 proteções guardadas · próxima em 2 dias com ação/);
    assert.equal(el.querySelector(".sl-flame svg").hasAttribute("data-dim"), false);

    // escrita limpa o cache de GET; o watcher dispara o evento de progresso
    player = {
      level: 4, pct: 10, current_level_xp: 60, xp_for_next_level: 606,
      ...streak, active_today: false, streak_protections: 0, streak_protected_yesterday: true,
    };
    await post("/api/x", {});
    window.dispatchEvent(new dom.window.CustomEvent("kami:action-registered"));
    await wait(700); // o "nv" conta de 3 até 4 (números rolando, GAM-15)
    assert.equal(el.querySelector(".sl-level").textContent, "nv 4");
    assert.equal(el.querySelector(".sl-bar").textContent, "[#---------]");
    assert.equal(el.querySelector(".sl-protections").textContent, "◇◇");
    assert.equal(el.querySelector(".sl-flame svg").hasAttribute("data-dim"), true);
    assert.match(el.querySelector(".sl-streak").dataset.tooltip, /ontem foi protegido/);
  })
);
