// IA-05a: a proposta de ações no chat. O modelo só propõe — o cartão
// mostra os itens (marcar, editar), "aplicar" manda as escolhas + edições,
// erro de um item marca a linha, e "desfazer" pergunta antes quando a
// pessoa mexeu em algum item depois. A conversa reaberta traz o cartão
// no mesmo lugar (deConversa).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const PROVEDOR = { id: "p1", nome: "Ollama", modelo: "qwen2.5:7b", url_base: "http://localhost:11434/v1", local: true };
const ESTADO = {
  config: { ativo: true, escondido: false, provedor_id: "p1", teto_chamadas: 150, teto_tokens: 200000, max_rodadas: 6, guardar_conversas: true, dias_historico: 30 },
  provedor: PROVEDOR, pronto: true, falta: null, uso_hoje: { chamadas: 0, tokens: 0, estimado: false },
};
const PROPOSTA = {
  estado: "pendente",
  itens: [
    { tipo: "nota", dados: { titulo: "ideias", conteudo: "- a", tags: [] }, entrada: null, problema: null },
    { tipo: "lembrete", dados: { titulo: "aluguel", data: "2026-11-05", hora: "08:30", repeticao: "mensal", dias_semana: [] }, entrada: { id: "e1", texto: "pagar aluguel dia 5" }, problema: null },
    { tipo: "habito", dados: { nome: "ler", frequencia: "diario", dias_semana: [], vezes_semana: 3, atributo: "inexistente" }, entrada: null, problema: "erro.habitos.atributo_desconhecido_atributo" },
    { tipo: "tarefa", dados: { texto: "comprar café" }, entrada: null, problema: null },
  ],
};

function sse(eventos) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const ev of eventos) ctrl.enqueue(enc.encode(`event: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`));
      ctrl.close();
    },
  });
}

const espera = (ms = 40) => new Promise((r) => setTimeout(r, ms));

