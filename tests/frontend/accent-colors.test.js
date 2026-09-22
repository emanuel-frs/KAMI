import test from "node:test";
import assert from "node:assert/strict";
import { ACCENT_OPTIONS, accentAvatar, accentLabel } from "../../frontend/js/components/accent-colors.js";

test("accentLabel devolve o label cadastrado e cai pro hex cru se não existir", () => {
  assert.equal(accentLabel("#8fbf8f"), "verde fósforo (padrão)");
  assert.equal(accentLabel("#000000"), "#000000");
});

test("accentAvatar devolve o avatar cadastrado e cai pro avatar padrão se não existir", () => {
  assert.equal(accentAvatar("#e0c15a"), "assets/logos/logo-kami-dourado.gif");
  assert.equal(accentAvatar("#000000"), ACCENT_OPTIONS[0].avatar);
});

test("ACCENT_OPTIONS não tem hex duplicado entre as opções", () => {
  const values = ACCENT_OPTIONS.map((o) => o.value);
  assert.equal(new Set(values).size, values.length);
});
