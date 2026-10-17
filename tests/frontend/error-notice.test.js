// CONF-01 — aviso de erro global (components/error-notice.js + api/client.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function setup(dom, t) {
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  t.after(() => {
    delete globalThis.CustomEvent;
    delete globalThis.requestAnimationFrame;
  });
  // efeitos desligados: o título do toast aparece inteiro na hora (sem digitação)
  const { store } = await import("../../frontend/js/state/store.js");
  store.set("profile", { efeitos_visuais: "desligado", som_ativo: false });
}

const toasts = (dom) => [...dom.window.document.querySelectorAll(".toast-item")];
const tick = () => new Promise((r) => setTimeout(r, 5));

test(
  "erro 500 da API vira toast vermelho persistente com a mensagem do backend e 'copiar detalhes'",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { wireErrorNotice } = await import("../../frontend/js/components/error-notice.js");
    const { post, ApiError } = await import("../../frontend/js/api/client.js");
    wireErrorNotice();
    t.mock.method(globalThis, "fetch", async () =>
      response({ detail: "algo deu errado no Kami ao processar esta ação (código #a1b2c3)", codigo: "erro_interno", id: "a1b2c3" }, 500)
    );

    await assert.rejects(() => post("/api/financas/transactions", { amount: 1 }), (e) => e instanceof ApiError && e.errorId === "a1b2c3" && e.inesperado);
    await tick();

    const [el] = toasts(dom);
    assert.ok(el, "nenhum toast apareceu");
    assert.ok(el.classList.contains("toast-erro"));
    assert.match(el.querySelector(".toast-title").textContent, /ao salvar/);
    assert.match(el.querySelector(".toast-message").textContent, /#a1b2c3/);
    assert.equal(el.querySelector("[data-toast-action]").textContent, "copiar detalhes");
  })
);

test(
  "erro esperado (4xx) não gera toast global — quem chamou mostra no formulário",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { wireErrorNotice } = await import("../../frontend/js/components/error-notice.js");
    const { post } = await import("../../frontend/js/api/client.js");
    wireErrorNotice();
    t.mock.method(globalThis, "fetch", async () => response({ detail: "amount: deve ser maior que 0", codigo: "validacao" }, 422));

    await assert.rejects(() => post("/api/financas/transactions", { amount: 0 }));
    await tick();
    assert.equal(toasts(dom).length, 0);
  })
);

test(
  "o mesmo erro repetido (ex.: todos os widgets com o backend fora) vira um aviso só",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { wireErrorNotice } = await import("../../frontend/js/components/error-notice.js");
    wireErrorNotice();
    const fire = () =>
      dom.window.dispatchEvent(new dom.window.CustomEvent("kami:api-error", {
        detail: { method: "GET", path: "/api/x", status: 0, message: "sem rede (teste de repetição)", codigo: "sem_conexao" },
      }));
    fire(); fire(); fire();
    await tick();
    const iguais = toasts(dom).filter((el) => /falar com o backend/.test(el.textContent));
    assert.equal(iguais.length, 1);
    assert.match(iguais[0].querySelector(".toast-title").textContent, /sem conexão/);
  })
);

test(
  "toast de erro não some sozinho (duration 0)",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { showToast } = await import("../../frontend/js/components/toast.js");
    t.mock.timers.enable({ apis: ["setTimeout"] });
    showToast({ title: "x", variant: "erro", duration: 0, sound: false });
    t.mock.timers.tick(60_000);
    assert.equal(toasts(dom).length, 1);
    t.mock.timers.reset();
  })
);

test(
  "erro de JavaScript da tela vai pro log do backend (sem dados do usuário) e mostra um aviso",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { wireErrorNotice, setTelaAtual } = await import("../../frontend/js/components/error-notice.js");
    wireErrorNotice();
    setTelaAtual("financas");
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body || "null") });
      return response(null, 204);
    });

    const err = new dom.window.Error("x is undefined");
    dom.window.dispatchEvent(new dom.window.ErrorEvent("error", {
      error: err, message: err.message, filename: "http://localhost/js/widgets/log.js", lineno: 42, colno: 7,
    }));
    await tick();

    const report = calls.find((c) => c.url.endsWith("/api/sistema/erro-frontend"));
    assert.ok(report, "o erro não foi enviado pro log");
    assert.deepEqual(
      { tipo: report.body.tipo, mensagem: report.body.mensagem, origem: report.body.origem, linha: report.body.linha, tela: report.body.tela },
      { tipo: "erro", mensagem: "x is undefined", origem: "js/widgets/log.js", linha: 42, tela: "financas" }
    );
    assert.ok(toasts(dom).some((el) => /nesta tela/.test(el.textContent)));
  })
);

