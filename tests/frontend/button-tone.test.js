// AJU-03 — botões de cor própria (.danger/.warn) não podem pegar a cor do
// tema em nenhum estado (hover, foco, brilho, clique, desabilitado).
//
// O jsdom não aplica :hover nem resolve var(), então o teste é estático:
// lê os .css de verdade e confere que toda regra de ESTADO de .btn usa
// var(--btn-tone, var(--accent)) em vez de var(--accent) puro — é essa
// variável que .danger/.warn sobrescrevem. Uma regra nova que esqueça
// disso (o bug original: `.btn:hover { border-color: var(--accent) }`)
// quebra aqui.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS_FILES = ["frontend/css/widgets/forms.css", "frontend/css/fx.css"];

/** Regras "folha" ({seletor, corpo}) de um css, sem comentários; o
 *  conteúdo de @media entra como regras normais. */
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const selector = m[1].replace(/@media[^{]*$/, "").trim();
    out.push({ selector, body: m[2] });
  }
  return out;
}

const all = CSS_FILES.flatMap((f) => rules(readFileSync(f, "utf8")).map((r) => ({ ...r, file: f })));

test("regras de estado do .btn usam --btn-tone, não a cor do tema pura", () => {
  const state = all.filter((r) => /\.btn\b[^,]*:(hover|focus-visible|active)/.test(r.selector));
  assert.ok(state.length >= 4, "esperava achar as regras de hover/foco/clique do .btn");
  for (const r of state) {
    const bare = r.body.replace(/var\(--btn-tone,\s*var\(--accent\)\)/g, "");
    assert.ok(
      !/var\(--accent\)/.test(bare),
      `${r.file}: "${r.selector}" usa var(--accent) sem passar por --btn-tone`
    );
  }
});

test(".danger é vermelho e .warn é âmbar via --btn-tone", () => {
  const tone = (cls) =>
    all.find((r) => r.selector === `.btn.${cls}` && /--btn-tone/.test(r.body))?.body.match(/--btn-tone:\s*([^;]+)/)?.[1].trim();
  assert.equal(tone("danger"), "var(--red)");
  assert.equal(tone("warn"), "var(--amber)");
});

test("hover cheio de .danger/.warn não vale pra botão desabilitado", () => {
  const filled = all.filter((r) => /\.btn\.(danger|warn):hover/.test(r.selector) && /background:\s*var\(--btn-tone\)/.test(r.body));
  assert.ok(filled.length > 0);
  for (const r of filled) assert.match(r.selector, /:not\(:disabled\)/);
});
