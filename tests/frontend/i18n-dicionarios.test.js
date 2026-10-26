// I18N-01 — os 10 dicionários (frontend/i18n/*.json) andam juntos com o
// português, que é a fonte: mesmas chaves, mesmas variáveis, plural com as
// formas que o idioma tem, nada vazio, e todo data-i18n do index.html
// existindo. Junto do backend/tests/test_mensagens.py, isto é o "nenhum
// texto faltando em nenhum idioma" do aceite da sprint.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDIOMAS } from "../../frontend/js/i18n.js";

const raiz = new URL("../../frontend/", import.meta.url);
const dic = (codigo) => JSON.parse(readFileSync(new URL(`i18n/${codigo}.json`, raiz), "utf8"));
const PT = dic("pt");
const variaveis = (v) => new Set([...(typeof v === "string" ? v : Object.values(v).join(" ")).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

test("o português tem pelo menos as chaves do index.html e de cada idioma", () => {
  const html = readFileSync(new URL("index.html", raiz), "utf8");
  const usadas = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  for (const par of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const p of par[1].split(";")) usadas.push(p.split(":")[1].trim());
  }
  assert.ok(usadas.length > 10);
  for (const chave of usadas) assert.ok(chave in PT, `index.html usa ${chave}, que não está no pt.json`);
});

for (const { codigo, intl } of IDIOMAS) {
  test(`${codigo}.json: mesmas chaves e variáveis do português, plural válido, nada vazio`, () => {
    const d = dic(codigo);
    assert.deepEqual(Object.keys(d).sort(), Object.keys(PT).sort(), `${codigo}.json com chaves diferentes do pt.json`);
    const formas = new Intl.PluralRules(intl).resolvedOptions().pluralCategories;
    for (const [chave, valor] of Object.entries(d)) {
      if (typeof valor === "object") {
        assert.ok("other" in valor, `${codigo}:${chave} sem a forma "other"`);
        for (const forma of Object.keys(valor)) {
          // "zero" é nossa: vale em qualquer idioma (i18n.js)
          assert.ok(forma === "zero" || formas.includes(forma), `${codigo}:${chave} tem a forma "${forma}", que ${intl} não usa`);
        }
        Object.values(valor).forEach((v) => assert.ok(v.trim(), `${codigo}:${chave} com forma vazia`));
      } else {
        assert.ok(valor.trim(), `${codigo}:${chave} vazio`);
      }
      assert.deepEqual(variaveis(valor), variaveis(PT[chave]), `${codigo}:${chave} com variáveis diferentes do português`);
    }
  });
}
