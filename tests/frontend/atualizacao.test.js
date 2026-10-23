// DIST-01 — aviso de versão nova (components/atualizacao.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";
import { situacaoNoSino } from "../../frontend/js/components/atualizacao.js";

test("situacaoNoSino: conta uma vez por versão; pulada some do sino", () => {
  assert.deepEqual(situacaoNoSino(null, {}), { mostrar: false, contar: false });
  assert.deepEqual(situacaoNoSino("1.15.0", {}), { mostrar: true, contar: true });
  // o sino já mostrou a 1.15.0: continua lá, mas não conta mais
  assert.deepEqual(situacaoNoSino("1.15.0", { atualizacao_avisada: "1.15.0" }), { mostrar: true, contar: false });
  // saiu outra depois: conta de novo
  assert.deepEqual(situacaoNoSino("1.15.1", { atualizacao_avisada: "1.15.0" }), { mostrar: true, contar: true });
  assert.deepEqual(situacaoNoSino("1.15.0", { atualizacao_pulada: "1.15.0" }), { mostrar: false, contar: false });
});

test(
  "procurar: desligado não consulta; achou → evento e sino; abrir o sino marca como avisada",
  withDom("<body></body>", async (dom, t) => {
    const anterior = globalThis.CustomEvent;
    globalThis.CustomEvent = dom.window.CustomEvent;
    t.after(() => (globalThis.CustomEvent = anterior));
    const chamadas = [];
    dom.window.__TAURI__ = {
      core: {
        invoke: async (cmd) => {
          chamadas.push(cmd);
          return { versao: "1.15.0", atual: "1.14.0", notas: null, data: "2026-11-01", instalavel: true };
        },
      },
    };
    globalThis.window.__TAURI__ = dom.window.__TAURI__;
    const puts = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      puts.push(body);
      return { ok: true, status: 200, json: async () => ({ atualizacoes_procurar: true, ...body }) };
    });
    const { store } = await import("../../frontend/js/state/store.js");
    const at = await import("../../frontend/js/components/atualizacao.js");

    store.set("profile", { atualizacoes_procurar: false });
    await at.rodada();
    assert.deepEqual(chamadas, [], "desligado: a rodada automática não consulta nada");
    store.set("profile", { atualizacoes_procurar: true });
    let eventos = 0;
    dom.window.addEventListener("kami:atualizacao", () => eventos++);
    const d = await at.procurarAgora();
    assert.equal(d.versao, "1.15.0");
    assert.deepEqual(chamadas, ["atualizacao_procurar"]);
    assert.equal(eventos, 1);
    assert.deepEqual(at.noSino(), { mostrar: true, contar: true });

    await at.marcarAvisada();
    assert.deepEqual(puts.at(-1), { atualizacao_avisada: "1.15.0" });
    assert.deepEqual(at.noSino(), { mostrar: true, contar: false });

    await at.definirProcurar(false);
    assert.deepEqual(puts.at(-1), { atualizacoes_procurar: false });
    assert.equal(at.estadoAtualizacao().disponivel, null, "desligar esquece a versão encontrada");
  })
);
