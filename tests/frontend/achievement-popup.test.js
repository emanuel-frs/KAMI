import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

test(
  "aviso estilo Steam: card próprio com texto completo pro leitor de tela; desligado vira toast",
  withDom("<body></body>", async (dom, t) => {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.CustomEvent = dom.window.CustomEvent;
    t.after(() => {
      delete globalThis.requestAnimationFrame;
      delete globalThis.CustomEvent;
    });
    const events = [];
    window.addEventListener("kami:achievement-popup", (e) => events.push(e.detail.kind));
    const { store } = await import("../../frontend/js/state/store.js");
    const { showAchievementPopup } = await import("../../frontend/js/components/achievement-popup.js");

    store.set("profile", { efeitos_visuais: "sutil" });
    let clicked = 0;
    showAchievementPopup({ label: "conquista desbloqueada", title: "maratona", detail: "3 marcos em 7 dias", onClick: () => clicked++ });
    const pop = document.querySelector(".ach-pop");
    assert.ok(pop.closest(".toast-stack"), "entra na mesma pilha dos toasts");
    assert.equal(pop.classList.contains("animated"), false); // sutil: sem animação
    assert.equal(pop.querySelector(".ach-pop-title").textContent, "maratona");
    assert.equal(pop.querySelector(".sr-only").textContent, "conquista desbloqueada: maratona. 3 marcos em 7 dias");
    pop.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter" }));
    assert.equal(clicked, 1);

    store.set("profile", { efeitos_visuais: "desligado" });
    showAchievementPopup({ label: "missão concluída", title: "salve um link", kind: "missao" });
    const toast = [...document.querySelectorAll(".toast-title")].map((e) => e.textContent);
    assert.ok(toast.includes("missão concluída: salve um link"));
    assert.deepEqual(events, ["conquista", "missao"]);
  })
);
