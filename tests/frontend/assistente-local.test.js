// IA-07a — configurações › assistente › IA no computador: máquina,
// recomendação, modelos do Ollama (usar, remover com confirmação), baixar
// com andamento e cancelar, LM Studio, Ollama em outro computador.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const espera = (n = 12) => Array.from({ length: n }).reduce((p) => p.then(() => new Promise((r) => setTimeout(r, 0))), Promise.resolve());
const json = (status, body) => new Response(JSON.stringify(body ?? null), { status, headers: { "content-type": "application/json" } });

function estadoBase() {
  return {
    maquina: { ram_gb: 14.9, disco_livre_gb: 346.7, sistema: "Linux 7.4.0", processador: "AMD Ryzen 5 4600G", nucleos: 12, gpu: null },
    recomendacao: { ram_min_gb: 8, modelo: "qwen3.5:4b", download_gb: 3.3, disco_gb: 3.3, ram_uso_gb: 5, velocidade: "media" },
    faixas: [
      { ram_min_gb: 8, modelo: "qwen3.5:4b", download_gb: 3.3, disco_gb: 3.3, ram_uso_gb: 5, velocidade: "media" },
      { ram_min_gb: 16, modelo: "qwen3.5:9b", download_gb: 6.6, disco_gb: 6.6, ram_uso_gb: 9, velocidade: "lenta" },
    ],
    ram_min_gb: 8,
    ollama: {
      instalado: true, rodando: true, versao: "0.40.13", url: "http://127.0.0.1:11434",
      modelos: [
        { nome: "qwen3.5:4b", tamanho_gb: 3.3, parametros: "4.2B", ferramentas: true },
        { nome: "velho:1b", tamanho_gb: 1.3, parametros: "1B", ferramentas: false },
      ],
    },
    lmstudio: { rodando: true, url: "http://127.0.0.1:1234", modelos: ["gemma-local"] },
    baixando: null,
  };
}

async function montar(dom, t, server) {
  globalThis.CustomEvent = dom.window.CustomEvent;
  t.after(() => delete globalThis.CustomEvent);
  t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
    const caminho = decodeURIComponent(new URL(url).pathname);
    const metodo = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : {};
    server.chamadas.push(`${metodo} ${caminho}`);
    if (caminho === "/api/assistente/local" && metodo === "GET") return json(200, server.estado);
    if (caminho === "/api/assistente/local/baixar" && metodo === "POST") {
      server.estado.baixando = { modelo: body.modelo, status: "pulling", total: 6.6e9, feito: 1e9, erro: null, fim: false };
      return json(202, server.estado.baixando);
    }
    if (caminho === "/api/assistente/local/baixar" && metodo === "GET") return json(200, server.estado.baixando);
    if (caminho === "/api/assistente/local/baixar" && metodo === "DELETE") {
      server.estado.baixando = { ...server.estado.baixando, status: "cancelado", fim: true };
      return json(200, server.estado.baixando);
    }
    if (caminho === "/api/assistente/local/usar") return json(200, { provedor: { catalogo: body.programa, modelo: body.modelo } });
    if (caminho.startsWith("/api/assistente/local/modelos/") && metodo === "DELETE") {
      const nome = caminho.split("/").pop();
      server.estado.ollama.modelos = server.estado.ollama.modelos.filter((m) => m.nome !== nome);
      return new Response(null, { status: 204 });
    }
    return json(404, { detail: "não encontrado" });
  });
  const { resetBackendConnection } = await import("../../frontend/js/api/client.js");
  resetBackendConnection();
  t.after(resetBackendConnection);
  const mod = await import("../../frontend/js/modals/configuracoes/assistente-local.js");
  t.after(mod.pararAcompanhamento);
  const doc = dom.window.document;
  doc.querySelector("#raiz").innerHTML = mod.localSectionHtml();
  let usou = 0;
  mod.wireLocal(doc.querySelector("#raiz"), { depoisDeUsar: () => usou++ });
  await mod.carregarLocal(doc.querySelector("#raiz"), { catalogo: "ollama", modelo: "qwen3.5:4b" });
  return { doc, mod, usou: () => usou };
}

