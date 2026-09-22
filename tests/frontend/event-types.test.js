import test from "node:test";
import assert from "node:assert/strict";
import { TYPE_META, isPendingAlertEvent, typeColor } from "../../frontend/js/components/event-types.js";

test("typeColor devolve a cor cadastrada e cai pro accent em tipo desconhecido", () => {
  assert.equal(typeColor("divida"), TYPE_META.divida.color);
  assert.equal(typeColor("evento"), "#7fa8d9");
  assert.equal(typeColor("tipo-que-nao-existe"), "var(--accent)");
});

test("isPendingAlertEvent: dívida só some do alerta quando status é 'paga'", () => {
  assert.equal(isPendingAlertEvent({ type: "divida", status: "aberta" }), true);
  assert.equal(isPendingAlertEvent({ type: "divida", status: "paga" }), false);
});

test("isPendingAlertEvent: assinatura e conta_fixa exigem status 'pendente'", () => {
  assert.equal(isPendingAlertEvent({ type: "assinatura", status: "pendente" }), true);
  assert.equal(isPendingAlertEvent({ type: "assinatura", status: "paga" }), false);
  assert.equal(isPendingAlertEvent({ type: "conta_fixa", status: "pendente" }), true);
  assert.equal(isPendingAlertEvent({ type: "conta_fixa", status: "paga" }), false);
});

test("isPendingAlertEvent: meta só sai do alerta quando status é 'concluida'", () => {
  assert.equal(isPendingAlertEvent({ type: "meta", status: "em_andamento" }), true);
  assert.equal(isPendingAlertEvent({ type: "meta", status: "concluida" }), false);
});

test("isPendingAlertEvent: contrato_fim e revisao_salarial não têm status próprio, contam sempre", () => {
  assert.equal(isPendingAlertEvent({ type: "contrato_fim" }), true);
  assert.equal(isPendingAlertEvent({ type: "revisao_salarial" }), true);
});

test("isPendingAlertEvent: tipos sem regra de alerta (evento, parcela, acao, desconhecido) nunca entram", () => {
  assert.equal(isPendingAlertEvent({ type: "evento" }), false);
  assert.equal(isPendingAlertEvent({ type: "parcela" }), false);
  assert.equal(isPendingAlertEvent({ type: "acao" }), false);
  assert.equal(isPendingAlertEvent({ type: "algo-novo" }), false);
});
