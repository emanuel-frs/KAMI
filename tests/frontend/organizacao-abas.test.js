import test from "node:test";
import assert from "node:assert/strict";
import { ABAS, moverAba, ordemDasAbas } from "../../frontend/js/pages/organizacao-abas.js";

test("sem ordem salva, as abas vêm na ordem padrão (notas primeiro)", () => {
  assert.deepEqual(ordemDasAbas(null), ABAS);
  assert.deepEqual(ordemDasAbas(""), ABAS);
});

test("a ordem salva manda; id desconhecido ou repetido sai e o que falta vai pro fim", () => {
  assert.deepEqual(ordemDasAbas("links,email"), ["links", "email", "notas", "entrada", "github"]);
  assert.deepEqual(ordemDasAbas("links, senhas,links,notas"), ["links", "notas", "entrada", "github", "email"]);
});

test("mover uma aba pra uma posição, limitada às pontas", () => {
  assert.deepEqual(moverAba(ABAS, "links", 0), ["links", "notas", "entrada", "github", "email"]);
  assert.deepEqual(moverAba(ABAS, "notas", 1), ["entrada", "notas", "github", "email"]
    .concat(["links"]));
  assert.deepEqual(moverAba(ABAS, "notas", -1), ABAS);
  assert.deepEqual(moverAba(ABAS, "links", 99), ABAS);
  assert.deepEqual(moverAba(ABAS, "nada", 0), ABAS);
});
