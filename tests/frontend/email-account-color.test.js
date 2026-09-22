import test from "node:test";
import assert from "node:assert/strict";
import { emailAccountColor } from "../../frontend/js/components/email-account-color.js";

test("emailAccountColor é determinística pro mesmo account_id", () => {
  const id = "conta-123@kami.local";
  assert.equal(emailAccountColor(id), emailAccountColor(id));
});

test("emailAccountColor devolve hsl(H, 55%, 60%) com H entre 0 e 359", () => {
  const color = emailAccountColor("qualquer-conta");
  const match = color.match(/^hsl\((\d+), 55%, 60%\)$/);
  assert.ok(match, `cor fora do formato esperado: ${color}`);
  const hue = Number(match[1]);
  assert.ok(hue >= 0 && hue < 360);
});

test("emailAccountColor não quebra com string vazia/null/undefined", () => {
  assert.doesNotThrow(() => emailAccountColor(""));
  assert.doesNotThrow(() => emailAccountColor(null));
  assert.doesNotThrow(() => emailAccountColor(undefined));
  assert.equal(emailAccountColor(""), "hsl(0, 55%, 60%)");
});

test("emailAccountColor gera cores diferentes pra ids diferentes (caso comum)", () => {
  assert.notEqual(emailAccountColor("conta-a"), emailAccountColor("conta-b"));
});
