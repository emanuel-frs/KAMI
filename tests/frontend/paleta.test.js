// ORG-03 — paleta Ctrl+K (components/paleta.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";
import { semAcento, bate } from "../../frontend/js/components/paleta.js";

test("semAcento e bate: ignora acento, caixa e ordem das palavras", () => {
  assert.equal(semAcento("Ação ÚNICA"), "acao unica");
  assert.ok(bate("configurações › segurança pin", "SEGURANCA config"));
  assert.ok(!bate("nova meta", "nova nota"));
  assert.ok(bate("qualquer coisa", "   "));
});

test(
  "Ctrl+K abre com os comandos, filtra na hora, setas escolhem e Esc fecha",
  withDom("<body></body>", async (dom, t) => {
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => [] }));
    const anterior = globalThis.CustomEvent;
    globalThis.CustomEvent = dom.window.CustomEvent;
    t.after(() => (globalThis.CustomEvent = anterior));
    const { wirePaleta, fechar } = await import("../../frontend/js/components/paleta.js");
    const doc = dom.window.document;
    wirePaleta();

    const tecla = (alvo, key, extra = {}) =>
      alvo.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, ...extra }));

    tecla(doc, "k", { ctrlKey: true, code: "KeyK" });
    const paleta = doc.querySelector("#paleta");
    assert.equal(paleta.hidden, false);
    assert.equal(doc.activeElement.id, "paleta-q");
    assert.ok(doc.querySelectorAll(".paleta-item").length > 10, "sem texto mostra os comandos");

    const input = doc.querySelector("#paleta-q");
    input.value = "seguranca";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const rotulos = [...doc.querySelectorAll(".paleta-rotulo")].map((e) => e.textContent);
    assert.deepEqual(rotulos, ["configurações › segurança"]);

    input.value = "ir para";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    assert.equal(doc.querySelector(".paleta-item.on").dataset.i, "0");
    tecla(input, "ArrowDown");
    assert.equal(doc.querySelector(".paleta-item.on").dataset.i, "1");
    tecla(input, "ArrowUp");
    tecla(input, "ArrowUp"); // dá a volta pro último
    assert.equal(Number(doc.querySelector(".paleta-item.on").dataset.i), doc.querySelectorAll(".paleta-item").length - 1);

    tecla(input, "Escape");
    assert.equal(paleta.hidden, true);

    // com modal aberto, Ctrl+K não abre por cima
    const modal = doc.createElement("div");
    modal.className = "modal-backdrop open";
    doc.body.append(modal);
    tecla(doc, "k", { ctrlKey: true, code: "KeyK" });
    assert.equal(paleta.hidden, true);
    fechar();
  })
);
