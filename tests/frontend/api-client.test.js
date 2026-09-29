import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { ApiError, del, get, patch, post, put } from "../../frontend/js/api/client.js";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("client monta URL, headers e métodos sem fazer rede real", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return response({ ok: true });
  });

  await get("/api/test");
  await post("/api/test", { name: "Kami" });
  await put("/api/test/1", { name: "novo" });
  await patch("/api/test/1", { enabled: true });
  await del("/api/test/1");

  assert.deepEqual(calls.map(({ url }) => url), [
    "http://127.0.0.1:8000/api/test",
    "http://127.0.0.1:8000/api/test",
    "http://127.0.0.1:8000/api/test/1",
    "http://127.0.0.1:8000/api/test/1",
    "http://127.0.0.1:8000/api/test/1",
  ]);
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.body, JSON.stringify({ name: "Kami" }));
  assert.equal(calls[4].options.method, "DELETE");
});

test("client converte respostas HTTP de erro em ApiError", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    response({ detail: [{ msg: "campo obrigatório" }] }, 422)
  );

  await assert.rejects(
    () => get("/api/test"),
    (err) => err instanceof ApiError
      && err.status === 422
      && err.message === "campo obrigatório"
  );
});

test("no Tauri, falha em get_backend_port vira ApiError(0) com o motivo — sem cair na porta 8000", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => response({ ok: true }));
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async () => {
          throw "O backend do Kami encerrou inesperadamente (código Some(1)). Log completo: C:\\kami\\kami-backend.log";
        },
      },
    },
  };
  t.after(() => {
    delete globalThis.window;
  });

  // import com query string = instância nova do módulo, sem o cache de
  // base URL dos outros testes deste arquivo
  const fresh = await import("../../frontend/js/api/client.js?tauri-falha");

  await assert.rejects(
    () => fresh.get("/api/test"),
    (err) => err instanceof fresh.ApiError
      && err.status === 0
      && err.message.includes("encerrou inesperadamente")
      && err.message.includes("kami-backend.log")
  );
  assert.equal(fetchMock.mock.callCount(), 0, "não deve tentar fetch numa porta chutada");
});

test("no Tauri, a falha não fica cacheada: a próxima chamada tenta de novo e funciona", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return response({ ok: true });
  });
  let attempts = 0;
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async () => {
          attempts += 1;
          if (attempts === 1) throw "ainda subindo";
          return 45123;
        },
      },
    },
  };
  t.after(() => {
    delete globalThis.window;
  });

  const fresh = await import("../../frontend/js/api/client.js?tauri-retry");

  await assert.rejects(() => fresh.get("/api/a"), (err) => err.status === 0);
  await fresh.get("/api/b");

  assert.deepEqual(urls, ["http://127.0.0.1:45123/api/b"]);
});
