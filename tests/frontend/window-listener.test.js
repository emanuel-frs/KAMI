import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";
import { listenWhileConnected } from "../../frontend/js/components/window-listener.js";

test(
  "listenWhileConnected para de chamar o handler quando o widget sai da tela",
  withDom('<div id="card"><div id="body"></div></div>', async (dom) => {
    const el = document.querySelector("#body");
    let calls = 0;
    listenWhileConnected(el, "kami:test", () => { calls += 1; });

    window.dispatchEvent(new dom.window.Event("kami:test"));
    assert.equal(calls, 1);

    // o grid troca o innerHTML do card ao re-renderizar: o body antigo sai do DOM
    document.querySelector("#card").innerHTML = '<div id="body"></div>';
    window.dispatchEvent(new dom.window.Event("kami:test"));
    window.dispatchEvent(new dom.window.Event("kami:test"));
    assert.equal(calls, 1);
  })
);

test(
  "listenWhileConnected devolve uma função que remove o listener",
  withDom('<div id="body"></div>', async (dom) => {
    const el = document.querySelector("#body");
    let calls = 0;
    const stop = listenWhileConnected(el, "kami:test", () => { calls += 1; });
    stop();
    window.dispatchEvent(new dom.window.Event("kami:test"));
    assert.equal(calls, 0);
  })
);
