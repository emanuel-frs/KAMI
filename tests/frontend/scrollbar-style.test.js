// AJU-04 — scroll "blocos listrados" igual no Linux (WebKitGTK) e no
// Windows (WebView2/Chromium).
//
// O Chromium (≥121) IGNORA o ::-webkit-scrollbar de qualquer elemento que
// tenha `scrollbar-width` ou `scrollbar-color` — foi assim que o scroll do
// Windows ficou anos como a barra nativa. Regra: essas propriedades só
// podem aparecer dentro de `@supports not selector(::-webkit-scrollbar)`
// (Firefox), ou como `scrollbar-width: none` (esconder de propósito).
// Barra mais fina se faz com `--scrollbar-w` no elemento.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : []
  );
}

// CSS injetado por JS também conta (custom-select.js monta o próprio <style>)
const SOURCES = [...cssFiles("frontend/css"), "frontend/js/components/custom-select.js"];

/** Remove comentários e o conteúdo dos blocos @supports not selector(::-webkit-scrollbar). */
function outsideFirefoxFallback(css) {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const marker = /@supports\s+not\s+selector\(::-webkit-scrollbar\)\s*\{/g;
  let m;
  while ((m = marker.exec(s))) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < s.length && depth; i++) depth += s[i] === "{" ? 1 : s[i] === "}" ? -1 : 0;
    s = s.slice(0, m.index) + s.slice(i);
    marker.lastIndex = m.index;
  }
  return s;
}

test("nenhum css declara scrollbar-width/scrollbar-color fora do fallback do Firefox", () => {
  for (const file of SOURCES) {
    const css = outsideFirefoxFallback(readFileSync(file, "utf8"));
    for (const [decl, prop, value] of css.matchAll(/(scrollbar-(?:width|color))\s*:\s*([^;}]+)/g)) {
      if (prop === "scrollbar-width" && value.trim() === "none") continue;
      assert.fail(`${file}: "${decl.trim()}" desliga o ::-webkit-scrollbar no Chromium/Windows — use --scrollbar-w`);
    }
  }
});

test("base.css tem o fallback do Firefox e o thumb listrado sem cantos", () => {
  const css = readFileSync("frontend/css/base.css", "utf8");
  assert.match(css, /@supports\s+not\s+selector\(::-webkit-scrollbar\)\s*\{\s*\*\s*\{\s*scrollbar-width:\s*thin/);
  const thumb = css.match(/::-webkit-scrollbar-thumb\s*\{([^}]*)\}/)[1];
  assert.match(thumb, /border-radius:\s*0/);
  assert.match(thumb, /repeating-linear-gradient/);
  assert.match(css, /::-webkit-scrollbar\s*\{\s*width:\s*var\(--scrollbar-w\)/);
});
