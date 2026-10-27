// Retorno do teste da F3: continuar/refazer a última resposta, copiar,
// bloco de código com linguagem (diagrama em texto), dados consultados
// recolhidos em "o que foi enviado" e a largura do painel (até metade da
// tela, pelo teclado também).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const PROVEDOR = { id: "p1", nome: "Ollama", modelo: "qwen2.5:7b", url_base: "http://localhost:11434/v1", local: true };
const ESTADO = {
  config: { ativo: true, escondido: false, provedor_id: "p1", teto_chamadas: 150, teto_tokens: 200000, max_rodadas: 6, guardar_conversas: true, dias_historico: 30 },
  provedor: PROVEDOR, pronto: true, falta: null, uso_hoje: { chamadas: 0, tokens: 0, estimado: false },
};
const RESULTADO = '<dados ferramenta="month_overview">\n{"month": "2026-10", "goals": [{"title": "viagem"}]}\n</dados>\n(Kami data.)';
const ENVIOS = [{
  created_at: "2026-10-27T14:14:00-03:00", provedor: "Ollama", modelo: "qwen2.5:7b", local: true, destino: "localhost",
  tokens_entrada: 10, tokens_saida: 5,
  itens: [{ tipo: "continuar" }, { tipo: "ferramenta", nome: "month_overview", argumentos: { month: "2026-10" }, resultado: RESULTADO }],
}];

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
  "assistente: continuar, refazer, copiar, código, envios e largura",
  withDom(`<!doctype html><body><div class="nav-link" data-assistente role="button" tabindex="0">assistente kami</div></body>`, async (dom, t) => {
    const pedidos = [];
    let resposta = [];
    let copiado = null;
    const fetch = async (url, opts = {}) => {
      const u = new URL(url);
      pedidos.push({ caminho: u.pathname, corpo: opts.body ? JSON.parse(opts.body) : undefined });
      const json = (v) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (u.pathname === "/api/assistente") return json(ESTADO);
      if (u.pathname === "/api/assistente/envios") return json(ENVIOS);
      if (u.pathname === "/api/assistente/mensagens") return new Response(sse(resposta), { headers: { "content-type": "text/event-stream" } });
      return new Response("{}", { status: 404 });
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.localStorage = dom.window.localStorage;
    dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    t.mock.method(globalThis, "fetch", fetch);
    Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (s) => { copiado = s; } }, configurable: true });
    t.after(() => {
      delete globalThis.requestAnimationFrame;
      delete globalThis.CustomEvent;
      delete globalThis.localStorage;
      delete globalThis.navigator.clipboard;
    });
    const doc = dom.window.document;
    const $ = (s) => doc.querySelector(s);
    const { abrirAssistente } = await import("../../frontend/js/components/assistente-painel.js");
    const ate = async (cond) => {
      for (let i = 0; i < 60 && !cond(); i++) await espera(20);
    };
    const perguntar = async (texto) => {
      $("#ia-texto").value = texto;
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await espera(20);
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
    };
    const ultimoPedido = () => pedidos.filter((p) => p.caminho === "/api/assistente/mensagens").at(-1).corpo;
    const acoes = () => [...doc.querySelectorAll(".ia-msg--kami:last-child .ia-acoes .ia-acao")].map((b) => b.dataset.ia);

    await abrirAssistente();
    await espera(60);

    await t.test("bloco de código mostra a linguagem e copia só o código", async () => {
      resposta = [
        { tipo: "inicio", conversa_id: "c1" },
        { tipo: "texto", delta: "Fluxo:\n\n```text\n┌──┐\n│xp│\n└──┘\n```" },
        { tipo: "fim", motivo: "fim" },
      ];
      await perguntar("desenha o fluxo");
      const caixa = $(".ia-msg--kami .ia-codigo");
      assert.equal(caixa.querySelector(".ia-codigo-cab span").textContent, "text");
      caixa.querySelector('[data-ia="copiar-codigo"]').click();
      await espera(20);
      assert.equal(copiado, "┌──┐\n│xp│\n└──┘");
      assert.match(caixa.querySelector('[data-ia="copiar-codigo"]').textContent, /copiado/);
    });

    await t.test("resposta completa: copiar e refazer (sem continuar)", async () => {
      assert.deepEqual(acoes(), ["copiar", "refazer"]);
      $('.ia-msg--kami:last-child [data-ia="copiar"]').click();
      await espera(20);
      assert.match(copiado, /^Fluxo:/);
    });

    await t.test("refazer troca a última resposta e manda só a ação", async () => {
      resposta = [{ tipo: "inicio", conversa_id: "c1" }, { tipo: "texto", delta: "outra versão" }, { tipo: "fim", motivo: "fim" }];
      $('[data-ia="refazer"]').click();
      await espera(20);
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
      assert.deepEqual({ ...ultimoPedido(), tela: undefined, idioma: undefined }, { texto: "", acao: "refazer", conversa_id: "c1", tela: undefined, idioma: undefined });
      const kami = [...doc.querySelectorAll(".ia-msg--kami .ia-msg-texto")].map((e) => e.textContent);
      assert.deepEqual(kami, ["outra versão"]);
      assert.equal(doc.querySelectorAll(".ia-msg--usuario").length, 1);
    });

    await t.test("cortada pelo limite: continuar emenda o texto na mesma resposta", async () => {
      resposta = [{ tipo: "inicio", conversa_id: "c1" }, { tipo: "texto", delta: "começo" }, { tipo: "fim", motivo: "limite" }];
      await perguntar("explica tudo");
      assert.ok($(".ia-msg--kami:last-child .ia-interrompida"));
      assert.deepEqual(acoes(), ["copiar", "continuar", "refazer"]);
      // só a última resposta tem continuar/refazer
      assert.deepEqual([...doc.querySelectorAll(".ia-msg--kami")[0].querySelectorAll(".ia-acoes .ia-acao")].map((b) => b.dataset.ia), ["copiar"]);
      resposta = [{ tipo: "inicio", conversa_id: "c1" }, { tipo: "texto", delta: " e fim." }, { tipo: "fim", motivo: "fim" }];
      $('[data-ia="continuar"]').click();
      await espera(20);
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
      assert.equal(ultimoPedido().acao, "continuar");
      assert.equal($(".ia-msg--kami:last-child .ia-msg-texto").textContent, "começo e fim.");
      assert.equal($(".ia-msg--kami:last-child .ia-interrompida"), null);
      assert.deepEqual(acoes(), ["copiar", "refazer"]);
    });

    await t.test("o que foi enviado: dados recolhidos, com o JSON indentado", async () => {
      $('[data-ia="envios"]').click();
      await ate(() => $(".ia-envios"));
      const det = $(".ia-dados");
      assert.equal(det.open, false);
      assert.match(det.querySelector("summary").textContent, /dados consultados \(visão do mês\) \(month: 2026-10\)\s+· \d+ caracteres/);
      assert.equal(det.querySelector("pre").textContent.split("\n")[0], '<dados ferramenta="month_overview">');
      assert.match(det.querySelector("pre").textContent, /\n {2}"month": "2026-10",\n/);
      assert.match($(".ia-envios").textContent, /pedido pra continuar a resposta cortada/);
    });

    await t.test("largura: setas, Home/End (até metade da tela) e fica guardada", async () => {
      const painel = $("#ia-painel");
      const alca = $(".ia-alca");
      const largura = () => painel.style.getPropertyValue("--ia-largura");
      const tecla = (key) => alca.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }));
      assert.equal(largura(), "440px");
      tecla("ArrowLeft");
      assert.equal(largura(), "464px");
      tecla("End");
      assert.equal(largura(), `${Math.floor(dom.window.innerWidth / 2)}px`);
      tecla("ArrowLeft"); // não passa da metade
      assert.equal(largura(), `${Math.floor(dom.window.innerWidth / 2)}px`);
      tecla("Home");
      assert.equal(largura(), "360px");
      assert.equal(dom.window.localStorage.getItem("kami.assistente.largura"), "360");
      alca.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
      assert.equal(largura(), "440px");
    });
  })
);
