/**
 * Alternativa em texto pra conteúdo visual (item 5 das pendências:
 * "as células do heatmap e os gráficos de finanças não têm equivalente
 * em texto pra leitor de tela").
 *
 * Gráficos SVG e heatmaps aqui já têm tooltip visual (hover/foco), mas
 * tooltip não é lido por leitor de tela nenhum sozinho — só o
 * texto/estrutura que fica na árvore de acessibilidade. Em vez de tentar
 * anotar cada <path>/<circle>/<div> individualmente (frágil, e ainda
 * assim um SVG decorativo não vira uma leitura fluida), o padrão usado
 * em todo o app é: o elemento visual leva aria-hidden="true", e uma
 * <table> irmã, escondida com .sr-only (mesma classe de widgets/grid.css
 * — não usa display:none, que tiraria da árvore de acessibilidade),
 * carrega os mesmos dados em linhas/colunas de verdade.
 *
 * buildTextAltTable({ caption, headers, rows })
 *   caption — resumo de uma linha do que o gráfico mostra.
 *   headers — nomes das colunas.
 *   rows    — array de arrays de células já formatadas como string.
 * Retorna o HTML pronto pra injetar junto do elemento visual
 * (ex.: `${chartHtml}${buildTextAltTable({...})}`).
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildTextAltTable({ caption, headers, rows }) {
  const theadHtml = headers?.length
    ? `<thead><tr>${headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead>`
    : "";
  const tbodyHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  // .sr-only direto na <table> não é suficiente: <caption> tem uma regra
  // de dimensionamento própria (não segue table-layout: fixed) que pode
  // forçar a largura da tabela de volta pro tamanho do conteúdo mesmo
  // com width:1px — foi o que manteve o scroll fantasma mesmo depois do
  // primeiro conserto. Um <div> comum sempre respeita width/overflow de
  // verdade (não tem esse comportamento especial de tabela), então o
  // corte vai no <div> por fora, e a <table>/<caption> por dentro podem
  // tentar ficar do tamanho que quiserem — não escapam mais do div.
  return `
    <div class="sr-only">
      <table>
        <caption>${escapeHtml(caption)}</caption>
        ${theadHtml}
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;
}
