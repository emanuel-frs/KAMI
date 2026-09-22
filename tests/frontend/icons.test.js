import test from "node:test";
import assert from "node:assert/strict";
import { icon } from "../../frontend/js/components/icons.js";

test("icon devolve string vazia pra um nome desconhecido", () => {
  assert.equal(icon("nao-existe"), "");
});

test("icon usa aria-hidden por padrão e role=img+aria-label quando title é passado", () => {
  const semTitulo = icon("check");
  assert.match(semTitulo, /aria-hidden="true"/);
  assert.doesNotMatch(semTitulo, /role="img"/);

  const comTitulo = icon("x", { title: "fechar" });
  assert.match(comTitulo, /role="img" aria-label="fechar"/);
});

test("icon aplica size default (14) e respeita um size customizado", () => {
  assert.match(icon("plus"), /width="14" height="14"/);
  assert.match(icon("plus", { size: 24 }), /width="24" height="24"/);
});

test("icon monta a classe combinando icon-<nome> com className extra", () => {
  assert.match(icon("star"), /class="icon icon-star"/);
  assert.match(icon("star", { className: "widget-icon" }), /class="icon icon-star widget-icon"/);
});

test("icon respeita fill/strokeWidth customizados e usa fill=none/stroke-width=1.75 por padrão", () => {
  assert.match(icon("check"), /fill="none"/);
  assert.match(icon("check"), /stroke-width="1\.75"/);
  const custom = icon("check", { fill: "currentColor", strokeWidth: 2 });
  assert.match(custom, /fill="currentColor"/);
  assert.match(custom, /stroke-width="2"/);
});
