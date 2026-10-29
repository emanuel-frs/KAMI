// IA-05b no cartão: conta e forma do lote no topo (P-136), lançamento que
// parece repetido vem desmarcado (P-129), o plano de estudo depende da
// trilha (P-138) e, fechado, cada item vira uma linha de informação.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const CONTAS = [
  { id: "c1", nome: "conta", banco: "Nubank", saldo: true, credito: true },
  { id: "c2", nome: "corrente", banco: "Inter", saldo: true, credito: false },
];
const proposta = () => ({
  mensagem_id: "m1",
  estado: "pendente",
  contas: CONTAS,
  conta_id: "c1",
  forma: null,
  itens: [
    { tipo: "lancamento", dados: { descricao: "mercado", valor: 120.5, tipo: "saida", categoria: "alimentação", data: "2026-10-20" },
      linha: "20/10 SUPERMERCADO 120,50", problema: "erro.assistente.escolha_a_forma", aviso: null },
    { tipo: "lancamento", dados: { descricao: "uber", valor: 23.9, tipo: "saida", categoria: "transporte", data: "2026-10-21" },
      problema: null, aviso: "assistente.proposta.parece_repetido" },
    { tipo: "trilha", dados: { nome: "Rust", objetivo: "um CLI" }, problema: null, aviso: null },
    { tipo: "marco", depende: 2, dados: { titulo: "o livro", descricao: "", data: "2026-11-10" }, problema: null, aviso: null },
    { tipo: "meta", depende: 2, dados: { titulo: "Rust", tipo: "aprendizado", alvo: 1, rotulo: "", prazo: "2026-11-10", peso: "medio", conta_id: "" },
      problema: null, aviso: null },
    { tipo: "meta", dados: { titulo: "reserva", tipo: "financeira", alvo: 5000, rotulo: "", prazo: "", peso: "medio", conta_id: "" },
      problema: null, aviso: null },
  ],
});

