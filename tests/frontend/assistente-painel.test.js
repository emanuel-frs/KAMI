// IA-02 — painel do assistente (components/assistente-painel.js) contra um
// backend falso que responde a mensagem em SSE de verdade (ReadableStream):
// abre pelo item do menu, mostra o que falta quando não está pronto, manda
// a mensagem com tela e idioma, desenha a resposta aos poucos (markdown sem
// HTML), parar aborta, erro do provedor aparece traduzido, histórico e
// "o que foi enviado" abrem, Esc fecha e devolve o foco, e o item do menu
// some com "esconder o botão".
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const PROVEDOR = { id: "p1", nome: "Ollama", modelo: "qwen2.5:7b", url_base: "http://localhost:11434/v1", local: true };
const CONFIG = { ativo: true, escondido: false, provedor_id: "p1", teto_chamadas: 150, teto_tokens: 200000, max_rodadas: 6, guardar_conversas: true, dias_historico: 30 };

function sse(eventos, { atraso = 0, signal } = {}) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(ctrl) {
      for (const ev of eventos) {
        if (atraso) await new Promise((r) => setTimeout(r, atraso));
        if (signal?.aborted) {
          ctrl.error(new DOMException("aborted", "AbortError")); // como o fetch de verdade ao abortar
          return;
        }
        try {
          ctrl.enqueue(enc.encode(`event: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`));
        } catch {
          return; // a leitura foi cancelada (parar)
        }
      }
      ctrl.close();
    },
  });
}

