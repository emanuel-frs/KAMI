// ORG-01 — markdown das notas ⇄ DOM do editor (components/nota-markdown.js).
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { markdownParaDom, domParaMarkdown } from "../../frontend/js/components/nota-markdown.js";

const { document: doc } = new JSDOM("<body></body>").window;

function html(md) {
  const box = doc.createElement("div");
  box.append(markdownParaDom(md, doc));
  return box;
}
const idaEVolta = (md) => domParaMarkdown(html(md));
function domDe(htmlStr) {
  const box = doc.createElement("div");
  box.innerHTML = htmlStr; // só no teste: imita o que o contenteditable produz
  return box;
}

test("ida e volta preserva cada formato", () => {
  const casos = [
    "# Título\n\n## Sub\n\n### Menor",
    "texto **negrito**, _itálico_, ++sublinhado++, ~~tachado~~ e `código`",
    "veja [o site](https://kami.app/x?a=1)",
    "- um\n- dois\n  - dois.um\n  - dois.dois\n- três",
    "1. primeiro\n2. segundo",
    "- [ ] fazer\n- [x] feito",
    "> citação\n> segunda linha",
    "```\nconst x = 1;\n  indentado\n```",
    "antes\n\n---\n\ndepois",
    "| nome | valor |\n| --- | --- |\n| pão | 5 |\n| leite | 6 |",
    "linha um\nlinha dois no mesmo parágrafo",
    "**negrito com _itálico_ dentro**",
  ];
  for (const md of casos) assert.equal(idaEVolta(md), md, md);
});

test("texto com caracteres de markdown é escapado e volta igual", () => {
  const md = "preço \\*promo\\* não é itálico: 2 \\* 3, a\\_b, \\[x\\] e \\# no meio";
  const el = html(md);
  assert.equal(el.querySelector("em"), null);
  assert.match(el.textContent, /2 \* 3, a_b, \[x\]/);
  // escrever esses caracteres no editor e salvar não vira formatação
  const p = domDe("<p># não é título e - não é lista e **nem negrito**</p>");
  const salvo = domParaMarkdown(p);
  assert.equal(html(salvo).querySelector("h1, ul, strong"), null);
  assert.equal(html(salvo).textContent, "# não é título e - não é lista e **nem negrito**");
});

test("monta o DOM com os elementos certos", () => {
  const el = html("# T\n\n- [x] ok\n- [ ] não\n\n1. a\n\n| a |\n| - |\n| 1 |");
  assert.ok(el.querySelector("h1"));
  const tarefas = el.querySelectorAll("ul > li[data-checked]");
  assert.deepEqual([...tarefas].map((li) => li.dataset.checked), ["true", "false"]);
  assert.ok(el.querySelector("ol > li"));
  assert.equal(el.querySelector("table thead th").textContent, "a");
  assert.equal(el.querySelector("table tbody td").textContent, "1");
});

test("link perigoso não vira <a>; HTML no markdown é só texto", () => {
  const el = html("[clique](javascript:alert(1)) <img src=x onerror=alert(1)> <script>x</script>");
  assert.equal(el.querySelector("a, img, script"), null);
  assert.match(el.textContent, /<img src=x onerror=alert\(1\)>/);
});

test("aceita o que o contenteditable produz (div, b, i, span com estilo, br)", () => {
  const md = domParaMarkdown(
    domDe(
      '<div>linha <b>forte</b> e <i>leve</i></div><div><span style="font-weight: 700">span</span> <span style="text-decoration: line-through">riscado</span></div><div><br></div><div>a<br>b</div>'
    )
  );
  assert.equal(md, "linha **forte** e _leve_\n\n**span** ~~riscado~~\n\na\nb");
});

test("colagem de HTML de fora vira markdown limpo (sem img/script/estilo)", () => {
  const colado = domDe(
    '<meta charset="utf-8"><h2 style="color:red">Plano</h2><p>Leia <a href="https://x.com" onclick="evil()">isto</a><img src="https://t.co/p.gif"></p><script>alert(1)</script><ul><li>um</li><li>dois</li></ul>'
  );
  assert.equal(domParaMarkdown(colado), "## Plano\n\nLeia [isto](https://x.com)\n\n- um\n- dois");
});

test("marcas não engolem espaços das pontas", () => {
  assert.equal(domParaMarkdown(domDe("<p>a<b> forte </b>b</p>")), "a **forte** b");
});

test("listas mistas e numeração recomeçam certo", () => {
  const md = "- a\n- b\n\n1. x\n2. y\n\n- [ ] t";
  assert.equal(idaEVolta(md), md);
  // tarefa e item comum na mesma lista
  assert.equal(idaEVolta("- comum\n- [ ] tarefa\n- [x] feita"), "- comum\n- [ ] tarefa\n- [x] feita");
});

test("espaço invisível depois de código não vai pro markdown", () => {
  assert.equal(domParaMarkdown(domDe("<p>a <code>x</code>\u200b b</p>")), "a `x` b");
});

test("markdown vazio ou só espaços não gera nada", () => {
  assert.equal(html("").childNodes.length, 0);
  assert.equal(domParaMarkdown(domDe("<div><br></div><p> </p>")), "");
});

test("citações vizinhas (uma por Enter no editor) viram uma só", () => {
  assert.equal(domParaMarkdown(domDe("<blockquote>a</blockquote><blockquote>b</blockquote><blockquote><br></blockquote><p>fim</p>")), "> a\n> b\n\nfim");
});
