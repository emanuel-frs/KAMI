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

test("P-196: falha do .rpm vira frase traduzida, com o jeito de instalar à mão", async () => {
  const { mensagemDeFalha } = await import("../../frontend/js/components/atualizacao.js");
  const cancelado = mensagemDeFalha("rpm:canceled", "2.0.1");
  assert.doesNotMatch(cancelado, /^rpm:|sudo/, "cancelou: só avisa, sem instrução de terminal");
  const recusou = mensagemDeFalha("rpm:failed:package kami-0:2.0.1-1.x86_64 does not verify: no signature", "2.0.1");
  assert.match(recusou, /does not verify: no signature/, "o motivo do rpm aparece");
  assert.match(recusou, /sudo dnf install \.\/kami-2\.0\.1-linux-x86_64\.rpm/);
  for (const e of ["rpm:denied", "rpm:no-pkexec"]) {
    const m = mensagemDeFalha(e, "2.0.1");
    assert.doesNotMatch(m, /^rpm:/);
    assert.match(m, /kami-2\.0\.1-linux-x86_64\.rpm/);
  }
  // os outros erros (Windows, AppImage, download) já vêm como frase
  assert.equal(mensagemDeFalha(new Error("não deu pra baixar a versão 2.0.1: x"), "2.0.1"), "não deu pra baixar a versão 2.0.1: x");
});
