// SEG-02 — tela de bloqueio do PIN (components/lock-screen.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Backend falso só com as rotas do PIN (modo dev: sem Tauri, sem token). */
async function setup(dom, t, { ativo = true, bloqueado = true, pin = "4821", espera = 0, inatividade = null } = {}) {
  globalThis.CustomEvent = dom.window.CustomEvent;
  const server = { ativo, bloqueado, pin, espera, inatividade, chamadas: [], codigo: "KAMI-AAAA-BBBB-CCCC" };
  const estado = () => ({
    ativo: server.ativo,
    bloqueado: server.ativo && server.bloqueado,
    inatividade_min: server.inatividade,
    espera_s: server.espera,
    pasta: "/home/ana/.local/share/kami",
  });
  const responder = (status, body) => ({ ok: status < 400, status, json: async () => body });
  t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
    const path = new URL(url).pathname;
    const body = opts.body ? JSON.parse(opts.body) : {};
    server.chamadas.push(`${opts.method || "GET"} ${path}`);
    if (path === "/api/seguranca/pin") return responder(200, estado());
    if (path === "/api/seguranca/pin/desbloquear") {
      if (server.espera) return responder(429, { detail: `muitas tentativas erradas — espere ${server.espera} s` });
      if (body.pin !== server.pin) return responder(422, { detail: "PIN errado" });
      server.bloqueado = false;
      return responder(200, estado());
    }
    if (path === "/api/seguranca/pin/recuperar") {
      if (body.codigo !== server.codigo) return responder(422, { detail: "código de recuperação errado" });
      server.pin = body.pin_novo;
      server.bloqueado = false;
      return responder(200, { ...estado(), codigo_recuperacao: "KAMI-NOVO-CODI-GO22" });
    }
    if (path === "/api/seguranca/pin/bloquear") {
      server.bloqueado = true;
      return responder(200, estado());
    }
    return responder(404, { detail: "não encontrado" });
  });
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
  return { lock, server, doc, tela: () => doc.querySelector(".lock-screen") };
}

function digitar(doc, pin) {
  for (const d of pin) doc.querySelector(`.lock-key[data-key="${d}"]`).click();
}

const PAGINA = '<body><div class="titlebar"></div><main id="app"><a href="#">link</a></main></body>';

test(
  "sem PIN: o boot segue na hora, sem tela",
  withDom(PAGINA, async (dom, t) => {
    const { lock, tela } = await setup(dom, t, { ativo: false });
    await lock.garantirDesbloqueio();
    assert.equal(tela(), null);
  })
);

test(
  "PIN ligado: a tela segura o boot e trava o resto da página até o PIN certo",
  withDom(PAGINA, async (dom, t) => {
    const { lock, doc, tela } = await setup(dom, t);
    let liberou = false;
    const boot = lock.garantirDesbloqueio().then(() => (liberou = true));
    await wait(10);
    assert.ok(tela());
    assert.equal(doc.getElementById("app").inert, true);
    assert.notEqual(doc.querySelector(".titlebar").inert, true); // minimizar/fechar continuam

    digitar(doc, "1111");
    doc.querySelector('.lock-key[data-key="ok"]').click();
    await wait(10);
    assert.equal(doc.querySelector('[data-view="pin"] .lock-msg').textContent, "PIN errado");
    assert.equal(liberou, false);

    digitar(doc, "4821");
    doc.querySelector('.lock-key[data-key="ok"]').click();
    await boot;
    assert.equal(tela(), null);
    assert.notEqual(doc.getElementById("app").inert, true);
  })
);

test(
  "muitas tentativas: mostra a espera e desabilita o teclado",
  withDom(PAGINA, async (dom, t) => {
    const { lock, doc } = await setup(dom, t, { espera: 30 });
    lock.garantirDesbloqueio();
    await wait(10);
    assert.match(doc.querySelector('[data-view="pin"] .lock-msg').textContent, /espere 30 s/);
    assert.equal(doc.getElementById("lock-pin").disabled, true);
    assert.equal(doc.querySelector('.lock-key[data-key="ok"]').disabled, true);
  })
);

test(
  "esqueci o PIN: código certo troca o PIN e mostra o código novo uma vez",
  withDom(PAGINA, async (dom, t) => {
    const { lock, server, doc, tela } = await setup(dom, t);
    const boot = lock.garantirDesbloqueio();
    await wait(10);
    doc.querySelector('[data-ir="recuperar"]').click();
    assert.match(doc.querySelector(".lock-pasta").textContent, /\.local\/share\/kami/);

    doc.getElementById("lock-codigo").value = "KAMI-AAAA-BBBB-CCCC";
    doc.getElementById("lock-novo").value = "2468";
    doc.getElementById("lock-novo2").value = "2468";
    doc.querySelector('[data-acao="recuperar"]').click();
    await wait(10);
    assert.equal(server.pin, "2468");
    assert.equal(doc.querySelector(".lock-codigo-valor").textContent, "KAMI-NOVO-CODI-GO22");
    assert.ok(tela()); // só sai com o "guardei"

    doc.querySelector('[data-acao="guardei"]').click();
    await boot;
    assert.equal(tela(), null);
  })
);

test(
  "um 423 no meio do uso (backend reiniciado) abre a tela",
  withDom(PAGINA, async (dom, t) => {
    const { lock, tela } = await setup(dom, t);
    lock.wireLockScreen();
    dom.window.dispatchEvent(new dom.window.CustomEvent("kami:bloqueado"));
    await wait(10);
    assert.ok(tela());
  })
);

test(
  "inatividade: passou do tempo, bloqueia no backend e abre a tela",
  withDom(PAGINA, async (dom, t) => {
    const { lock, server, tela } = await setup(dom, t, { bloqueado: false, inatividade: 5 });
    await lock.garantirDesbloqueio();
    lock._setUltimaAtividadeForTests(Date.now() - 4 * 60_000);
    await lock._conferirInatividadeForTests();
    assert.equal(tela(), null);

    lock._setUltimaAtividadeForTests(Date.now() - 6 * 60_000);
    await lock._conferirInatividadeForTests();
    assert.ok(server.chamadas.includes("POST /api/seguranca/pin/bloquear"));
    assert.ok(tela());
  })
);
