import test from "node:test";
import assert from "node:assert/strict";
import {
  clearScreenTipsReplay,
  getScreenTipsReplay,
  registerScreenTipsReplay,
} from "../../frontend/js/components/screen-tips-registry.js";

test.beforeEach(() => {
  // registro é um módulo singleton — garante estado limpo entre testes
  clearScreenTipsReplay(getScreenTipsReplay());
});

test("getScreenTipsReplay devolve null quando nada foi registrado", () => {
  assert.equal(getScreenTipsReplay(), null);
});

test("registerScreenTipsReplay registra a função passada", () => {
  const fn = () => {};
  registerScreenTipsReplay(fn);
  assert.equal(getScreenTipsReplay(), fn);
});

test("clearScreenTipsReplay limpa quando a função passada é a registrada atualmente", () => {
  const fn = () => {};
  registerScreenTipsReplay(fn);
  clearScreenTipsReplay(fn);
  assert.equal(getScreenTipsReplay(), null);
});

test("clearScreenTipsReplay não limpa se a função passada não for mais a registrada (troca rápida de tela)", () => {
  const oldFn = () => {};
  const newFn = () => {};
  registerScreenTipsReplay(oldFn);
  registerScreenTipsReplay(newFn);
  clearScreenTipsReplay(oldFn); // unmount tardio da tela antiga
  assert.equal(getScreenTipsReplay(), newFn);
});
