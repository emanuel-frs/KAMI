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
