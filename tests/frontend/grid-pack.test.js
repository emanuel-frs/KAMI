// LAY-03/04 — empacotamento dos widgets (widgets/grid.js: packLayout, colsForWidth).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

async function grid() {
  return import("../../frontend/js/widgets/grid.js");
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
  "grade só com 1, 2, 4 ou 6 colunas — 7 colunas com larguras em sextos deixava buraco",
  withDom("<body></body>", async () => {
    const { colsForWidth } = await grid();
    assert.deepEqual([500, 800, 1200, 1640, 2300, 3400].map(colsForWidth), [1, 2, 4, 6, 6, 6]);
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
  "o empacotamento nunca estica um card: a largura e a altura são as dele",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    // 3/6 + 2/6 deixa uma coluna livre, e o 1º é mais baixo que o vizinho:
    // antes o 2º alargava até a borda e o 1º descia até o de baixo
    const items = [{ span: 3, rows: 40 }, { span: 2, rows: 50 }, { span: 6, rows: 20 }];
    const pos = packLayout(items, 6);
    ocupacao(items, pos, 6);
    assert.deepEqual(pos.map((p) => [p.span, p.rows]), [[3, 40], [2, 50], [6, 20]]);
    assert.equal(pos[2].row, 51);
    assert.deepEqual(packLayout([{ span: 2, rows: 10 }], 6), [{ col: 1, row: 1, span: 2, rows: 10 }]);
  })
);
