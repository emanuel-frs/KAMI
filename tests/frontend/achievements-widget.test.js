import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const ACHIEVEMENTS = [
  { id: "1", key: "a", category: "nucleo", tier: "bronze", secret: false, title: "zeta", description: "d",
    unlocked: false, unlocked_at: null, progress_current: 9, progress_target: 10 },
  { id: "2", key: "b", category: "financas", tier: null, secret: false, title: "alfa", description: "d",
    unlocked: true, unlocked_at: "2026-10-01T10:00:00-03:00", progress_current: 1, progress_target: 1 },
  { id: "3", key: "c", category: "nucleo", tier: null, secret: true, title: "???", description: "conquista secreta",
    unlocked: false, unlocked_at: null, progress_current: 0, progress_target: 1 },
  { id: "4", key: "d", category: "nucleo", tier: "ouro", secret: false, title: "beta", description: "d",
    unlocked: true, unlocked_at: "2026-10-05T10:00:00-03:00", progress_current: 1, progress_target: 1 },
];

test("toggleCategory liga, desliga e limpa áreas", async () => {
  const { toggleCategory } = await import("../../frontend/js/widgets/achievements.js");
  let sel = toggleCategory(new Set(), "nucleo");
  sel = toggleCategory(sel, "metas");
  assert.deepEqual([...sel].sort(), ["metas", "nucleo"]);
  sel = toggleCategory(sel, "nucleo");
  assert.deepEqual([...sel], ["metas"]);
  assert.equal(toggleCategory(sel, "all").size, 0);
});

test("sortAchievements: desbloqueadas recentes primeiro, depois bloqueadas por progresso", async () => {
  const { sortAchievements } = await import("../../frontend/js/widgets/achievements.js");
  assert.deepEqual(sortAchievements(ACHIEVEMENTS).map((a) => a.key), ["d", "b", "a", "c"]);
});

test(
  "galeria filtra por área, mostra nível e mantém secreta mascarada",
  withDom('<div id="w"></div>', async (dom, t) => {
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => ACHIEVEMENTS }));
    const { render } = await import("../../frontend/js/widgets/achievements.js");
    const el = document.querySelector("#w");
    await render(el, {});

    const filters = [...el.querySelectorAll(".ach-filter")].map((b) => b.textContent.trim());
    assert.deepEqual(filters, ["todas 2/4", "núcleo 1/3", "finanças 1/1"]);
    assert.equal(el.querySelectorAll(".ach").length, 4);
    assert.equal(el.querySelector(".ach-tier").textContent, "III");

    el.querySelector('.ach-filter[data-category="financas"]').click();
    const titles = [...el.querySelectorAll(".a-title")].map((n) => n.textContent);
    assert.deepEqual(titles, ["alfa"]);
    assert.equal(el.querySelector('.ach-filter[data-category="financas"]').getAttribute("aria-pressed"), "true");

    // segunda área soma à primeira (várias ao mesmo tempo)
    el.querySelector('.ach-filter[data-category="nucleo"]').click();
    assert.equal(el.querySelectorAll(".ach").length, 4);
    assert.equal(el.querySelector('.ach-filter[data-category="nucleo"]').getAttribute("aria-pressed"), "true");
    assert.equal(el.querySelector('.ach-filter[data-category="financas"]').getAttribute("aria-pressed"), "true");
    assert.equal(el.querySelector('.ach-filter[data-category="all"]').getAttribute("aria-pressed"), "false");
    assert.ok(el.querySelector(".ach.secret"));
    assert.ok([...el.querySelectorAll(".a-title")].some((n) => n.textContent === "???"));

    // desligar uma área tira só ela
    el.querySelector('.ach-filter[data-category="financas"]').click();
    assert.equal(el.querySelectorAll(".ach").length, 3);

    // "todas" limpa a seleção
    el.querySelector('.ach-filter[data-category="all"]').click();
    assert.equal(el.querySelectorAll(".ach").length, 4);
    assert.equal(el.querySelector('.ach-filter[data-category="all"]').getAttribute("aria-pressed"), "true");
  })
);

test(
  "conquista personalizada (GAM-14): marca 'sua', botão de remover e '+ criar conquista'",
  withDom('<div class="card"><div id="w"></div></div>', async (dom, t) => {
    const list = [
      { id: "c1", key: "custom:c1", category: "aprendizado", tier: null, secret: false, title: "poliglota",
        description: '2 ações em aprendizado com "inglês"', rule_type: "custom", unlocked: false, unlocked_at: null,
        progress_current: 1, progress_target: 2 },
      { id: "s1", key: "streak_3", category: "nucleo", tier: null, secret: false, title: "aquecendo",
        description: "3 dias", rule_type: "fixed", unlocked: false, unlocked_at: null, progress_current: 0, progress_target: 3 },
    ];
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => list }));
    globalThis.CustomEvent = dom.window.CustomEvent;
    t.after(() => delete globalThis.CustomEvent);
    // o client guarda GETs em cache até a próxima escrita — o teste de cima já buscou a galeria
    const { post } = await import("../../frontend/js/api/client.js");
    await post("/api/x", {});
    const { render } = await import("../../frontend/js/widgets/achievements.js");
    const el = document.querySelector("#w");
    await render(el, {});
    const custom = [...el.querySelectorAll(".ach")].find((c) => c.textContent.includes("poliglota"));
    const fixed = [...el.querySelectorAll(".ach")].find((c) => c.textContent.includes("aquecendo"));
    assert.ok(custom.querySelector(".ach-mine"));
    assert.equal(custom.querySelector("[data-remove-custom]").dataset.removeCustom, "c1");
    assert.equal(fixed.querySelector(".ach-mine"), null);
    assert.ok(el.querySelector("[data-create-custom]"));
  })
);
