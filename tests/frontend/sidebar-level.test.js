import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "barra lateral mostra nível e barra de xp e atualiza depois de uma ação",
  withDom('<div id="sidebar-level" hidden></div>', async (dom, t) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    t.after(() => delete globalThis.CustomEvent);
    let player = { level: 3, pct: 40, current_level_xp: 167, xp_for_next_level: 417 };
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => player }));

    const { startSidebarLevel } = await import("../../frontend/js/components/sidebar-level.js");
    const { post } = await import("../../frontend/js/api/client.js");
    startSidebarLevel();
    await wait(50);

    const el = document.querySelector("#sidebar-level");
    assert.equal(el.hidden, false);
    assert.equal(el.querySelector(".sl-level").textContent, "nv 3");
    assert.equal(el.querySelector(".sl-bar").textContent, "[####------]");
    assert.match(el.dataset.tooltip, /faltam 250 pro nível 4/);

    // escrita limpa o cache de GET; o watcher dispara o evento de progresso
    player = { level: 4, pct: 10, current_level_xp: 60, xp_for_next_level: 606 };
    await post("/api/x", {});
    window.dispatchEvent(new dom.window.CustomEvent("kami:action-registered"));
    await wait(200);
    assert.equal(el.querySelector(".sl-level").textContent, "nv 4");
    assert.equal(el.querySelector(".sl-bar").textContent, "[#---------]");
  })
);
