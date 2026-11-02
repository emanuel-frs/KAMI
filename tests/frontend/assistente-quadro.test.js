// IA-07a — quadro com os números da consulta (resumo financeiro, metas,
// visão do mês): o Kami mostra o que leu e o modelo só comenta.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const FIN = {
  month: "2026-11", income: 0, expenses: 10, net_this_month: null, accounts_total_available: 0,
  conclusions: { no_income_recorded_yet: true, income_still_expected: 1800, biggest_category: { category: "gasto", amount: 10, share_of_expenses_pct: 100 } },
  expected_income: [{ label: "parte 1", amount: 1800, expected_date: "2026-11-09", status: "previsto" }],
};
const METAS = {
  goals: [
    { title: "viagem", unit: "money", progress_pct: 30, status: "ativa", situation: "behind", remaining: 700, needed_per_week: 233.33, deadline: "2026-11-23" },
    { title: "ler", unit: "páginas", progress_pct: 100, status: "concluida", situation: "done", remaining: 0 },
  ],
};

const linhas = (el) =>
  [...el.querySelectorAll(".ia-quadro-linha")].map((l) => `${l.querySelector("dt").textContent} ${l.querySelector("dd").textContent}`.replace(/\s+/g, " "));

test(
  "quadro: finanças sem entrada no mês e metas com a situação",
  withDom("<!doctype html><body></body>", async () => {
    const { noQuadro } = await import("../../frontend/js/components/assistente-quadro.js");
    const fin = noQuadro({ nome: "finance_summary", dados: FIN });
    assert.equal(fin.querySelector(".ia-quadro-titulo").textContent, "11/2026");
    assert.deepEqual(linhas(fin), [
      "entrou R$ 0,00 (nada registrado ainda)",
      "saiu R$ 10,00 · mais em gasto (100%)",
      "previsto R$ 1.800,00 em 09/11",
      "nas contas R$ 0,00",
    ]);
    assert.ok(!fin.textContent.includes("resultado do mês"), "sem entrada não tem resultado do mês");

    const metas = noQuadro({ nome: "goals", dados: METAS });
    const meta = metas.querySelectorAll(".ia-quadro-meta");
    assert.equal(meta.length, 1, "só as ativas");
    assert.equal(meta[0].querySelector(".ia-quadro-meta-nome").textContent, "viagem");
    assert.equal(meta[0].querySelector(".ia-quadro-tag--atrasada").textContent, "atrasada");
    assert.equal(meta[0].querySelector(".bar-fill").style.width, "30%");
    assert.equal(meta[0].querySelector(":scope > .ia-quadro-extra").textContent.replace(/\s+/g, " "), "falta R$ 700,00 · R$ 233,33/semana · até 23/11");
    // cores do sistema: entrou sem nada fica neutro, saiu em vermelho, previsto em âmbar
    assert.equal(fin.querySelector(".ia-quadro-v--sai").textContent.replace(/\s+/g, " "), "R$ 10,00");
    assert.equal(fin.querySelector(".ia-quadro-v--previsto").textContent.replace(/\s+/g, " "), "R$ 1.800,00");
    assert.equal(fin.querySelector(".ia-quadro-v--entra"), null);
    assert.equal(noQuadro({ nome: "goals", dados: { goals: [] } }).querySelector(".ia-quadro-vazio").textContent, "nenhuma meta ativa");
    assert.equal(noQuadro({ nome: "inbox", dados: {} }), null);
  }),
);

test(
  "quadro: conversa reaberta põe o quadro na resposta que vem depois",
  withDom("<!doctype html><body></body>", async () => {
    const { deConversa } = await import("../../frontend/js/components/assistente-painel.js");
    const saida = deConversa([
      { papel: "usuario", texto: "estou gastando muito?" },
      { papel: "ferramenta", quadro: { nome: "finance_summary", dados: FIN } },
      { papel: "assistente", texto: "Ainda não entrou nada." },
      { papel: "usuario", texto: "e agora?" },
      { papel: "assistente", texto: "ok" },
    ]);
    assert.equal(saida.length, 4);
    assert.deepEqual(saida[1].quadros, [{ nome: "finance_summary", dados: FIN }]);
    assert.deepEqual(saida[1].ferramentas, ["finance_summary"]);
    assert.equal(saida[3].quadros, undefined);
  }),
);
