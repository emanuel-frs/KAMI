import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

test(
  "cursor em pixel art: borda na cor de destaque, miolo preto, regras de cursor reescritas",
  withDom('<style>.x { cursor: pointer; } .y { cursor: default; } .z { cursor: text; } .g { cursor: grab; } .r { cursor: nwse-resize; } .h { cursor: help; }</style>', async (dom, t) => {
    globalThis.getComputedStyle = dom.window.getComputedStyle;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.MutationObserver = dom.window.MutationObserver;
    t.after(() => {
      delete globalThis.getComputedStyle;
      delete globalThis.requestAnimationFrame;
      delete globalThis.MutationObserver;
    });
    document.documentElement.style.setProperty("--accent", "#5ac8c8");

    const { cursorSvg, wirePixelCursor } = await import("../../frontend/js/components/pixel-cursor.js");
    const svg = decodeURIComponent(cursorSvg(["BF", "B."], "#e08fa0"));
    assert.match(svg, /fill="#e08fa0"/);
    assert.match(svg, /fill="#000"/);
    assert.match(svg, /width="2" height="2"/); // 1px por pixel: tamanho de cursor comum

    wirePixelCursor();
    const root = document.documentElement;
    assert.ok(root.classList.contains("fx-pixel-cursor"));
    assert.match(decodeURIComponent(root.style.getPropertyValue("--fx-cursor-pointer")), /#5ac8c8/);
    const rules = [...document.styleSheets[0].cssRules].map((r) => r.style.cursor);
    // todos os tipos que o app usa ganham arte; um tipo sem arte (help) fica como está
    assert.deepEqual(rules, [
      "var(--fx-cursor-pointer)", "var(--fx-cursor-default)", "var(--fx-cursor-text)",
      "var(--fx-cursor-grab)", "var(--fx-cursor-nwse-resize)", "help",
    ]);
    for (const name of ["default", "pointer", "text", "grab", "grabbing", "nwse-resize"]) {
      assert.match(root.style.getPropertyValue(`--fx-cursor-${name}`), new RegExp(`, ${name}$`));
    }
  })
);
