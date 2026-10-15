import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const attr = (name, extra = {}) => ({
  id: name, name, current_xp: 100, current_level: 2, is_active: true, pct: 40, xp_for_next_level: 246,
  bonus_atrasado: false, last_activity_at: "2026-10-08", days_inactive: 1, forgotten: false, ...extra,
});

test(
  "radar apaga o vértice do atributo esquecido e explica no tooltip (GAM-09)",
  withDom('<div class="card"><div id="w"></div></div>', async (dom, t) => {
    const data = [
      attr("aprendizado"),
      attr("carreira", { forgotten: true, days_inactive: 21, last_activity_at: "2026-09-18" }),
      attr("financas"),
      attr("metas"),
      attr("organizacao"),
    ];
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => data }));
    const { render } = await import("../../frontend/js/widgets/attributes.js");
    const el = document.querySelector("#w");
    await render(el, {});

    const dots = [...el.querySelectorAll(".pg-data-dot")];
    assert.equal(dots.length, 5);
    assert.deepEqual(dots.map((d) => d.classList.contains("forgotten")), [false, true, false, false, false]);

    const car = el.querySelector('[data-filter="carreira"]');
    assert.ok(car.classList.contains("forgotten"));
    assert.match(car.dataset.tooltip, /sem atividade há 21 dias/);
    assert.doesNotMatch(el.querySelector('[data-filter="metas"]').dataset.tooltip, /sem atividade/);
  })
);
