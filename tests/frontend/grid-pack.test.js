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
    const pos = packLayout(items, 6, { fill: false });
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
    const pos = packLayout(items, 6, { fill: false });
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
    const pos = packLayout(items, 6, { fill: false });
    ocupacao(items, pos, 6);
    assert.deepEqual([pos[3].col, pos[3].row], [5, 61]);
  })
);

test(
  "largura maior que a grade é limitada e uma coluna empilha tudo na ordem",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const pos = packLayout([{ span: 6, rows: 10 }, { span: 3, rows: 5 }, { span: 2, rows: 7 }], 1, { fill: false });
    assert.deepEqual(pos.map(({ col, row }) => ({ col, row })), [{ col: 1, row: 1 }, { col: 1, row: 11 }, { col: 1, row: 16 }]);
  })
);

test(
  "preenchimento: a coluna que sobra numa linha (3/6 + 2/6) é ocupada pelo vizinho",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const items = [{ span: 3, rows: 40 }, { span: 2, rows: 50 }, { span: 6, rows: 20 }];
    const pos = packLayout(items, 6);
    ocupacao(items.map((it, i) => ({ ...it, span: pos[i].span, rows: pos[i].rows })), pos, 6);
    assert.deepEqual([pos[1].col, pos[1].span], [4, 3]); // o gráfico estica até a borda
    // o resumo (40) encosta no de baixo (que começa na 51): vão de 10 linhas fechado
    assert.equal(pos[0].rows, 50);
    assert.equal(pos[2].row, 51);
  })
);

test(
  "preenchimento não estica pra baixo o último card (vão aberto) nem um vão grande",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const pos = packLayout([{ span: 3, rows: 20 }, { span: 3, rows: 200 }, { span: 3, rows: 30 }], 6);
    // 3º vai sob o 1º; o 1º não estica (vão = 0); o 3º é o último da coluna: fica como está
    assert.equal(pos[2].row, 21);
    assert.equal(pos[2].rows, 30);
    const grande = packLayout([{ span: 3, rows: 20 }, { span: 3, rows: 300 }, { span: 6, rows: 10 }], 6);
    // vão de 280 linhas embaixo do 1º: grande demais pra esticar (vira só um vazio)
    assert.equal(grande[0].rows, 20);
  })
);

test(
  "durante o resize manual não estica (a pessoa vê a largura que escolheu)",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    const pos = packLayout([{ span: 2, rows: 10 }], 6, { fill: false });
    assert.equal(pos[0].span, 2);
    assert.equal(packLayout([{ span: 2, rows: 10 }], 6)[0].span, 6);
  })
);

test(
  "nivelamento: coluna da direita 40px mais baixa estica e a faixa seguinte começa reta",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    // lançamentos (3/6, 130) | contas fixas (3/6, 70) + dívidas (3/6, 50) = 120: 10 linhas de degrau
    const items = [
      { span: 3, rows: 130 },
      { span: 3, rows: 70 },
      { span: 3, rows: 50 },
      { span: 2, rows: 40 },
      { span: 2, rows: 40 },
      { span: 2, rows: 40 },
    ];
    const pos = packLayout(items, 6);
    ocupacao(items.map((it, i) => ({ ...it, span: pos[i].span, rows: pos[i].rows })), pos, 6);
    assert.equal(pos[2].row + pos[2].rows, 131); // dívidas desceu até a base dos lançamentos
    assert.deepEqual(pos.slice(3).map((p) => [p.col, p.row]), [[1, 131], [3, 131], [5, 131]]);
  })
);

test(
  "nivelamento tem teto acumulado: um card não estica duas vezes até virar um bloco vazio",
  withDom("<body></body>", async () => {
    const { packLayout } = await grid();
    // Carreira: posições (60) | formação (45); área (40) embaixo das posições; interesses (35)
    const items = [{ span: 3, rows: 60 }, { span: 3, rows: 45 }, { span: 3, rows: 40 }, { span: 3, rows: 35 }];
    const pos = packLayout(items, 6);
    ocupacao(items.map((it, i) => ({ ...it, span: pos[i].span, rows: pos[i].rows })), pos, 6);
    assert.ok(pos[1].rows - 45 <= Math.min(40, 23), `formação esticou ${pos[1].rows - 45} linhas`);
    // interesses vai pra baixo da formação (lado direito), não pra esquerda
    assert.equal(pos[3].col, 4);
  })
);
