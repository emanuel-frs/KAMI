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
 * Empacotamento dos cards (LAY-03/04): decide a coluna, a linha e a altura
 * DESENHADA de cada card, em ordem. Antes a posição ficava com o
 * `grid-auto-flow: dense` do navegador, que com cards de alturas diferentes
 * deixava buracos e jogava um widget readicionado em qualquer fresta (P-23).
 *
 * Em FAIXAS — o que importa pro olho é o alinhamento, não o espaço vazio:
 * - os primeiros cards da faixa vão lado a lado, da esquerda pra direita,
 *   no topo dela;
 * - o seguinte empilha embaixo do mais baixo da faixa (pilha: radar +
 *   atividade embaixo do perfil, ao lado da galeria) se pelo menos metade
 *   dele couber até a base da faixa — ou se a faixa ainda tem coluna livre
 *   no topo; senão, começa uma faixa nova;
 * - quando a faixa fecha, o último card de cada coluna cresce até a base
 *   dela: todos terminam na mesma linha e a faixa seguinte começa reta.
 * Nunca alarga pros lados, e quem cresce só ganha espaço vazio embaixo —
 * o conteúdo (gráficos inclusive) mantém o tamanho dele. É isso que segura
 * o desenho quando os dados fazem um widget crescer além da altura do
 * layout padrão. O card fixo (perfil) fica sempre em 1/1.
 *
 * Sem `alinhar` (durante o resize manual, pra pessoa ver a altura que
 * está escolhendo): só o encaixe no ponto mais alto, sem crescer ninguém.
 *
 * Função pura (tests/frontend/grid-pack.test.js) — o resto de grid.js é DOM:
 *   itens = [{ span, rows, pinned? }]   span em colunas reais, rows em linhas de 4px
 *   → [{ col, row, span, rows }]        1-based; rows já com o crescimento
 */
export function packLayout(items, cols, { alinhar = true } = {}) {
  const sky = new Array(cols).fill(0); // próxima linha livre de cada coluna
  const dono = new Array(cols).fill(null); // card cuja base define sky[c]
  const cards = [];
  const base = (k) => k.row + k.rows;
  let topoFaixa = 0;
  let baseFaixa = 0;

  // só cresce quem ainda é a superfície inteira das colunas dele
  const cresce = (k, ate) => {
    if (!k || base(k) >= ate) return;
    if ([...Array(k.span).keys()].some((i) => dono[k.col + i] !== k)) return;
    k.rows = ate - k.row;
    for (let c = k.col; c < k.col + k.span; c++) sky[c] = ate;
  };

  const fecharFaixa = () => {
    // só quem é desta faixa (coluna vazia nela fica vazia — não puxa o de cima)
    for (let c = 0; c < cols; c++) if (dono[c]?.row >= topoFaixa) cresce(dono[c], baseFaixa);
    sky.fill(Math.max(baseFaixa, ...sky));
    topoFaixa = baseFaixa = sky[0];
  };

  const melhorLugar = (s, pinned) => {
    let col = 0;
    let top = Infinity;
    const last = pinned ? 0 : cols - s;
    for (let c = 0; c <= last; c++) {
      const t = Math.max(...sky.slice(c, c + s));
      if (t < top) {
        col = c;
        top = t;
      }
    }
    return { col, top };
  };

  for (const { span, rows, pinned } of items) {
    const s = Math.max(1, Math.min(cols, span));
    const r = Math.max(1, rows);
    let { col, top } = melhorLugar(s, pinned);
    // na faixa: no topo dela (lado a lado), empilhado com metade cabendo,
    // ou enquanto ela ainda tiver coluna livre no topo (os próximos cards
    // ainda vão completar a largura dela)
    const cabe = top === topoFaixa || baseFaixa - top >= r / 2 || sky.some((v) => v === topoFaixa);
    if (alinhar && cards.length && !cabe) {
      fecharFaixa();
      ({ col, top } = melhorLugar(s, pinned));
    }
    // vão embaixo de quem ficou por cima (o vizinho dele era mais alto):
    // ele desce até este card
    if (alinhar) for (let c = col; c < col + s; c++) if (sky[c] < top) cresce(dono[c], top);

    const k = { col, row: top, span: s, rows: r };
    cards.push(k);
    for (let c = col; c < col + s; c++) {
      sky[c] = top + r;
      dono[c] = k;
    }
    baseFaixa = Math.max(baseFaixa, top + r);
  }
  if (alinhar) fecharFaixa();

  return cards.map((k) => ({ col: k.col + 1, row: k.row + 1, span: k.span, rows: k.rows }));
}
