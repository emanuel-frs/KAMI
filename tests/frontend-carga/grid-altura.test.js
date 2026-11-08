// EST-03 (zoom): a altura que a pessoa escolheu pro widget e a altura que
// a tela desenha são coisas separadas. Quando o conteúdo precisa de mais
// (zoom → grade de 2 colunas → card estreito e alto), o card cresce na
// tela, mas volta à escolhida quando o conteúdo deixa — e o layout salvo
// continua com a escolhida. Antes, a altura inflada ficava pra sempre.
//
// Fica em frontend-carga/ (fora da medição de cobertura): importar o
// grid.js puxa grid-arrastar e grid-teclado (~1.400 linhas de DOM), e o
// Node conta todo arquivo importado — derrubou a cobertura do CI pra 78%.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "../frontend/helpers/dom.js";

const HTML = `<!doctype html><body><div id="g"><div class="card" data-span="3"></div></div></body>`;

test(
  "altura escolhida não é reescrita quando o conteúdo cresce e depois encolhe",
  withDom(HTML, async (dom) => {
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    const { placeCard, escolherAltura, alturaEscolhida } = await import("../../frontend/js/widgets/grid.js");
    const card = dom.window.document.querySelector(".card");

    // jsdom não faz layout: sem height inline, a "medida" é a do conteúdo
    let conteudo = 300;
    card.getBoundingClientRect = () => ({
      width: 0,
      height: card.style.height ? parseInt(card.style.height, 10) : conteudo,
    });

    escolherAltura(card, 452);
    placeCard(card, 4);
    assert.equal(card.style.height, "452px");

    conteudo = 640; // zoom: card estreito, conteúdo mais alto que a escolhida
    placeCard(card, 2);
    assert.equal(card.style.height, "640px", "nunca corta o conteúdo");
    assert.equal(alturaEscolhida(card), 452, "a escolhida não muda");

    conteudo = 300; // tirou o zoom
    placeCard(card, 4);
    assert.equal(card.style.height, "452px", "volta à altura escolhida");

    escolherAltura(card, null);
    assert.equal(alturaEscolhida(card), 0);
    assert.equal(card.dataset.manual, undefined);
    placeCard(card, 4);
    assert.equal(card.style.height, "300px", "automático segue o conteúdo");
    delete globalThis.getComputedStyle;
  })
);
