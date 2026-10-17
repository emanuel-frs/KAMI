// CONF-02 — vigia do backend (components/backend-watchdog.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Prepara o jsdom + um "backend" falso controlado por `server.up`, e um
 * Tauri falso (ou nenhum, no modo dev) que registra os comandos chamados.
 */
async function setup(dom, t, { tauri = true, restartBringsBack = true, reason = "" } = {}) {
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const server = { up: true, port: 51000 };
  const invoked = [];
  if (tauri) {
    dom.window.__TAURI__ = {
      core: {
        async invoke(cmd) {
          invoked.push(cmd);
          if (cmd === "get_backend_port") {
            if (!server.up && reason) throw reason;
            return server.port;
          }
          if (cmd === "get_backend_token") return "tok";
          if (cmd === "restart_backend") {
            if (restartBringsBack) { server.up = true; server.port += 1; }
            return null;
          }
          if (cmd === "open_log_folder") return null;
          throw new Error(`comando inesperado ${cmd}`);
        },
      },
    };
  }
  t.mock.method(globalThis, "fetch", async (url) => {
    if (!server.up) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200, json: async () => ({ status: "ok", version: "1.10.0" }) };
  });
  const { store } = await import("../../frontend/js/state/store.js");
  store.set("profile", { efeitos_visuais: "desligado", som_ativo: false });
  const wd = await import("../../frontend/js/components/backend-watchdog.js");
  const { resetBackendConnection } = await import("../../frontend/js/api/client.js");
  wd._setWatchdogTimingForTests({ confirmDelay: 1, restartWait: 200, restartPoll: 5, checkInterval: 60_000 });
  resetBackendConnection();
  t.after(() => {
    wd.stopBackendWatchdog();
    resetBackendConnection();
    delete globalThis.CustomEvent;
    delete globalThis.requestAnimationFrame;
  });
  return { wd, server, invoked, banner: () => dom.window.document.getElementById("backend-banner") };
}

test(
  "backend respondendo: nada aparece",
  withDom("<body></body>", async (dom, t) => {
    const { wd, banner } = await setup(dom, t);
    wd.startBackendWatchdog();
    await wd.check();
    assert.equal(wd.watchdogState(), "ok");
    assert.ok(!banner() || banner().hidden);
  })
);

test(
  "backend caiu no app: reinicia sozinho UMA vez, a faixa some e a tela é recarregada",
  withDom("<body></body>", async (dom, t) => {
    const { wd, server, invoked, banner } = await setup(dom, t);
    let recarregou = 0;
    wd.startBackendWatchdog({ onRecovered: () => recarregou++ });
    server.up = false;

    await wd.check();

    assert.deepEqual(invoked.filter((c) => c === "restart_backend"), ["restart_backend"]);
    assert.equal(wd.watchdogState(), "ok");
    assert.ok(banner().hidden);
    assert.equal(recarregou, 1);
    assert.ok([...dom.window.document.querySelectorAll(".toast-item")].some((el) => /de volta/.test(el.textContent)));
  })
);

test(
  "se o reinício automático não resolve: faixa com o motivo do Rust e os botões; não tenta sozinho de novo",
  withDom("<body></body>", async (dom, t) => {
    const reason = "O backend do Kami encerrou inesperadamente (código Some(1)). Log completo: /x/kami-backend.log";
    const { wd, server, invoked, banner } = await setup(dom, t, { restartBringsBack: false, reason });
    wd.startBackendWatchdog();
    server.up = false;

    await wd.check();
    assert.equal(wd.watchdogState(), "fora");
    assert.ok(!banner().hidden);
    assert.match(banner().textContent, /o backend do kami parou/);
    assert.match(banner().querySelector(".backend-banner-message").textContent, /kami-backend\.log/);
    assert.ok(banner().querySelector('[data-action="restart"]'));
    assert.ok(banner().querySelector('[data-action="open-log"]'));

    await wd.check(); // próximo ciclo: continua fora, sem novo reinício automático
    assert.equal(invoked.filter((c) => c === "restart_backend").length, 1);

    // botões chamam os comandos do Rust
    banner().querySelector('[data-action="open-log"]').click();
    await wait(5);
    assert.ok(invoked.includes("open_log_folder"));
  })
);

