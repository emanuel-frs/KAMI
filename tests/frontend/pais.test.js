// I18N-06 — país e moeda padrão de uma instalação nova (components/pais.js)
// e o formato da moeda (components/format.js).
import test from "node:test";
import assert from "node:assert/strict";
import { moedaDoPais, paisDoSistema } from "../../frontend/js/components/pais.js";
import { definirMoeda, fmtMoeda, fmtMoney, simboloMoeda } from "../../frontend/js/components/format.js";
import { usarDicionarios } from "../../frontend/js/i18n.js";

test("país: a região do sistema; sem região, o país da língua; fora dos 10, Brasil", () => {
  assert.equal(paisDoSistema(["en-GB", "en"]), "GB");
  assert.equal(paisDoSistema(["pt-PT"]), "PT");
  assert.equal(paisDoSistema(["zh-Hant-TW"]), "TW");
  assert.equal(paisDoSistema(["en"]), "US");
  assert.equal(paisDoSistema(["hi"]), "IN");
  assert.equal(paisDoSistema(["ru"]), "BR");
  assert.equal(paisDoSistema([]), "BR");
});

test("moeda do país", () => {
  assert.equal(moedaDoPais("BR"), "BRL");
  assert.equal(moedaDoPais("DE"), "EUR");
  assert.equal(moedaDoPais("PT"), "EUR");
  assert.equal(moedaDoPais("JP"), "JPY");
  assert.equal(moedaDoPais("IN"), "INR");
  assert.equal(moedaDoPais("ZZ"), "USD");
});

test("valores na moeda do perfil, com os separadores do idioma", () => {
  definirMoeda("BRL");
  assert.equal(fmtMoeda(1234.5).replace(/\s/g, " "), "R$ 1.234,50");
  assert.equal(fmtMoney(25).replace(/\s/g, " "), "R$ 25");
  assert.equal(fmtMoeda(1234.5, { inteiro: true }).replace(/\s/g, " "), "R$ 1.235");
  definirMoeda("JPY");
  assert.equal(fmtMoeda(1234.5).replace(/\s/g, " "), "JP¥ 1.235", "iene não tem centavos");
  definirMoeda("XYZW");
  assert.equal(simboloMoeda(), "JP¥", "código inválido não troca");
  usarDicionarios("en", {}, {});
  definirMoeda("USD");
  assert.equal(fmtMoeda(1234.5), "$1,234.50");
  assert.equal(fmtMoeda(10, { moeda: "EUR" }), "€10.00");
  usarDicionarios("pt", {}, {});
  definirMoeda("BRL");
});
