// I18N-01 — base de tradução (frontend/js/i18n.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";
import { idiomaDoSistema, t, usarDicionarios, localeAtual, aplicarNoDocumento } from "../../frontend/js/i18n.js";

test("idioma do sistema: o primeiro dos 10, senão português (P-74)", () => {
  assert.equal(idiomaDoSistema(["pt-BR", "en-US"]), "pt");
  assert.equal(idiomaDoSistema(["ru-RU", "de-AT", "en"]), "de");
  assert.equal(idiomaDoSistema(["zh-Hant-TW"]), "zh");
  assert.equal(idiomaDoSistema(["ru", "uk"]), "pt", "fora dos 10: português");
  assert.equal(idiomaDoSistema([]), "pt");
});

test("t(): variáveis, reserva no português e chave crua só quando falta nos dois", () => {
  const pt = { "a.b": "faltam {n} dias pra {meta}", "so.pt": "só em português" };
  usarDicionarios("en", { "a.b": "{n} days left for {meta}" }, pt);
  assert.equal(t("a.b", { n: 3, meta: "x" }), "3 days left for x");
  assert.equal(t("so.pt"), "só em português");
  assert.equal(t("nao.existe"), "nao.existe");
  assert.equal(t("a.b", { n: 3 }), "3 days left for {meta}"); // variável que não veio fica visível
  assert.equal(localeAtual(), "en-US");
});

test("t(): plural pela regra de cada idioma", () => {
  usarDicionarios("pt", { d: { one: "{n} dia", other: "{n} dias" }, z: { zero: "nenhum dia", one: "{n} dia", other: "{n} dias" } });
  assert.equal(t("d", { n: 1 }), "1 dia");
  assert.equal(t("d", { n: 0 }), "0 dia"); // CLDR: em pt-BR o 0 é "one"…
  assert.equal(t("z", { n: 0 }), "nenhum dia"); // …por isso a forma "zero"
  assert.equal(t("d", { n: 2 }), "2 dias");
  usarDicionarios("fr", { d: { one: "{n} jour", other: "{n} jours" } });
  assert.equal(t("d", { n: 0 }), "0 jour"); // em francês zero é singular
  usarDicionarios("ja", { d: { other: "{n}日" } });
  assert.equal(t("d", { n: 1 }), "1日");
  usarDicionarios("hi", { d: { one: "{n} दिन", other: "{n} दिन" } });
  assert.equal(t("d", { n: 5 }), "5 दिन");
});

test(
  "aplicarNoDocumento: texto e atributos dos elementos marcados",
  withDom(
    `<body><span data-i18n="x.nome">nome</span><button data-i18n-attr="title:x.dica;aria-label:x.nome">b</button></body>`,
    async (dom) => {
      usarDicionarios("es", { "x.nome": "nombre", "x.dica": "consejo" });
      aplicarNoDocumento(dom.window.document);
      assert.equal(dom.window.document.querySelector("span").textContent, "nombre");
      const b = dom.window.document.querySelector("button");
      assert.equal(b.getAttribute("title"), "consejo");
      assert.equal(b.getAttribute("aria-label"), "nombre");
      usarDicionarios("pt", {});
    }
  )
);
