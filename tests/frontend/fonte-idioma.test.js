// I18N-04 — aviso de fonte faltando (components/fonte-idioma.js).
import test from "node:test";
import assert from "node:assert/strict";
import { textoDoAviso } from "../../frontend/js/components/fonte-idioma.js";

test("aviso só pros idiomas de escrita própria, com o pacote de cada distribuição", () => {
  for (const idioma of ["pt", "en", "de", "fr"]) assert.equal(textoDoAviso(idioma), null);
  const ja = textoDoAviso("ja");
  assert.match(ja.title, /Japanese/);
  assert.match(ja.message, /dnf install google-noto-sans-cjk-fonts/);
  assert.match(ja.message, /apt install fonts-noto-cjk/);
  assert.match(textoDoAviso("hi").message, /pacman -S noto-fonts\b/);
});