test(
  "ResizeObserver loop não é bug do Kami: não vai pro log",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { wireErrorNotice } = await import("../../frontend/js/components/error-notice.js");
    wireErrorNotice();
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); return response(null, 204); });
    dom.window.dispatchEvent(new dom.window.ErrorEvent("error", { message: "ResizeObserver loop completed with undelivered notifications." }));
    await tick();
    assert.equal(calls.length, 0);
  })
);

test(
  "err-modal não abre por cima com a mesma mensagem que o toast acabou de mostrar",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { wireErrorNotice } = await import("../../frontend/js/components/error-notice.js");
    const { showErrorModal } = await import("../../frontend/js/modals/err-modal.js");
    wireErrorNotice();
    const msg = "falhou de verdade (código #ffffff)";
    dom.window.dispatchEvent(new dom.window.CustomEvent("kami:api-error", {
      detail: { method: "POST", path: "/api/y", status: 500, message: msg, codigo: "erro_interno", errorId: "ffffff" },
    }));
    showErrorModal(msg, "erro ao salvar");
    assert.equal(dom.window.document.querySelector("#error-modal.open"), null);

    showErrorModal("outra mensagem qualquer", "erro");
    assert.ok(dom.window.document.querySelector("#error-modal.open"));
  })
);

test(
  "'copiar detalhes' monta um texto pra relato de problema, sem query string",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { buildDetails, setTelaAtual } = await import("../../frontend/js/components/error-notice.js");
    t.mock.method(globalThis, "fetch", async () => response({ status: "ok", version: "1.10.0" }));
    setTelaAtual("metas");
    const text = await buildDetails({
      method: "POST", path: "/api/metas/1?x=segredo", status: 500, codigo: "erro_interno", errorId: "abc123", message: "algo deu errado",
    });
    assert.match(text, /^Kami v1\.10\.0 — \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    assert.match(text, /ação: POST \/api\/metas\/1\n/);
    assert.match(text, /erro: 500 erro_interno #abc123/);
    assert.match(text, /tela: metas/);
    assert.doesNotMatch(text, /segredo/);
  })
);

test("nenhum innerHTML monta mensagem de erro sem escapeHtml", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "vendor" ? [] : walk(join(d, e.name))) : e.name.endsWith(".js") ? [join(d, e.name)] : []);
  const bad = [];
  for (const file of walk("frontend/js")) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/innerHTML/.test(line) && /\$\{(err|e|error)\.message\}/.test(line)) bad.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test(
  "com um aviso igual ainda aberto, rotinas de fundo não empilham outro — mesmo depois de 10 s",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { wireErrorNotice } = await import("../../frontend/js/components/error-notice.js");
    wireErrorNotice();
    let now = 1_000_000;
    t.mock.method(Date, "now", () => now);
    const fire = () =>
      dom.window.dispatchEvent(new dom.window.CustomEvent("kami:api-error", {
        detail: { method: "GET", path: "/api/calendario", status: 503, message: "banco ocupado (teste aberto)", codigo: "banco_ocupado" },
      }));
    const count = () => toasts(dom).filter((el) => /teste aberto/.test(el.textContent)).length;

    fire();
    now += 60_000; // um minuto depois, o aviso continua aberto
    fire();
    assert.equal(count(), 1);

    // fechou o aviso: depois da janela, um erro novo volta a aparecer
    toasts(dom).find((el) => /teste aberto/.test(el.textContent)).remove();
    now += 60_000;
    fire();
    assert.equal(count(), 1);
  })
);

test(
  "banco travado derrubando várias chamadas (cada uma com um código) vira UM aviso",
  withDom("<body></body>", async (dom, t) => {
    await setup(dom, t);
    const { wireErrorNotice } = await import("../../frontend/js/components/error-notice.js");
    wireErrorNotice();
    for (const [i, path] of ["/api/calendario/events", "/api/perfil", "/api/nucleo/log"].entries()) {
      dom.window.dispatchEvent(new dom.window.CustomEvent("kami:api-error", {
        detail: { method: "GET", path, status: 503, codigo: "banco_ocupado", errorId: `00000${i}`, message: `banco ocupado (código #00000${i})` },
      }));
    }
    assert.equal(toasts(dom).filter((el) => /banco ocupado/.test(el.textContent)).length, 1);
  })
);
