import test from "node:test";
import assert from "node:assert/strict";
import { store } from "../../frontend/js/state/store.js";

// o store é um singleton (módulo com estado interno único) — cada teste
// usa uma key própria pra não vazar estado entre casos.

test("get devolve undefined pra uma key nunca setada", () => {
  assert.equal(store.get("chave-inexistente-xyz"), undefined);
});

test("set grava o valor e get devolve o mesmo valor", () => {
  store.set("profile-test", { nome: "Claudio" });
  assert.deepEqual(store.get("profile-test"), { nome: "Claudio" });
});

test("subscribe é chamado com o novo valor a cada set", () => {
  const calls = [];
  store.subscribe("counter-test", (v) => calls.push(v));
  store.set("counter-test", 1);
  store.set("counter-test", 2);
  assert.deepEqual(calls, [1, 2]);
});

test("múltiplos listeners na mesma key são todos notificados", () => {
  let a, b;
  store.subscribe("multi-test", (v) => (a = v));
  store.subscribe("multi-test", (v) => (b = v));
  store.set("multi-test", "valor");
  assert.equal(a, "valor");
  assert.equal(b, "valor");
});

test("subscribe devolve uma função de unsubscribe que para as notificações", () => {
  const calls = [];
  const unsubscribe = store.subscribe("unsub-test", (v) => calls.push(v));
  store.set("unsub-test", "a");
  unsubscribe();
  store.set("unsub-test", "b");
  assert.deepEqual(calls, ["a"]);
});

test("um listener registrado numa key não é chamado por set em outra key", () => {
  let called = false;
  store.subscribe("key-a-test", () => (called = true));
  store.set("key-b-test", "outro valor");
  assert.equal(called, false);
});
