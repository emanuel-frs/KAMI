// EST-03 (P-181): tamanho da tela — Ctrl + / Ctrl − / Ctrl 0 e os botões
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const tecla = (key, extra = {}) => ({ key, code: "", ctrlKey: true, metaKey: false, altKey: false, ...extra });

test("atalhos: Ctrl +, Ctrl = (o + sem Shift), Ctrl −, Ctrl 0 e o teclado numérico; sem Ctrl ou com Alt não", async () => {
  const { acaoDaTecla } = await import("../../frontend/js/components/zoom.js");
  assert.equal(acaoDaTecla(tecla("+")), "+");
  assert.equal(acaoDaTecla(tecla("=")), "+");
  assert.equal(acaoDaTecla(tecla("", { code: "NumpadAdd" })), "+");
  assert.equal(acaoDaTecla(tecla("-")), "-");
  assert.equal(acaoDaTecla(tecla("0")), "0");
  assert.equal(acaoDaTecla(tecla("+", { ctrlKey: false, metaKey: true })), "+");
  assert.equal(acaoDaTecla(tecla("+", { ctrlKey: false })), null);
  assert.equal(acaoDaTecla(tecla("+", { altKey: true })), null);
  assert.equal(acaoDaTecla(tecla("k")), null);
});

test(
  "no app usa o setZoom do webview, de 10 em 10% entre 50% e 200%, e guarda nesta máquina",
  withDom("<!doctype html><body></body>", async (dom) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.localStorage = dom.window.localStorage;
    const pedidos = [];
    dom.window.__TAURI__ = { webview: { getCurrentWebview: () => ({ setZoom: async (f) => pedidos.push(f) }) } };
    const z = await import("../../frontend/js/components/zoom.js");
    z.restaurarZoom();
    pedidos.length = 0;
    const eventos = [];
    dom.window.addEventListener("kami:zoom", (e) => eventos.push(e.detail));

    assert.equal(z.aumentarZoom(), 1.1);
    assert.equal(z.aumentarZoom(), 1.2);
    assert.equal(dom.window.localStorage.getItem("kami-zoom"), "1.2");
    for (let i = 0; i < 20; i++) z.aumentarZoom();
    assert.equal(z.zoomAtual(), 2);
    for (let i = 0; i < 30; i++) z.diminuirZoom();
    assert.equal(z.zoomAtual(), 0.5);
    assert.equal(z.restaurarZoom(), 1);
    assert.equal(dom.window.localStorage.getItem("kami-zoom"), null, "100% não fica guardado");
    assert.deepEqual(pedidos.slice(0, 2), [1.1, 1.2]);
    assert.equal(pedidos.at(-1), 1);
    assert.equal(eventos.at(-1), 1);
    assert.equal(dom.window.document.documentElement.style.zoom, "", "no app não mexe no CSS");
    delete globalThis.CustomEvent;
    delete globalThis.localStorage;
  })
);

test(
  "fora do app (navegador de desenvolvimento) cai no zoom do CSS",
  withDom("<!doctype html><body></body>", async (dom) => {
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.localStorage = dom.window.localStorage;
    const z = await import("../../frontend/js/components/zoom.js");
    z.definirZoom(1.3);
    assert.equal(dom.window.document.documentElement.style.zoom, "1.3");
    z.restaurarZoom();
    assert.equal(dom.window.document.documentElement.style.zoom, "");
    delete globalThis.CustomEvent;
    delete globalThis.localStorage;
  })
);