test(
  "assistente: cartão com lançamentos, plano e meta",
  withDom(`<!doctype html><body><div id="raiz"></div></body>`, async (dom, t) => {
    const pedidos = [];
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
      const corpo = opts.body ? JSON.parse(opts.body) : undefined;
      pedidos.push({ caminho: new URL(url).pathname, corpo });
      const p = proposta();
      for (const e of corpo?.itens || []) p.itens[e.indice].dados = e.dados;
      return json({ proposta: { ...p, estado: "aplicada", aplicados: corpo.itens.map((e) => e.indice), lote_id: "l1",
        conta_id: corpo.conta_id, forma: corpo.forma_pagamento }, lote: {} });
    });
    globalThis.CustomEvent = dom.window.CustomEvent;
    t.after(() => delete globalThis.CustomEvent);
    const doc = dom.window.document;
    const $ = (s) => doc.querySelector(s);
    const $$ = (s) => [...doc.querySelectorAll(s)];
    const mudar = (el, valor) => {
      if (typeof valor === "boolean") el.checked = valor;
      else el.value = valor;
      el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    };
    const { noProposta } = await import("../../frontend/js/components/assistente-proposta.js");
    const p = proposta();
    let mudou = 0;
    $("#raiz").append(noProposta(p, { conversaId: "c-1", aoMudar: () => mudou++ }));
    const item = (i) => $(`.ia-prop-item[data-item="${i}"]`);
    const marcado = (i) => item(i).querySelector('[data-prop="marcar"]').checked;

    await t.test("topo: conta do lote; forma só aparece pra conta com saldo E crédito", () => {
      assert.equal($("#ia-prop-lote-conta_id").value, "c1");
      assert.ok($("#ia-prop-lote-forma"));
      assert.deepEqual([0, 1, 2, 3, 4, 5].map(marcado), [false, false, true, true, true, true]);
      assert.match(item(0).querySelector(".ia-prop-entrada").textContent, /SUPERMERCADO/);
      assert.match(item(1).querySelector(".ia-prop-aviso").textContent, /mesma data e valor/);
      // escolher a forma limpa o problema que dependia dela
      mudar($("#ia-prop-lote-forma"), "credito");
      assert.equal(p.forma, "credito");
      assert.equal(item(0).querySelector(".ia-prop-problema"), null);
      // conta só com saldo: a forma some
      mudar($("#ia-prop-lote-conta_id"), "c2");
      assert.equal($("#ia-prop-lote-forma"), null);
      assert.equal(p.forma, null);
      mudar($("#ia-prop-lote-conta_id"), "c1");
      mudar($("#ia-prop-lote-forma"), "saldo");
    });

    await t.test("plano: desmarcar a trilha desmarca e trava marco e meta", () => {
      mudar(item(2).querySelector('[data-prop="marcar"]'), false);
      assert.equal(marcado(3), false);
      assert.ok(item(3).querySelector('[data-prop="marcar"]').disabled);
      assert.ok(item(4).querySelector('[data-prop="marcar"]').disabled);
      mudar(item(2).querySelector('[data-prop="marcar"]'), true);
      assert.equal(marcado(3), true);
      assert.ok(item(3).classList.contains("ia-prop-item--dep"));
      // meta de aprendizado não tem tipo nem alvo (o alvo é o nº de marcos)
      assert.equal($("#ia-prop-4-tipo"), null);
      assert.equal($("#ia-prop-4-alvo"), null);
      // meta financeira: sem unidade, com a conta ligada opcional
      assert.equal($("#ia-prop-5-rotulo"), null);
      assert.equal($$("#ia-prop-5-conta_id option").length, 3);
    });

    await t.test("aplicar manda conta, forma e edições; fechado vira resumo", async () => {
      mudar(item(0).querySelector('[data-prop="marcar"]'), true);
      mudar($("#ia-prop-0-valor"), "99,9");
      mudar($("#ia-prop-5-tipo"), "leitura");
      assert.ok($("#ia-prop-5-rotulo"), "trocar o tipo redesenha os campos");
      $('[data-prop="aplicar"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      for (let k = 0; k < 50 && !mudou; k++) await new Promise((r) => setTimeout(r, 10));
      const corpo = pedidos.at(-1).corpo;
      assert.equal(corpo.conta_id, "c1");
      assert.equal(corpo.forma_pagamento, "saldo");
      assert.deepEqual(corpo.itens.map((e) => e.indice), [0, 2, 3, 4, 5]);
      assert.equal(corpo.itens[0].dados.valor, 99.9);
      assert.equal(corpo.itens[4].dados.tipo, "leitura");
      assert.equal(mudou, 1);
      // o painel redesenharia; aqui redesenha um cartão novo do mesmo `p`
      $("#raiz").replaceChildren(noProposta(p, { conversaId: "c-1" }));
      const linhas = $$(".ia-prop-item--resumo");
      assert.equal(linhas.length, 6);
      assert.match(linhas[0].querySelector(".ia-prop-detalhe").textContent, /− R\$\s?99,90 · alimentação · 20\/10\/2026/);
      assert.ok(linhas[1].classList.contains("ia-prop-item--fora"));
      assert.ok(linhas[3].classList.contains("ia-prop-item--dep"));
      assert.match(linhas[5].querySelector(".ia-prop-detalhe").textContent, /leitura · 5000/);
    });

    await t.test("erro de saldo mostra os valores na moeda (não \"27.5\")", () => {
      const q = proposta();
      q.erros = { 1: { chave: "erro.finance_utils.saldo_insuficiente_disponivel_valor_saldo", vars: { valor_saldo_atual: 0, valor_amount: 27.5 } } };
      $("#raiz").replaceChildren(noProposta(q, { conversaId: "c-1" }));
      assert.match(item(1).querySelector(".ia-prop-problema").textContent, /disponível R\$\s?0,00, tentando gastar R\$\s?27,50/);
    });
  })
);
