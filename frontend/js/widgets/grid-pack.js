/**
 * Encaixe dos widgets na grade — as funções puras de grid.js (quantas
 * colunas e onde cada card vai), separadas do código de DOM pra serem
 * testadas sozinhas (tests/frontend/grid-pack.test.js).
 */

// largura real do container → número de colunas reais da grade.
//
// LAY-03: só 1, 2 ou 4 colunas. Antes, a partir de 1400px a grade crescia
// (7, 8… colunas, depois 6), mas o layout montado numa tela 1366 (4
// colunas: 2/6 → 1, 3/6 → 2, 4/6 → 3) não fechava em 6 colunas (2/6 + 2/6
// + 3/6 = 7/6) e o desenho se desfazia em telas maiores. Com 4 colunas em
// qualquer tela grande, as faixas são as mesmas em 1366 e em 1920 — os
// widgets só ficam mais largos.
export function colsForWidth(w) {
  if (w < 680) return 1;
  if (w < 1000) return 2;
  return 4;
}

/**
 * Empacotamento dos cards (LAY-03/04): decide a coluna e a linha de cada
 * card, em ordem. Antes a posição ficava com o `grid-auto-flow: dense` do
 * navegador, que com cards de alturas diferentes deixava buracos e jogava
 * um widget readicionado em qualquer fresta (P-23).
 *
 * Cada card vai pro lugar livre MAIS ALTO em que ele cabe inteiro (e, na
 * mesma altura, o mais à esquerda) — sem esticar ninguém: cada widget fica
 * do tamanho dele. Dois gráficos lado a lado podem ter alturas diferentes;
 * o widget largo que vem embaixo deles fica logo abaixo do mais baixo dos
 * dois (o espaço entre widgets é sempre o mesmo, a margem já está em
 * `rows`), e o vão que sobra embaixo do mais curto é ocupado pelo primeiro
 * widget seguinte que couber nele. (Antes, a faixa fechava e o mais curto
 * esticava até a base do vizinho: widget pequeno ficava enorme e vazio, e
 * nem dava pra diminuí-lo.) O card fixo (perfil) fica sempre em 1/1.
 *
 * Função pura (tests/frontend/grid-pack.test.js) — o resto de grid.js é DOM:
 *   itens = [{ span, rows, pinned? }]   span em colunas reais, rows em linhas de 4px
 *   → [{ col, row, span, rows }]        1-based
 */
export function packLayout(items, cols) {
  const postos = []; // já encaixados, 0-based
  const livre = (col, row, s, r) =>
    postos.every((p) => col + s <= p.col || p.col + p.span <= col || row + r <= p.row || p.row + p.rows <= row);

  for (const { span, rows, pinned } of items) {
    const s = Math.max(1, Math.min(cols, span));
    const r = Math.max(1, rows);
    // o topo de um lugar livre "encosta" em cima: na linha 0 ou na base de alguém
    const linhas = [...new Set([0, ...postos.map((p) => p.row + p.rows)])].sort((a, b) => a - b);
    const ultimaCol = pinned ? 0 : cols - s;
    let lugar = null;
    for (const row of linhas) {
      for (let col = 0; col <= ultimaCol && !lugar; col++) if (livre(col, row, s, r)) lugar = { col, row };
      if (lugar) break;
    }
    postos.push({ col: lugar.col, row: lugar.row, span: s, rows: r });
  }

  return postos.map((k) => ({ col: k.col + 1, row: k.row + 1, span: k.span, rows: k.rows }));
}
