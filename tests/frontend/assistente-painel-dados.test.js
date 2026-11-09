// IA-03 — painel do assistente com dados: mostra o que foi consultado,
// desenha a resposta de cuidado do PRÓPRIO Kami (P-111) com o serviço do
// país (ou findahelpline) e as sugestões da tela aberta enviam a pergunta.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const PROVEDOR = { id: "p1", nome: "Ollama", modelo: "qwen2.5:7b", url_base: "http://localhost:11434/v1", local: true };
const ESTADO = {
  config: { ativo: true, escondido: false, provedor_id: "p1", teto_chamadas: 150, teto_tokens: 200000, max_rodadas: 6, guardar_conversas: true, dias_historico: 30 },
  provedor: PROVEDOR, pronto: true, falta: null, uso_hoje: { chamadas: 0, tokens: 0, estimado: false },
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
  "assistente: consultas, cuidado e sugestões",
  withDom(`<!doctype html><body><div class="nav-link" data-assistente role="button" tabindex="0">assistente kami</div></body>`, async (dom, t) => {
    const pedidos = [];
    let resposta = [];
    let aquecendo = false;
    const fetch = async (url, opts = {}) => {
      const u = new URL(url);
      const corpo = opts.body ? JSON.parse(opts.body) : undefined;
      pedidos.push({ caminho: u.pathname, corpo });
      if (u.pathname === "/api/assistente") return new Response(JSON.stringify(ESTADO), { headers: { "content-type": "application/json" } });
      if (u.pathname === "/api/assistente/aquecer" && (opts.method || "GET") === "GET") {
        return new Response(JSON.stringify({ aquecendo: aquecendo }), { headers: { "content-type": "application/json" } });
      }
      if (u.pathname === "/api/assistente/mensagens") {
        const corpo = resposta instanceof ReadableStream ? resposta : sse(resposta);
        return new Response(corpo, { headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 404 });
    };
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.CustomEvent = dom.window.CustomEvent;
    dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    t.mock.method(globalThis, "fetch", fetch);
    t.after(() => {
      delete globalThis.requestAnimationFrame;
      delete globalThis.CustomEvent;
    });
    const doc = dom.window.document;
    const $ = (s) => doc.querySelector(s);
    const { setTelaAtual } = await import("../../frontend/js/components/error-notice.js");
    const { abrirAssistente } = await import("../../frontend/js/components/assistente-painel.js");
    const ate = async (cond) => {
      for (let i = 0; i < 60 && !cond(); i++) await espera(20);
    };

    await t.test("na tela de finanças, as sugestões são de finanças e uma delas manda a pergunta", async () => {
      setTelaAtual("financas");
      await abrirAssistente();
      await espera(60);
      const chips = [...doc.querySelectorAll(".ia-sugestao")].map((b) => b.textContent);
      assert.deepEqual(chips, ["resuma meu mês", "o que vence nos próximos 7 dias?", "onde gastei mais este mês?", "o que dá pra fazer no Kami?"]);
      resposta = [
        { tipo: "inicio", conversa_id: "c1" },
        { tipo: "ferramenta", nome: "finance_summary" },
        { tipo: "ferramenta", nome: "largest_expenses" },
        { tipo: "ferramenta", nome: "finance_summary" },
        { tipo: "texto", delta: "Você gastou **R$ 900**." },
        { tipo: "fim", motivo: "fim" },
      ];
      doc.querySelectorAll(".ia-sugestao")[0].click();
      await ate(() => $("#ia-form").dataset.enviando === "false");
      assert.equal(pedidos.find((p) => p.caminho === "/api/assistente/mensagens").corpo.texto, "resuma meu mês");
      assert.match($(".ia-msg--kami .ia-consulta").textContent, /^consultou: resumo financeiro, maiores gastos · \d+ s$/);
      assert.equal($(".ia-msg--kami strong").textContent, "R$ 900");
    });

    await t.test("risco: a resposta é a do Kami, com o serviço do país", async () => {
      resposta = [
        { tipo: "inicio", conversa_id: "c1" },
        { tipo: "cuidado", servico: { nome: "CVV — Centro de Valorização da Vida", telefone: "188", site: "https://cvv.org.br", reserva: false } },
        { tipo: "fim", motivo: "cuidado" },
      ];
      $("#ia-texto").value = "quero me matar";
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await ate(() => $("#ia-form").dataset.enviando === "false");
      const box = doc.querySelector(".ia-msg--kami:last-child .ia-cuidado");
      assert.ok(box, "resposta de cuidado desenhada");
      assert.match(box.textContent, /não precisa lidar com isso sem apoio/);
      assert.equal(box.querySelector(".ia-cuidado-servico").textContent, "fale com CVV — Centro de Valorização da Vida: 188");
      assert.equal(box.querySelector("a").textContent, "cvv.org.br");
    });

    await t.test("país sem serviço na tabela: findahelpline", async () => {
      resposta = [
        { tipo: "cuidado", servico: { nome: "Find A Helpline", telefone: null, site: "https://findahelpline.com", reserva: true } },
        { tipo: "fim", motivo: "cuidado" },
      ];
      $("#ia-texto").value = "I want to die";
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await ate(() => $("#ia-form").dataset.enviando === "false");
      const box = doc.querySelector(".ia-msg--kami:last-child .ia-cuidado");
      assert.match(box.querySelector(".ia-cuidado-servico").textContent, /serviço de apoio gratuito/);
      assert.equal(box.querySelector("a").textContent, "findahelpline.com");
    });

    await t.test("IA-07a: modelo local aquece ao abrir; a resposta limpa pelo Kami substitui a que veio, sem \"confira\"", async () => {
      const aquecer = pedidos.find((p) => p.caminho === "/api/assistente/aquecer");
      assert.deepEqual(aquecer?.corpo, { tela: "financas", idioma: "pt" });
      resposta = [
        { tipo: "inicio", conversa_id: "c1" },
        { tipo: "ferramenta", nome: "finance_summary" },
        { tipo: "texto", delta: "Seu saldo é r$ 49.031." },
        { tipo: "conferido", texto: "Seu saldo é R$ 49.031." },
        { tipo: "fim", motivo: "fim" },
      ];
      $("#ia-texto").value = "estou gastando muito?";
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await ate(() => $("#ia-form").dataset.enviando === "false");
      const ultima = doc.querySelector(".ia-msg--kami:last-child");
      assert.equal(ultima.querySelector(".ia-msg-texto").textContent, "Seu saldo é R$ 49.031.");
      assert.match(ultima.textContent, /^(?!.*confira)/s, "o aviso \"confira\" saiu (teste do Emanuel)");
    });

    await t.test("IA-07a: 1ª pergunta durante o aquecimento mostra \"preparando o modelo\"", async () => {
      const enc = new TextEncoder();
      let ctrl;
      resposta = new ReadableStream({ start: (c) => { ctrl = c; } });
      t.after(() => { try { ctrl.close(); } catch { /* já fechado */ } });
      aquecendo = true;
      $("#ia-texto").value = "oi";
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const etapa = () => doc.querySelector(".ia-msg--kami:last-child .ia-etapa--agora")?.textContent || "";
      await ate(() => /preparando/.test(etapa()));
      assert.match(etapa(), /^preparando o modelo \(1ª pergunta\) · \d+ s$/);
      aquecendo = false;
      for (let i = 0; i < 100 && /preparando/.test(etapa()); i++) await espera(30);
      assert.match(etapa(), /^pensando/);
      ctrl.enqueue(enc.encode(`event: fim\ndata: ${JSON.stringify({ tipo: "fim", motivo: "fim" })}\n\n`));
      ctrl.close();
      await ate(() => $("#ia-form").dataset.enviando === "false");
    });

    await t.test("IA-07a: etapas com o tempo enquanto responde; no fim, uma linha com o tempo", async () => {
      const enc = new TextEncoder();
      let ctrl;
      const manda = (ev) => ctrl.enqueue(enc.encode(`event: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`));
      resposta = new ReadableStream({ start: (c) => { ctrl = c; } });
      t.after(() => { try { ctrl.close(); } catch { /* já fechado */ } });
      $("#ia-texto").value = "como estão minhas metas?";
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const etapas = () => [...doc.querySelectorAll(".ia-msg--kami:last-child .ia-etapa")].map((e) => e.textContent);
      await ate(() => etapas().length);
      assert.match(etapas()[0], /^pensando · \d+ s$/);
      manda({ tipo: "inicio", conversa_id: "c1" });
      manda({ tipo: "ferramenta", nome: "goals" });
      await ate(() => /consultando/.test(etapas().join()));
      assert.match(etapas()[0], /^consultando metas · \d+ s$/);
      manda({ tipo: "quadro", nome: "goals", dados: { goals: [] } });
      await ate(() => /lendo/.test(etapas().join()));
      assert.deepEqual(etapas().map((e) => e.replace(/\d+/, "N")), ["consultou metas", "lendo os dados · N s"]);
      manda({ tipo: "texto", delta: "Nenhuma meta ativa." });
      await ate(() => /escrevendo/.test(etapas().join()));
      manda({ tipo: "fim", motivo: "fim" });
      ctrl.close();
      await ate(() => $("#ia-form").dataset.enviando === "false");
      const ultima = doc.querySelector(".ia-msg--kami:last-child");
      assert.equal(ultima.querySelector(".ia-etapas"), null);
      assert.match(ultima.querySelector(".ia-consulta").textContent, /^consultou: metas · \d+ s$/);
      assert.ok(ultima.querySelector(".ia-quadro"), "o quadro fica");
    });
  })
);
