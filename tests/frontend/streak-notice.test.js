import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "aviso de sequência salva aparece uma vez e marca os dias como vistos",
  withDom("<body></body>", async (dom, t) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0); // toast.js anima a entrada
    t.after(() => {
      delete globalThis.CustomEvent;
      delete globalThis.requestAnimationFrame;
    });
    let saved = ["2026-10-08"];
    const posts = [];
    t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
      const path = new URL(url, "http://localhost").pathname;
      if (opts.method === "POST") {
        posts.push({ path, body: JSON.parse(opts.body) });
        saved = [];
        return { ok: true, status: 204, json: async () => null };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ streak_current: 12, streak_protections: 1, streak_saved_days: saved }),
      };
    });

    const { startStreakNotice, noticeText } = await import("../../frontend/js/components/streak-notice.js");
    await startStreakNotice();

    const toasts = document.querySelectorAll(".toast-item");
    assert.equal(toasts.length, 1);
    assert.match(toasts[0].textContent, /sequência salva!/);
    assert.match(toasts[0].textContent, /um dia ficou em branco e uma proteção segurou sua sequência de 12 dias · resta 1 proteção/);
    assert.deepEqual(posts, [{ path: "/api/nucleo/streak-saved/seen", body: { days: ["2026-10-08"] } }]);

    // depois de uma ação, nada de aviso repetido
    window.dispatchEvent(new dom.window.CustomEvent("kami:action-registered"));
    await wait(50);
    assert.equal(document.querySelectorAll(".toast-item").length, 1);

    assert.equal(
      noticeText({ streak_current: 20, streak_protections: 0 }, ["a", "b"]),
      "2 dias ficaram em branco e as proteções seguraram sua sequência de 20 dias · nenhuma proteção sobrando"
    );
  })
);
