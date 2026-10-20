// ORG-04 — textos e linha do "hoje" dos hábitos (components/habito-linha.js).
import test from "node:test";
import assert from "node:assert/strict";
import { rotuloFrequencia, rotuloSequencia, rotuloAtributo, itemHojeHtml } from "../../frontend/js/components/habito-linha.js";

const BASE = {
  id: "h1", nome: "ler <b>", frequencia: "diario", dias_semana: [], vezes_semana: 3, atributo: "financas",
  vale_hoje: true, feito_hoje: false, feitas_na_semana: 0, sequencia: 4, recorde: 9, xp_por_marca: 5,
};

test("frequência em texto curto", () => {
  assert.equal(rotuloFrequencia(BASE), "todo dia");
  assert.equal(rotuloFrequencia({ ...BASE, frequencia: "dias", dias_semana: [0, 1, 2, 3, 4] }), "seg a sex");
  assert.equal(rotuloFrequencia({ ...BASE, frequencia: "dias", dias_semana: [5, 6] }), "fim de semana");
  assert.equal(rotuloFrequencia({ ...BASE, frequencia: "dias", dias_semana: [0, 2, 4] }), "seg, qua, sex");
  assert.equal(rotuloFrequencia({ ...BASE, frequencia: "semana", vezes_semana: 2 }), "2x por semana");
});

test("sequência em dias ou semanas e atributo com acento", () => {
  assert.equal(rotuloSequencia(BASE), "4d");
  assert.equal(rotuloSequencia({ ...BASE, frequencia: "semana" }, 2), "2 sem");
  assert.equal(rotuloAtributo("financas"), "finanças");
  assert.equal(rotuloAtributo("outro"), "outro");
});

test("linha do hoje: botão marcável, feito, e apagada fora do dia", () => {
  const pendente = itemHojeHtml(BASE);
  assert.match(pendente, /<button[^>]+data-marcar/);
  assert.match(pendente, /aria-pressed="false"/);
  assert.match(pendente, /\[ \]/);
  assert.ok(pendente.includes("ler &lt;b&gt;") && !pendente.includes("<b>"));
  assert.match(itemHojeHtml({ ...BASE, feito_hoje: true }), /\[x\][\s\S]*aria-pressed|aria-pressed="true"/);
  const folga = itemHojeHtml({ ...BASE, vale_hoje: false });
  assert.ok(!folga.includes("<button") && folga.includes("hoje não é dia"));
  assert.match(itemHojeHtml({ ...BASE, frequencia: "semana", feitas_na_semana: 1 }), /1\/3 na semana/);
});
