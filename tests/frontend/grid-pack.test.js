// LAY-03/04 — empacotamento dos widgets (widgets/grid-pack.js: packLayout, colsForWidth).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

async function grid() {
  return import("../../frontend/js/widgets/grid-pack.js");
}

/** Monta a ocupação (matriz linha × coluna) e confere que ninguém se sobrepõe. */
function ocupacao(items, pos, cols) {
  const grade = [];
  items.forEach((it, i) => {
    for (let r = pos[i].row; r < pos[i].row + it.rows; r++) {
      grade[r] ??= new Array(cols + 1).fill(-1);
      for (let c = pos[i].col; c < pos[i].col + it.span; c++) {
        assert.equal(grade[r][c], -1, `sobreposição em linha ${r}, coluna ${c}`);
        grade[r][c] = i;
      }
    }
  });
  return grade;
}

test(
  "grade só com 1, 2 ou 4 colunas — o layout montado em 1366 é o mesmo em 1920",
  withDom("<body></body>", async () => {
    const { colsForWidth } = await grid();
    assert.deepEqual([500, 800, 1200, 1640, 2300, 3400].map(colsForWidth), [1, 2, 4, 4, 4, 4]);
  })
);

test(
  "cards de alturas diferentes não deixam buraco: o seguinte sobe pro espaço livre",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    // núcleo em 6 colunas: dois de meia largura com alturas diferentes, depois três de 2/6
    const items = [
      { span: 3, rows: 100 },
      { span: 3, rows: 60 },
      { span: 2, rows: 40 },
      { span: 2, rows: 40 },
      { span: 2, rows: 40 },
    ];
    const pos = packLayout(items, 6);
    ocupacao(items, pos, 6);
    assert.deepEqual([pos[0].col, pos[0].row], [1, 1]);
    assert.deepEqual([pos[1].col, pos[1].row], [4, 1]);
    // o 3º cabe sob o card mais baixo (coluna 4, linha 61), não lá embaixo
    assert.deepEqual([pos[2].col, pos[2].row], [4, 61]);
  })
);

test(
  "o card fixo (perfil) fica sempre em 1/1 e ninguém entra por cima dele",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const items = [{ span: 3, rows: 50, pinned: true }, { span: 3, rows: 30 }, { span: 6, rows: 20 }];
    const pos = packLayout(items, 6);
    ocupacao(items, pos, 6);
    assert.deepEqual([pos[0].col, pos[0].row], [1, 1]);
    assert.deepEqual([pos[2].col, pos[2].row], [1, 51]);
  })
);

test(
  "widget readicionado no fim entra no ponto mais alto livre, sem frestas (P-23)",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const items = [
      { span: 4, rows: 80 },
      { span: 2, rows: 30 },
      { span: 2, rows: 30 }, // empilha sob o anterior, à direita
      { span: 2, rows: 30 }, // o readicionado: vai pro buraco que sobra à direita
    ];
    const pos = packLayout(items, 6);
    ocupacao(items, pos, 6);
    assert.deepEqual([pos[3].col, pos[3].row], [5, 61]);
  })
);

test(
  "largura maior que a grade é limitada e uma coluna empilha tudo na ordem",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const pos = packLayout([{ span: 6, rows: 10 }, { span: 3, rows: 5 }, { span: 2, rows: 7 }], 1);
    assert.deepEqual(pos.map(({ col, row }) => ({ col, row })), [{ col: 1, row: 1 }, { col: 1, row: 11 }, { col: 1, row: 16 }]);
  })
);

test(
  "ninguém estica nem alarga: cada card fica do tamanho dele",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const items = [{ span: 3, rows: 40 }, { span: 2, rows: 50 }, { span: 6, rows: 20 }];
    const pos = packLayout(items, 6);
    ocupacao(items, pos, 6);
    assert.deepEqual(pos.map((p) => p.span), [3, 2, 6]);
    assert.deepEqual(pos.map((p) => p.rows), [40, 50, 20]);
    // o largo vai embaixo do mais baixo dos dois de cima
    assert.equal(pos[2].row, 51);
  })
);

test(
  "gráficos lado a lado com alturas diferentes: o largo fica embaixo do mais baixo e o vão do mais curto é ocupado",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    // finanças em 4 colunas: resumo (2) | entradas×saídas (1) | evolução (1), wallet (2) embaixo
    // dos gráficos, depois um widget de 1 coluna que cabe no vão embaixo da evolução
    const items = [
      { span: 2, rows: 40 }, // resumo
      { span: 1, rows: 70 }, // entradas × saídas (mais alto)
      { span: 1, rows: 55 }, // evolução (mais curto)
      { span: 2, rows: 90 }, // wallet
      { span: 1, rows: 15 }, // cabe no vão de 15 linhas embaixo da evolução
      { span: 1, rows: 30 }, // não cabe em vão nenhum
    ];
    const pos = packLayout(items, 4);
    ocupacao(items, pos, 4);
    assert.deepEqual(pos.map((p) => p.rows), [40, 70, 55, 90, 15, 30], "ninguém estica");
    // a wallet sobe pro lugar mais alto em que cabe: embaixo do resumo
    assert.deepEqual([pos[3].col, pos[3].row], [1, 41]);
    // o pequeno vai pro vão embaixo da evolução (coluna 4, logo abaixo dela)
    assert.deepEqual([pos[4].col, pos[4].row], [4, 56]);
    // o seguinte, sem vão que caiba, vai pro ponto mais alto que sobrou
    assert.deepEqual([pos[5].col, pos[5].row], [3, 71]);
  })
);

test(
  "widget largo embaixo de dois de alturas diferentes fica logo abaixo do mais baixo, e o vão é preenchido",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    // grade de 2 colunas: os dois gráficos ocupam a largura toda
    const items = [
      { span: 1, rows: 70 }, // gráfico mais alto
      { span: 1, rows: 50 }, // gráfico mais curto
      { span: 2, rows: 100 }, // wallet: largura dos dois → embaixo do mais baixo
      { span: 1, rows: 20 }, // cabe no vão de 20 embaixo do curto
      { span: 1, rows: 30 }, // não cabe: vai embaixo da wallet
    ];
    const pos = packLayout(items, 2);
    ocupacao(items, pos, 2);
    assert.deepEqual([pos[2].col, pos[2].row], [1, 71]);
    assert.deepEqual([pos[3].col, pos[3].row], [2, 51]);
    assert.deepEqual([pos[4].col, pos[4].row], [1, 171]);
  })
);