test(
  "ia no computador: máquina, recomendação, modelos e LM Studio",
  withDom('<!doctype html><body><div id="raiz"></div></body>', async (dom, t) => {
    const server = { estado: estadoBase(), chamadas: [] };
    const { doc, usou } = await montar(dom, t, server);
    const box = doc.querySelector("#cfg-ia-local");
    assert.match(box.querySelector(".cfg-ia-local-maquina").textContent, /14,9 GB.*346,7 GB.*Linux 7\.4\.0.*12 núcleos.*integrada/s);
    assert.match(box.textContent, /pra esta máquina: qwen3\.5:4b/);
    assert.match(box.textContent, /baixa 3,3 GB, ocupa 3,3 GB no disco e usa ~5 GB/);
    // o recomendado já está instalado: só o outro tem "baixar"
    assert.equal(doc.querySelector('[data-local-baixar="qwen3.5:4b"]'), null);
    assert.ok(doc.querySelector('[data-local-baixar="qwen3.5:9b"]'));
    // em uso não tem "usar"; sem ferramentas também não
    assert.equal(doc.querySelector('[data-local-usar="ollama"][data-modelo="qwen3.5:4b"]'), null);
    assert.equal(doc.querySelector('[data-local-usar="ollama"][data-modelo="velho:1b"]'), null);
    assert.match(box.textContent, /não usa ferramentas/);

    doc.querySelector('[data-local-usar="lmstudio"]').click();
    await espera();
    assert.ok(server.chamadas.includes("POST /api/assistente/local/usar"));
    assert.equal(usou(), 1);
    assert.match(doc.querySelector("#cfg-ia-local-status").textContent, /gemma-local/);

    // remover pede confirmação (com o tamanho)
    doc.querySelector('[data-local-remover="velho:1b"]').click();
    const sim = doc.querySelector('[data-local-remover-sim="velho:1b"]');
    assert.match(sim.textContent, /1,3 GB/);
    sim.click();
    await espera(6);
    assert.ok(server.chamadas.includes("DELETE /api/assistente/local/modelos/velho:1b"));
    assert.doesNotMatch(box.textContent, /velho:1b/);
  }),
);

test(
  "ia no computador: baixar com andamento e cancelar",
  withDom('<!doctype html><body><div id="raiz"></div></body>', async (dom, t) => {
    const server = { estado: estadoBase(), chamadas: [] };
    const { doc } = await montar(dom, t, server);
    doc.querySelector('[data-local-baixar="qwen3.5:9b"]').click();
    await espera();
    const barra = doc.querySelector(".cfg-ia-local-baixando progress");
    assert.ok(barra);
    assert.equal(barra.value, 15);
    assert.match(doc.querySelector(".cfg-ia-local-baixando").textContent, /1 de 6,6 GB/);
    // um download de cada vez: sem botões de baixar enquanto isso
    assert.equal(doc.querySelector("[data-local-baixar]"), null);
    doc.querySelector("[data-local-parar]").click();
    await espera();
    assert.ok(server.chamadas.includes("DELETE /api/assistente/local/baixar"));
  }),
);

test(
  "ia no computador: pouca memória, Ollama fechado e Ollama em outro computador",
  withDom('<!doctype html><body><div id="raiz"></div></body>', async (dom, t) => {
    const estado = estadoBase();
    estado.recomendacao = null;
    estado.maquina.ram_gb = 4;
    estado.ollama = { instalado: true, rodando: false, versao: null, url: "http://127.0.0.1:11434", modelos: [] };
    estado.lmstudio = { rodando: false, modelos: [] };
    const server = { estado, chamadas: [] };
    const { doc, mod } = await montar(dom, t, server);
    const box = doc.querySelector("#cfg-ia-local");
    assert.match(box.textContent, /menos de 8 GB de memória/);
    assert.match(box.textContent, /instalado mas fechado/);
    assert.match(box.textContent, /LM Studio não detectado/);

    server.estado.ollama = { instalado: false, rodando: false, url: "http://192.168.0.9:11434", modelos: [], outro_computador: true };
    await mod.carregarLocal(doc.querySelector("#raiz"));
    assert.match(box.textContent, /outro computador \(http:\/\/192\.168\.0\.9:11434\)/);
  }),
);
