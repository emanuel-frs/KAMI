import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

test(
  "consumePendingFocus entrega o id dentro do TTL e limpa o pedido ao consumir",
  withDom("<div></div>", async (dom, t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    t.mock.timers.setTime(new Date("2026-07-10T12:00:00").getTime());

    const { setPendingFocus, consumePendingFocus } = await import(
      "../../frontend/js/components/pending-focus.js?ttl"
    );

    assert.equal(consumePendingFocus("divida"), null, "nada pedido ainda");

    setPendingFocus("divida", 42);
    assert.equal(consumePendingFocus("divida"), 42);
    assert.equal(consumePendingFocus("divida"), null, "consumir deve limpar o pedido");
  })
);

test(
  "consumePendingFocus ignora quando o tipo consumido não bate com o pedido",
  withDom("<div></div>", async (dom, t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    t.mock.timers.setTime(new Date("2026-07-10T12:00:00").getTime());

    const { setPendingFocus, consumePendingFocus } = await import(
      "../../frontend/js/components/pending-focus.js?mismatch"
    );

    setPendingFocus("divida", 42);
    assert.equal(consumePendingFocus("assinatura"), null);
  })
);

test(
  "consumePendingFocus expira o pedido depois do TTL de 6s, mas entrega um instante antes",
  withDom("<div></div>", async (dom, t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    t.mock.timers.setTime(new Date("2026-07-10T12:00:00").getTime());

    const { setPendingFocus, consumePendingFocus } = await import(
      "../../frontend/js/components/pending-focus.js?expiry"
    );

    setPendingFocus("meta", 7);
    t.mock.timers.tick(5999);
    assert.equal(consumePendingFocus("meta"), 7);

    setPendingFocus("meta", 8);
    t.mock.timers.tick(6001);
    assert.equal(consumePendingFocus("meta"), null);
  })
);

test(
  "focusRow rola até o elemento (comportamento depende de prefers-reduced-motion) e aplica/remove o flash",
  withDom("<div id=\"el\"></div>", async (dom, t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    dom.window.matchMedia = () => ({ matches: false });
    dom.window.HTMLElement.prototype.scrollIntoView = function (opts) {
      this._scrolledWith = opts;
    };

    const { focusRow } = await import("../../frontend/js/components/pending-focus.js?focus");

    assert.doesNotThrow(() => focusRow(null, "divida"));

    const el = document.getElementById("el");
    focusRow(el, "divida");
    assert.deepEqual(el._scrolledWith, { behavior: "smooth", block: "center" });
    assert.equal(el.classList.contains("kami-focus-flash"), true);
    assert.equal(el.style.getPropertyValue("--kami-focus-color"), "var(--red)");

    t.mock.timers.tick(2200);
    assert.equal(el.classList.contains("kami-focus-flash"), false);
    assert.equal(el.style.getPropertyValue("--kami-focus-color"), "");
  })
);

test(
  "focusRow usa behavior 'auto' quando o usuário prefere movimento reduzido",
  withDom("<div id=\"el\"></div>", async (dom, t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    dom.window.matchMedia = () => ({ matches: true });
    dom.window.HTMLElement.prototype.scrollIntoView = function (opts) {
      this._scrolledWith = opts;
    };

    const { focusRow } = await import("../../frontend/js/components/pending-focus.js?reduced");
    const el = document.getElementById("el");
    focusRow(el, "meta");
    assert.deepEqual(el._scrolledWith, { behavior: "auto", block: "center" });
  })
);
