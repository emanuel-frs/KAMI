import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  flameDim,
  flameOptions,
  flameStage,
  flameSvg,
  protectionsSummary,
  protectionsText,
} from "../../frontend/js/components/streak-flame.js";

function parse(svg) {
  return new JSDOM(`<body>${svg}</body>`).window.document.querySelector("svg");
}

// área pintada (soma das larguras dos retângulos de um quadro)
function area(svg) {
  return [...parse(svg).querySelectorAll(".sf-frame-a rect")].reduce((t, r) => t + Number(r.getAttribute("width")), 0);
}

test("chama cresce em degraus (1, 3, 7, 14, 30 dias)", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 6, 7, 13, 14, 29, 30, 400].map(flameStage),
    [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
  );
  const areas = [0, 1, 3, 7, 14, 30].map((d) => area(flameSvg(d)));
  for (let i = 1; i < areas.length; i++) assert.ok(areas[i] > areas[i - 1], `degrau ${i} não cresceu`);
});

test("svg tem dois quadros (o segundo espelhado), pixels dentro da grade 10×12", () => {
  const svg = parse(flameSvg(30));
  assert.equal(svg.getAttribute("viewBox"), "-1 -1 12 14");
  assert.equal(svg.getAttribute("shape-rendering"), "crispEdges");
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.querySelector(".sf-frame-b").getAttribute("transform"), "matrix(-1 0 0 1 10 0)");
  for (const r of svg.querySelectorAll("rect")) {
    const x = Number(r.getAttribute("x"));
    const y = Number(r.getAttribute("y"));
    assert.ok(x >= 0 && x + Number(r.getAttribute("width")) <= 10 && y >= 0 && y < 12);
    assert.match(r.getAttribute("class"), /^sf-[abc]$/);
  }
});

test("apagada leva data-dim; degrau vai em data-stage (a brasa não tremula, ver css)", () => {
  assert.equal(parse(flameSvg(5, { dim: true })).hasAttribute("data-dim"), true);
  assert.equal(parse(flameSvg(5)).hasAttribute("data-dim"), false);
  assert.equal(parse(flameSvg(0)).dataset.stage, "0");
});

test("proteções: guardadas + espaço livre, e resumo pro tooltip", () => {
  assert.equal(protectionsText(0, 2), "◇◇");
  assert.equal(protectionsText(1, 2), "◆◇");
  assert.equal(protectionsText(2, 2), "◆◆");

  const base = { streak_protections: 1, streak_protections_max: 2, streak_next_protection_in: 1, streak_protected_yesterday: false };
  assert.equal(protectionsSummary(base), "1/2 proteções guardadas · próxima em 1 dia com ação");
  assert.equal(
    protectionsSummary({ ...base, streak_protections: 2, streak_protected_yesterday: true }),
    "2/2 proteções guardadas · ontem foi protegido"
  );
});

test("chama apagada só com sequência viva e hoje sem ação", () => {
  assert.equal(flameDim({ streak_current: 4, active_today: false }), true);
  assert.equal(flameDim({ streak_current: 4, active_today: true }), false);
  assert.equal(flameDim({ streak_current: 0, active_today: false }), false);
});

test("blindada: contorno de pixel em volta da chama, encostando nela e fora dela", () => {
  assert.equal(parse(flameSvg(12)).querySelector(".sf-shield"), null);
  const svg = parse(flameSvg(12, { shield: true }));
  assert.equal(svg.hasAttribute("data-shield"), true);
  assert.equal(svg.hasAttribute("data-dim"), true); // blindada também é apagada
  const painted = new Set();
  for (const r of svg.querySelectorAll(".sf-frame-a rect")) {
    const x = Number(r.getAttribute("x"));
    for (let i = 0; i < Number(r.getAttribute("width")); i++) painted.add(`${x + i},${r.getAttribute("y")}`);
  }
  const outline = [...svg.querySelectorAll(".sf-shield rect")];
  assert.ok(outline.length > 0);
  for (const r of outline) {
    const x = Number(r.getAttribute("x"));
    const y = Number(r.getAttribute("y"));
    assert.ok(!painted.has(`${x},${y}`), "contorno por cima da chama");
    assert.ok(x >= -1 && x <= 10 && y >= -1 && y <= 12, "contorno fora do viewBox");
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => painted.has(`${x + dx},${y + dy}`));
    assert.ok(touches, `pixel solto no contorno em ${x},${y}`);
  }
});

test("flameOptions: blindada só com ontem protegido e hoje sem ação", () => {
  const p = { streak_current: 9, active_today: false, streak_protected_yesterday: true };
  assert.deepEqual(flameOptions(p), { dim: true, shield: true });
  assert.deepEqual(flameOptions({ ...p, active_today: true }), { dim: false, shield: false });
  assert.deepEqual(flameOptions({ ...p, streak_protected_yesterday: false }), { dim: true, shield: false });
});
