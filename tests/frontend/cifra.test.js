// SEG-08 — banco cifrado: a tela de abertura pede o código quando a chave
// sumiu do cofre (antes do PIN), e a seção de configurações › segurança
// liga (mostrando o código uma vez), mostra o código de novo e desliga.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const espera = () => new Promise((r) => setTimeout(r, 0));
const CODIGO = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-ABCD-EFGH-JKMN-PQRS-TV";
const responder = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function backend(t, server) {
  t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
    const caminho = new URL(url).pathname;
    const body = opts.body ? JSON.parse(opts.body) : {};
    server.chamadas.push(`${opts.method || "GET"} ${caminho}`);
    const estado = () => ({ ligada: server.ligada, sem_chave: server.semChave, disponivel: true, motivo: null, copias_sem_cifra: server.copias });
    if (caminho === "/api/seguranca/cifra") return responder(200, estado());
    if (caminho === "/api/seguranca/cifra/recuperar") {
      if (body.codigo !== CODIGO) return responder(422, { detail: "esse código não abre o banco deste computador" });
      server.semChave = false;
      return responder(200, { no_cofre: true });
    }
    if (caminho === "/api/seguranca/cifra/ligar") {
      server.apagou = body.apagar_copias_sem_cifra;
      server.ligada = true;
      server.copias = 0;
      return responder(200, { ...estado(), codigo: CODIGO, copias_apagadas: 3 });
    }
    if (caminho === "/api/seguranca/cifra/codigo") {
      if (server.pinAtivo && body.pin !== "4821") return responder(422, { detail: "PIN errado" });
      return responder(200, { codigo: CODIGO });
    }
    if (caminho === "/api/seguranca/cifra/desligar") {
      server.ligada = false;
      return responder(200, estado());
    }
    if (caminho === "/api/seguranca/pin") return responder(200, { ativo: server.pinAtivo, bloqueado: false, espera_s: 0, inatividade_min: null });
    if (caminho === "/api/seguranca/chave") return responder(200, { local: "cofre", cofre: "teste", motivo: null, segredos_salvos: 0 });
    return responder(404, { detail: "não encontrado" });
  });
}

test(
  "cifra: sem a chave no cofre, a abertura pede o código antes do PIN",
  withDom('<body><div class="titlebar"></div><main id="app"></main></body>', async (dom, t) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    const server = { ligada: true, semChave: true, copias: 0, pinAtivo: true, chamadas: [] };
    backend(t, server);
    const { resetBackendConnection } = await import("../../frontend/js/api/client.js");
    resetBackendConnection();
    const lock = await import("../../frontend/js/components/lock-screen.js");
    lock._resetLockScreenForTests();
    t.after(() => {
      lock._resetLockScreenForTests();
      resetBackendConnection();
      delete globalThis.CustomEvent;
    });
    const doc = dom.window.document;

    lock.garantirDesbloqueio();
    await espera();
    await espera();
    const tela = doc.querySelector(".lock-screen");
    assert.ok(tela, "a tela abriu");
    assert.ok(tela.querySelector('[data-view="cifra"]'), "é a tela do código do banco, não a do PIN");
    assert.ok(!server.chamadas.includes("GET /api/seguranca/pin"), "o PIN só depois do banco aberto");
    assert.equal(doc.querySelector("#app").inert, true);

    const input = doc.querySelector("#lock-cifra-codigo");
    input.value = "errado";
    doc.querySelector('[data-acao="abrir-cifra"]').click();
    await espera();
    await espera();
    assert.match(tela.querySelector(".lock-msg").textContent, /não abre/);

    input.value = CODIGO;
    doc.querySelector('[data-acao="abrir-cifra"]').click();
    await espera();
    await espera();
    assert.ok(server.chamadas.includes("POST /api/seguranca/cifra/recuperar"));
    assert.equal(doc.querySelector(".lock-screen"), null, "fechou (e recarrega o app)");
  }),
);

test(
  "cifra: configurações › segurança liga, mostra o código e desliga",
  withDom('<!doctype html><body><div id="raiz"></div></body>', async (dom, t) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    t.after(() => delete globalThis.CustomEvent);
    const server = { ligada: false, semChave: false, copias: 3, pinAtivo: true, chamadas: [] };
    backend(t, server);
    const { resetBackendConnection } = await import("../../frontend/js/api/client.js");
    resetBackendConnection();
    t.after(resetBackendConnection);
    const doc = dom.window.document;
    const $ = (s) => doc.querySelector(s);
    const { buildSegurancaPanel, wireSegurancaTab } = await import("../../frontend/js/modals/configuracoes/seguranca.js");
    $("#raiz").innerHTML = `<button class="cfg-tab" data-tab="seguranca"></button>${buildSegurancaPanel()}`;
    wireSegurancaTab($("#raiz"));
    $('.cfg-tab[data-tab="seguranca"]').click();
    for (let i = 0; i < 4; i++) await espera();

    const box = $("#cfg-cifra");
    assert.match(box.textContent, /desligado/);
    assert.equal($("#cfg-cifra-limpa").checked, true, "apagar as cópias sem cifra vem marcado (P-169)");
    assert.match(box.textContent, /\(3\)/);

    $('[data-cifra-acao="ligar"]').click();
    for (let i = 0; i < 4; i++) await espera();
    assert.equal(server.apagou, true);
    assert.equal(box.querySelector(".lock-codigo-valor").textContent, CODIGO);
    assert.equal(box.querySelector(".lock-codigo").dataset.tipo, "cifra");

    $('[data-cifra-acao="guardei"]').click();
    assert.match(box.textContent, /ligado/);
    assert.equal(box.querySelector(".lock-codigo"), null, "o código não fica na tela");

    // com PIN ligado, mostrar o código de novo pede o PIN
    $("#cfg-cifra-pin").value = "0000";
    $('[data-cifra-acao="codigo"]').click();
    for (let i = 0; i < 4; i++) await espera();
    assert.match($("#cfg-cifra-status").textContent, /PIN errado/);
    $("#cfg-cifra-pin").value = "4821";
    $('[data-cifra-acao="codigo"]').click();
    for (let i = 0; i < 4; i++) await espera();
    assert.equal(box.querySelector(".cfg-cifra-codigo .lock-codigo-valor").textContent, CODIGO);

    $('[data-cifra-acao="desligar"]').click();
    for (let i = 0; i < 4; i++) await espera();
    assert.ok(server.chamadas.includes("POST /api/seguranca/cifra/desligar"));
    assert.match(box.textContent, /desligado/);
    assert.match($("#cfg-cifra-status").textContent, /cifra desligada/);
  }),
);
