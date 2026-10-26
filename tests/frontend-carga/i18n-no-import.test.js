// I18N-02: t("chave") avaliado quando o módulo é importado (constante no topo
// do arquivo) roda ANTES de o dicionário chegar e congela o texto — sai a
// chave crua, e trocar o idioma não muda nada. Aqui todo módulo do frontend
// é importado sem dicionário: qualquer t() durante o import é um desses.
// Correção: transformar a constante em função (ex.: `const passos = () => [...]`).
//
// Fica fora de tests/frontend/ de propósito: importar TODOS os módulos
// derrubaria a cobertura do test:coverage (o Node conta todo arquivo
// importado), então ele roda à parte nos dois scripts do package.json.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const RAIZ = fileURLToPath(new URL("../../frontend/js/", import.meta.url));
const arquivos = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith(".js") ? [p] : [];
  });

test("nenhum módulo chama t() no import", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  for (const k of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "Node", "CustomEvent", "Event", "KeyboardEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame"]) {
    try {
      // o do jsdom sempre: Event do node não serve pro dispatchEvent do jsdom
      globalThis[k] = k === "requestAnimationFrame" ? (fn) => setTimeout(fn, 0) : dom.window[k];
    } catch {
      /* alguns globais do node são só leitura */
    }
  }
  const i18n = await import(pathToFileURL(join(RAIZ, "i18n.js")).href);
  i18n.usarDicionarios("pt", {}, {});
  const avisos = [];
  const warn = console.warn;
  console.warn = (msg) => {
    if (String(msg).startsWith("i18n: chave sem texto")) avisos.push(String(msg));
  };
  const problemas = [];
  let importados = 0;
  try {
    for (const f of arquivos(RAIZ)) {
      // vendor é de fora; app.js e titlebar.js ligam o app inteiro ao importar
      if (f.includes(join("js", "vendor")) || /[\\/](app|titlebar)\.js$/.test(f)) continue;
      const antes = avisos.length;
      try {
        await import(pathToFileURL(f).href);
      } catch {
        continue; // módulo que precisa do app de verdade pra importar: fica de fora
      }
      importados++;
      if (avisos.length > antes) problemas.push(`${relative(RAIZ, f)}: ${avisos.slice(antes).join(", ")}`);
    }
  } finally {
    console.warn = warn;
  }
  // se quase nada importa, o teste não está olhando nada
  assert.ok(importados > 150, `só ${importados} módulos importaram`);
  assert.deepEqual(problemas, [], "t() no topo do módulo — vire função pra rodar na hora de desenhar");
});
