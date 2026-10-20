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
  "nunca alarga um card pros lados, e sem alinhar (resize manual) não cresce ninguém",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const items = [{ span: 3, rows: 40 }, { span: 2, rows: 50 }, { span: 6, rows: 20 }];
    const pos = packLayout(items, 6);
    ocupacao(items, pos, 6);
    assert.deepEqual(pos.map((p) => p.span), [3, 2, 6]);
    // o de baixo começa depois do mais alto; o vão embaixo do 1º fecha
    assert.equal(pos[2].row, 51);
    assert.equal(pos[0].rows, 50);
    assert.deepEqual(packLayout(items, 6, { alinhar: false }).map((p) => p.rows), [40, 50, 20]);
  })
);

test(
  "faixas: vizinhos de lado terminam juntos e a faixa seguinte começa reta (núcleo)",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    // missões 64 | registrar 57; galeria 114 | log 77, e embaixo do log radar + prioridades
    const items = [
      { span: 2, rows: 64 },
      { span: 2, rows: 57 },
      { span: 2, rows: 114 },
      { span: 2, rows: 77 },
      { span: 1, rows: 59 },
      { span: 1, rows: 48 },
    ];
    const pos = packLayout(items, 4);
    const fim = (p) => p.row + p.rows;
    assert.equal(fim(pos[0]), fim(pos[1])); // registrar cresceu até a base de missões
    assert.equal(pos[2].row, pos[3].row); // galeria e log começam na mesma linha
    // radar e prioridades empilham embaixo do log, lado a lado
    assert.deepEqual([pos[4].col, pos[4].row, pos[5].col, pos[5].row], [3, fim(pos[3]), 4, fim(pos[3])]);
    // e tudo termina junto: a galeria cresce até a pilha
    assert.equal(fim(pos[2]), fim(pos[4]));
    assert.equal(fim(pos[4]), fim(pos[5]));
    assert.deepEqual(pos.map((p) => p.span), [2, 2, 2, 2, 1, 1]);
  })
);

test(
  "pilha ao lado de um card alto não estica o de cima (perfil: radar + atividade embaixo do perfil)",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const items = [{ span: 2, rows: 75, pinned: true }, { span: 2, rows: 141 }, { span: 1, rows: 62 }, { span: 1, rows: 64 }];
    const pos = packLayout(items, 4);
    assert.equal(pos[0].rows, 75); // o perfil fica do tamanho dele
    assert.deepEqual([pos[2].row, pos[3].row], [76, 76]);
    assert.equal(pos[2].row + pos[2].rows, pos[1].row + pos[1].rows);
    assert.equal(pos[3].row + pos[3].rows, pos[1].row + pos[1].rows);
  })
);

test(
  "card que não cabe nem pela metade na faixa abre uma faixa nova",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    // 60 | 20; o seguinte (100) caberia embaixo do de 20, mas só 40 dele ficariam na faixa
    const pos = packLayout([{ span: 2, rows: 60 }, { span: 2, rows: 20 }, { span: 2, rows: 100 }], 4);
    assert.equal(pos[1].rows, 60); // a faixa fechou: o baixo cresceu
    assert.equal(pos[2].row, 61);
  })
);