test(
  "assistente: cartão da proposta — marcar, editar, aplicar, erro, desfazer",
  withDom(`<!doctype html><body></body>`, async (dom, t) => {
    const pedidos = [];
    let aplicarResposta = null;
    let lote = null;
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    const fetch = async (url, opts = {}) => {
      const u = new URL(url);
      pedidos.push({ caminho: u.pathname, corpo: opts.body ? JSON.parse(opts.body) : undefined });
      if (u.pathname === "/api/assistente") return json(ESTADO);
      if (u.pathname === "/api/assistente/mensagens") {
        return new Response(sse([
          { tipo: "inicio", conversa_id: "c1" },
          { tipo: "proposta", mensagem_id: "m1", proposta: structuredClone(PROPOSTA) },
          { tipo: "texto", delta: "Confira o cartão." },
          { tipo: "fim", motivo: "fim", uso_hoje: ESTADO.uso_hoje },
        ]), { headers: { "content-type": "text/event-stream" } });
      }
      if (u.pathname === "/api/assistente/propostas/aplicar") return aplicarResposta();
      if (u.pathname === "/api/assistente/lotes/l1") return json(lote);
      if (u.pathname === "/api/assistente/lotes/l1/desfazer") return json({ ...lote, desfeitos: 1, mantidos: 1, sumidos: 0 });
      return new Response("{}", { status: 404 });
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.localStorage = dom.window.localStorage;
    dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    t.mock.method(globalThis, "fetch", fetch);
    t.after(() => {
      delete globalThis.requestAnimationFrame;
      delete globalThis.CustomEvent;
      delete globalThis.localStorage;
    });
    const doc = dom.window.document;
    const $ = (s) => doc.querySelector(s);
    const $$ = (s) => [...doc.querySelectorAll(s)];
    const ate = async (cond) => {
      for (let i = 0; i < 60 && !cond(); i++) await espera(20);
    };
    const clicar = (el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const mudar = (el, valor) => {
      if (typeof valor === "boolean") el.checked = valor;
      else el.value = valor;
      el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    };
    const { abrirAssistente, deConversa } = await import("../../frontend/js/components/assistente-painel.js");

    await abrirAssistente();
    await espera(60);
    $("#ia-texto").value = "organiza minha caixa";
    $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");

    await t.test("o cartão aparece na resposta, com o item com problema desmarcado", () => {
      const itens = $$(".ia-proposta .ia-prop-item");
      assert.equal(itens.length, 4);
      const marcados = itens.map((li) => li.querySelector('[data-prop="marcar"]').checked);
      assert.deepEqual(marcados, [true, true, false, true]);
      assert.match(itens[2].querySelector(".ia-prop-problema").textContent, /atributo desconhecido/);
      assert.match(itens[1].querySelector(".ia-prop-entrada").textContent, /pagar aluguel dia 5/);
      assert.equal($("#ia-prop-1-repeticao").value, "mensal");
      assert.match($('[data-prop="aplicar"]').textContent, /\(3\)/);
      // nada foi gravado: nenhuma chamada de aplicar
      assert.ok(!pedidos.some((p) => p.caminho.startsWith("/api/assistente/propostas")));
      // a resposta da proposta pendente ainda pode ser refeita
      assert.ok($$(".ia-msg--kami:last-child .ia-acoes .ia-acao").some((b) => b.dataset.ia === "refazer"));
    });

    await t.test("editar e desmarcar mudam o que vai pro aplicar; erro marca a linha", async () => {
      mudar($("#ia-prop-0-titulo"), "ideias do TCC");
      mudar($('.ia-prop-item[data-item="1"] [data-prop="marcar"]'), false);
      mudar($('.ia-prop-item[data-item="3"] [data-prop="marcar"]'), false);
      assert.match($('[data-prop="aplicar"]').textContent, /\(1\)/);
      // repetir "dias da semana" mostra os dias
      mudar($("#ia-prop-2-frequencia"), "dias");
      assert.equal($$('.ia-prop-item[data-item="2"] [data-campo="dias_semana"]').length, 7);
      mudar($('.ia-prop-item[data-item="2"] [data-prop="marcar"]'), true);
      aplicarResposta = () => json({ status: 422, chave: "erro.comum.escolha_pelo_menos_dia_semana", detail: "x", vars: { indice: 2 } }, 422);
      clicar($('[data-prop="aplicar"]'));
      await ate(() => $('.ia-prop-item[data-item="2"] .ia-prop-problema'));
      const corpo = pedidos.filter((p) => p.caminho === "/api/assistente/propostas/aplicar").at(-1).corpo;
      assert.equal(corpo.conversa_id, "c1");
      assert.equal(corpo.mensagem_id, "m1");
      assert.deepEqual(corpo.itens.map((i) => i.indice), [0, 2]);
      assert.equal(corpo.itens[0].dados.titulo, "ideias do TCC");
      assert.match($('.ia-prop-item[data-item="2"] .ia-prop-problema').textContent, /dia da semana/);
    });

    await t.test("aplicado: o cartão trava, some o refazer e aparece o desfazer", async () => {
      mudar($('.ia-prop-item[data-item="2"] [data-prop="marcar"]'), false);
      // como o backend: a proposta volta com os itens como a pessoa deixou
      aplicarResposta = () => {
        const corpo = pedidos.filter((p) => p.caminho === "/api/assistente/propostas/aplicar").at(-1).corpo;
        const itens = structuredClone(PROPOSTA.itens);
        for (const e of corpo.itens) itens[e.indice].dados = e.dados;
        return json({ proposta: { ...PROPOSTA, itens, estado: "aplicada", aplicados: corpo.itens.map((e) => e.indice), lote_id: "l1" }, lote: {} });
      };
      clicar($('[data-prop="aplicar"]'));
      await ate(() => $(".ia-proposta--aplicada"));
      assert.ok($(".ia-proposta--aplicada"));
      // fechada: cada item vira uma linha de informação, sem campos
      assert.equal($$(".ia-proposta input, .ia-proposta select, .ia-proposta textarea").length, 0);
      const linhas = $$(".ia-proposta .ia-prop-item--resumo");
      assert.equal(linhas.length, 4);
      assert.equal(linhas[0].querySelector(".ia-prop-sinal").textContent, "[x]");
      assert.match(linhas[0].querySelector(".ia-prop-principal").textContent, /ideias do TCC/);
      assert.ok(linhas[1].classList.contains("ia-prop-item--fora")); // desmarcado: não foi aplicado
      assert.match(linhas[1].querySelector(".ia-prop-detalhe").textContent, /05\/11\/2026 08:30 · todo mês/);
      assert.ok($('[data-prop="desfazer"]'));
      assert.ok(!$$(".ia-msg--kami:last-child .ia-acoes .ia-acao").some((b) => b.dataset.ia === "refazer"));
    });

    await t.test("desfazer com item mexido pergunta e manda a escolha", async () => {
      lote = { id: "l1", desfeito_em: null, itens: [{ tipo: "nota", titulo: "a", situacao: "intacto" }, { tipo: "habito", titulo: "b", situacao: "editado" }] };
      clicar($('[data-prop="desfazer"]'));
      await ate(() => $(".ia-prop-confirma"));
      assert.match($(".ia-prop-confirma p").textContent, /1 itens foram mexidos/);
      assert.ok($('[data-prop="desfazer-tudo"]'));
      clicar($('[data-prop="desfazer-sim"]'));
      await ate(() => $(".ia-proposta--desfeita"));
      const pedido = pedidos.filter((p) => p.caminho === "/api/assistente/lotes/l1/desfazer").at(-1);
      assert.deepEqual(pedido.corpo, { apagar_editados: false });
      assert.ok(!$('[data-prop="desfazer"]'));
    });

    await t.test("a mensagem seguinte não cai dentro do cartão anterior", async () => {
      $("#ia-texto").value = "e mais isso";
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
      assert.equal($$(".ia-mensagens > .ia-msg").length, 4);
      assert.equal($$(".ia-proposta .ia-msg").length, 0);
      assert.equal($$(".ia-mensagens > .ia-msg")[1].querySelectorAll(".ia-prop-item").length, 4);
    });

    await t.test("conversa reaberta: a proposta entra na resposta seguinte", () => {
      const msgs = deConversa([
        { id: "u", papel: "usuario", texto: "faz", interrompida: false },
        { id: "m1", papel: "ferramenta", proposta: { ...PROPOSTA } },
        { id: "a", papel: "assistente", texto: "confira", interrompida: false },
        { id: "u2", papel: "usuario", texto: "de novo", interrompida: false },
        { id: "m2", papel: "ferramenta", proposta: { ...PROPOSTA, estado: "descartada" } },
        { id: "u3", papel: "usuario", texto: "e aí", interrompida: false },
      ]);
      assert.deepEqual(msgs.map((m) => m.papel), ["usuario", "assistente", "usuario", "assistente", "usuario"]);
      assert.equal(msgs[1].proposta.mensagem_id, "m1");
      assert.equal(msgs[1].texto, "confira");
      assert.equal(msgs[3].proposta.mensagem_id, "m2");
      assert.equal(msgs[3].texto, "");
    });
  })
);