function backendFalso() {
  const estado = { pronto: true, falta: null, config: { ...CONFIG }, resposta: null, pedidos: [] };
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const metodo = (opts.method || "GET").toUpperCase();
    const corpo = opts.body ? JSON.parse(opts.body) : undefined;
    estado.pedidos.push({ metodo, caminho: u.pathname, corpo });
    const json = (dado, status = 200) => new Response(JSON.stringify(dado), { status, headers: { "content-type": "application/json" } });
    if (metodo === "GET" && u.pathname === "/api/assistente") {
      return json({ config: estado.config, provedor: estado.pronto ? PROVEDOR : null, pronto: estado.pronto, falta: estado.falta, uso_hoje: { chamadas: 3, tokens: 100, estimado: false } });
    }
    if (metodo === "POST" && u.pathname === "/api/assistente/mensagens") {
      const r = estado.resposta;
      if (r.status) return json(r.corpo, r.status);
      return new Response(sse(r.eventos, { atraso: r.atraso, signal: opts.signal }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (metodo === "GET" && u.pathname === "/api/assistente/conversas") {
      return json([{ id: "c1", titulo: "quanto gastei?", updated_at: "2026-10-26T10:00:00-03:00", guardada: true, n: 2 }]);
    }
    if (metodo === "GET" && u.pathname === "/api/assistente/conversas/c1") {
      return json({ id: "c1", titulo: "quanto gastei?", mensagens: [{ papel: "usuario", texto: "quanto gastei?" }, { papel: "assistente", texto: "não vejo seus dados ainda", interrompida: false, erro_chave: null }] });
    }
    if (metodo === "GET" && u.pathname === "/api/assistente/envios") {
      return json([{ created_at: "2026-10-26T10:00:00-03:00", provedor: "Ollama", modelo: "qwen2.5:7b", destino: "localhost", local: true, tokens_entrada: 10, tokens_saida: 5,
        itens: [{ tipo: "instrucoes", versao: "v1" }, { tipo: "historico", mensagens: 0 }, { tipo: "mensagem", texto: "quanto gastei?" }] }]);
    }
    return json({ detail: `rota falsa ausente: ${metodo} ${u.pathname}` }, 404);
  };
  return { estado, fetch };
}

const espera = (ms = 40) => new Promise((r) => setTimeout(r, ms));

test(
  "assistente: painel contra um backend falso com SSE",
  withDom(`<!doctype html><body><nav><div class="nav-link" data-assistente role="button" tabindex="0" aria-expanded="false">assistente kami</div></nav><button id="antes">x</button></body>`, async (dom, t) => {
    const back = backendFalso();
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    t.mock.method(globalThis, "fetch", back.fetch);
    t.after(() => {
      delete globalThis.requestAnimationFrame;
      delete globalThis.CustomEvent;
      delete globalThis.getComputedStyle;
    });
    const doc = dom.window.document;
    const $ = (s) => doc.querySelector(s);
    const { wireAssistente, abrirAssistente, fecharAssistente } = await import("../../frontend/js/components/assistente-painel.js");
    const { setTelaAtual } = await import("../../frontend/js/components/error-notice.js");
    setTelaAtual("financas");
    await wireAssistente();

    const enviar = async (texto) => {
      $("#ia-texto").value = texto;
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    };
    const ate = async (cond, max = 60) => {
      for (let i = 0; i < max && !cond(); i++) await espera(20);
    };

    await t.test("o item do menu abre o painel com o provedor em uso e o foco na caixa", async () => {
      $("#antes").focus();
      $(".nav-link[data-assistente]").click();
      await espera(60);
      assert.equal($("#ia-painel").hidden, false);
      assert.equal($(".nav-link[data-assistente]").getAttribute("aria-expanded"), "true");
      assert.match($("#ia-provedor").textContent, /Ollama · qwen2\.5:7b · local/);
      assert.match($("#ia-provedor").textContent, /3/);
      assert.equal(doc.activeElement.id, "ia-texto");
    });

    await t.test("manda a mensagem com tela e idioma e desenha a resposta aos poucos, sem virar HTML", async () => {
      back.estado.resposta = {
        eventos: [
          { tipo: "inicio", conversa_id: "c9", provedor: "Ollama", modelo: "qwen2.5:7b", local: true },
          { tipo: "texto", delta: "você gastou **pouco**" },
          { tipo: "texto", delta: " <img src=x onerror=alert(1)>" },
          { tipo: "fim", motivo: "fim", uso_hoje: { chamadas: 4, tokens: 120, estimado: false } },
        ],
      };
      await enviar("quanto gastei?");
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
      const pedido = back.estado.pedidos.find((p) => p.caminho === "/api/assistente/mensagens");
      assert.deepEqual(pedido.corpo, { texto: "quanto gastei?", conversa_id: null, tela: "financas", idioma: "pt" });
      const resposta = doc.querySelector(".ia-msg--kami:last-child");
      assert.equal(resposta.querySelector("strong")?.textContent, "pouco");
      assert.equal(resposta.querySelector("img"), null, "texto do modelo nunca vira HTML");
      assert.match(resposta.textContent, /<img src=x/);
      assert.match($("#ia-provedor").textContent, /4/, "uso do dia atualizado pelo fim");
      assert.equal($("#ia-texto").value, "");
    });

    await t.test("a próxima mensagem continua a mesma conversa", async () => {
      back.estado.resposta = { eventos: [{ tipo: "texto", delta: "ok" }, { tipo: "fim", motivo: "fim" }] };
      await enviar("e no mês passado?");
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
      const pedidos = back.estado.pedidos.filter((p) => p.caminho === "/api/assistente/mensagens");
      assert.equal(pedidos.at(-1).corpo.conversa_id, "c9");
      assert.equal(doc.querySelectorAll(".ia-msg").length, 4);
    });

    await t.test("parar aborta e marca a resposta como interrompida", async () => {
      back.estado.resposta = { eventos: Array.from({ length: 40 }, (_, i) => ({ tipo: "texto", delta: `p${i} ` })), atraso: 15 };
      await enviar("conta tudo");
      await ate(() => doc.querySelector(".ia-msg--kami:last-child")?.textContent.includes("p2"));
      assert.equal($("#ia-form").getAttribute("aria-busy"), "true");
      $("#ia-enviar").click(); // no meio, o botão é "parar"
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
      const ultima = doc.querySelector(".ia-msg--kami:last-child");
      assert.ok(ultima.querySelector(".ia-interrompida"));
      assert.ok(!ultima.textContent.includes("p39"));
    });

    await t.test("erro do provedor aparece traduzido, com o que o provedor disse", async () => {
      back.estado.resposta = {
        eventos: [
          { tipo: "inicio", conversa_id: "c9" },
          { tipo: "falha", status: 422, chave: "erro.assistente.provedor.chave_invalida", vars: { detalhe: "Invalid API Key" } },
        ],
      };
      await enviar("oi");
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
      const erro = doc.querySelector(".ia-msg--kami:last-child .ia-falha");
      assert.match(erro.textContent, /recusou a chave/);
      assert.match(erro.textContent, /Invalid API Key/);
      assert.ok(erro.querySelector('[data-ia="configurar"]'));
    });

    await t.test("recusa antes do streaming (teto) também aparece na conversa", async () => {
      back.estado.resposta = { status: 429, corpo: { detail: "teto", chave: "erro.assistente.teto.chamadas", vars: { usado: 150, teto: 150 } } };
      await enviar("mais uma");
      await ate(() => $("#ia-form").getAttribute("aria-busy") === "false");
      assert.match(doc.querySelector(".ia-msg--kami:last-child .ia-falha").textContent, /teto de 150 chamadas/);
    });

    await t.test("histórico abre a conversa guardada; 'o que foi enviado' lista o registro", async () => {
      $('[data-ia="historico"]').click();
      await espera(60);
      assert.match($(".ia-lista").textContent, /quanto gastei\?/);
      $('.ia-lista [data-ia="abrir"]').click();
      await espera(60);
      assert.match(doc.querySelector(".ia-msg--kami").textContent, /não vejo seus dados ainda/);
      $('[data-ia="envios"]').click();
      await espera(60);
      assert.match($(".ia-envios").textContent, /instruções do Kami \(versão v1\)/);
      assert.match($(".ia-envios").textContent, /nenhuma mensagem anterior/);
      assert.match($(".ia-envios").textContent, /sua mensagem: quanto gastei\?/);
    });

    await t.test("Esc volta pra conversa, depois fecha e devolve o foco", async () => {
      $("#ia-corpo").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      assert.equal($("#ia-painel").hidden, false);
      assert.equal($("#ia-form").hidden, false);
      $("#ia-texto").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      assert.equal($("#ia-painel").hidden, true);
      assert.equal(doc.activeElement.id, "antes");
    });

    await t.test("desligado: o painel diz o que falta e não mostra a caixa", async () => {
      back.estado.pronto = false;
      back.estado.falta = "desligado";
      await abrirAssistente();
      await espera(40);
      assert.equal($("#ia-form").hidden, true);
      assert.match($("#ia-corpo").textContent, /desligado/);
      assert.ok($('#ia-corpo [data-ia="configurar"]'));
      fecharAssistente();
    });

    await t.test("esconder o botão some com o item do menu", async () => {
      dom.window.dispatchEvent(new dom.window.CustomEvent("kami:assistente-config", { detail: { config: { ...CONFIG, escondido: true }, pronto: true, provedor: PROVEDOR, uso_hoje: { chamadas: 0 } } }));
      assert.equal($(".nav-link[data-assistente]").hidden, true);
    });
  })
);