test(
  "botão reiniciar: quando o backend volta, a faixa some",
  withDom("<body></body>", async (dom, t) => {
    const { wd, server, invoked, banner } = await setup(dom, t, { restartBringsBack: false, reason: "parou" });
    wd.startBackendWatchdog();
    server.up = false;
    await wd.check();
    assert.equal(wd.watchdogState(), "fora");

    server.up = true; // a pessoa resolveu o problema e clica em reiniciar
    banner().querySelector('[data-action="restart"]').click();
    await wait(60);
    assert.equal(invoked.filter((c) => c === "restart_backend").length, 2);
    assert.equal(wd.watchdogState(), "ok");
    assert.ok(banner().hidden);
  })
);

test(
  "soluço (uma falha só) não assusta: a confirmação acha o backend de pé",
  withDom("<body></body>", async (dom, t) => {
    const { wd, server, invoked } = await setup(dom, t);
    wd.startBackendWatchdog();
    let falhas = 1;
    t.mock.method(globalThis, "fetch", async () => {
      if (falhas-- > 0) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, json: async () => ({ status: "ok" }) };
    });
    await wd.check();
    assert.equal(wd.watchdogState(), "ok");
    assert.equal(invoked.filter((c) => c === "restart_backend").length, 0);
    void server;
  })
);

test(
  "modo dev (sem Tauri): faixa explica como subir o uvicorn, sem botões, e some quando ele volta",
  withDom("<body></body>", async (dom, t) => {
    const { wd, server, banner } = await setup(dom, t, { tauri: false });
    wd.startBackendWatchdog();
    server.up = false;
    await wd.check();
    assert.match(banner().textContent, /uvicorn/);
    assert.equal(banner().querySelector("button"), null);

    server.up = true;
    await wd.check();
    assert.ok(banner().hidden);
  })
);

test(
  "erro 'sem conexão' da API dispara um teste na hora e não vira toast enquanto o vigia está ligado",
  withDom("<body></body>", async (dom, t) => {
    const { wd, server, invoked } = await setup(dom, t);
    const { wireErrorNotice } = await import("../../frontend/js/components/error-notice.js");
    wireErrorNotice();
    wd.startBackendWatchdog();
    server.up = false;
    dom.window.dispatchEvent(new dom.window.CustomEvent("kami:api-error", {
      detail: { method: "GET", path: "/api/perfil", status: 0, message: "não foi possível conectar", codigo: "sem_conexao" },
    }));
    await wait(80);
    assert.ok(invoked.includes("restart_backend"), "o vigia não reagiu ao erro de conexão");
    const semConexao = [...dom.window.document.querySelectorAll(".toast-item")].filter((el) => /sem conexão/.test(el.textContent));
    assert.equal(semConexao.length, 0);
  })
);

test(
  "backend que nem sobe no reinício: a faixa de erro aparece na hora, sem esperar o limite",
  withDom("<body></body>", async (dom, t) => {
    const { wd, server, banner } = await setup(dom, t, { restartBringsBack: false, reason: "O backend do Kami não pôde ser iniciado (arquivo não encontrado)." });
    wd._setWatchdogTimingForTests({ restartWait: 30_000 }); // se esperasse o limite, o teste estouraria
    wd.startBackendWatchdog();
    server.up = false;
    const inicio = Date.now();
    await wd.check();
    assert.ok(Date.now() - inicio < 1000, `demorou ${Date.now() - inicio} ms`);
    assert.match(banner().querySelector(".backend-banner-message").textContent, /não pôde ser iniciado/);
  })
);
