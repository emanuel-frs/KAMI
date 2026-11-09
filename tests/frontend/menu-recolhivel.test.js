// EST-03 (P-195): com pouca largura (zoom alto, janela estreita) o menu da
// esquerda vira um botão na barra de título que o abre por cima.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const HTML = `<!doctype html><body>
  <div class="titlebar"><button id="btn-menu" hidden aria-expanded="false"></button></div>
  <div class="layout">
    <nav class="sidebar" id="sidebar">
      <div class="nav-link" data-page="perfil" tabindex="0">perfil</div>
      <div class="nav-link active" data-page="nucleo" tabindex="0">núcleo</div>
      <div class="sidebar-footer-actions"><button id="btn-open-help"></button><button id="btn-open-settings"></button></div>
    </nav>
    <main id="page-root"></main>
  </div>
</body>`;

test(
  "recolhe só com pouca largura; abre, fecha ao escolher a tela, com Esc e no fundo; fechado sai do Tab",
  withDom(HTML, async (dom) => {
    const win = dom.window;
    const doc = win.document;
    let largura = 1300;
    const ouvintes = [];
    win.matchMedia = (q) => {
      const max = Number(/max-width:\s*(\d+)px/.exec(q)[1]);
      return {
        get matches() { return largura <= max; },
        addEventListener: (_, fn) => ouvintes.push(fn),
      };
    };
    const muda = (w) => { largura = w; ouvintes.forEach((fn) => fn()); };
    const { wireMenuRecolhivel, LARGURA_RECOLHE } = await import("../../frontend/js/components/menu-recolhivel.js");
    wireMenuRecolhivel();
    const botao = doc.getElementById("btn-menu");
    const menu = doc.getElementById("sidebar");
    const body = doc.body;

    // largo: menu ao lado, como sempre
    assert.equal(botao.hidden, true);
    assert.equal(body.classList.contains("menu-recolhido"), false);
    assert.equal(menu.hasAttribute("inert"), false);

    // a janela mínima (960) em 100% nunca recolhe
    muda(960);
    assert.equal(body.classList.contains("menu-recolhido"), false);

    // 150% numa tela de 1366: 909px de largura
    muda(909);
    assert.ok(909 <= LARGURA_RECOLHE);
    assert.equal(botao.hidden, false);
    assert.equal(body.classList.contains("menu-recolhido"), true);
    assert.equal(menu.hasAttribute("inert"), true, "fechado, fora do Tab");

    botao.click();
    assert.equal(body.classList.contains("menu-aberto"), true);
    assert.equal(botao.getAttribute("aria-expanded"), "true");
    assert.equal(menu.hasAttribute("inert"), false);
    assert.equal(doc.activeElement.dataset.page, "nucleo", "foco na tela atual");

    // escolher a tela fecha
    doc.querySelector('[data-page="perfil"]').click();
    assert.equal(body.classList.contains("menu-aberto"), false);
    assert.equal(menu.hasAttribute("inert"), true);

    // Esc fecha e devolve o foco ao botão
    botao.click();
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(body.classList.contains("menu-aberto"), false);
    assert.equal(doc.activeElement, botao);

    // o fundo fecha; a ajuda não (o menu dela fica preso ao botão)
    botao.click();
    doc.getElementById("btn-open-help").click();
    assert.equal(body.classList.contains("menu-aberto"), true);
    doc.querySelector(".menu-fundo").click();
    assert.equal(body.classList.contains("menu-aberto"), false);

    // voltou a ter largura: menu ao lado de novo, mesmo se estava aberto
    botao.click();
    muda(1300);
    assert.equal(botao.hidden, true);
    assert.equal(body.classList.contains("menu-recolhido"), false);
    assert.equal(body.classList.contains("menu-aberto"), false);
    assert.equal(menu.hasAttribute("inert"), false);
  })
);
