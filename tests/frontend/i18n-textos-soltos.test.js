// I18N-01 — "catraca" dos textos soltos: frase em português escrita direto
// num .js (em vez de vir de t("chave")) não aparece nos outros 9 idiomas.
// Hoje ainda há muitas (o I18N-02 extrai todas); o que este teste garante é
// que NENHUM arquivo ganha texto solto novo e que a conta só desce.
//
// A linha de base fica em i18n-textos-soltos.json (por arquivo). Baixou num
// arquivo? Atualize a linha de base:
//   KAMI_ATUALIZAR_SOLTOS=1 node --test tests/frontend/i18n-textos-soltos.test.js
//
// "Texto solto" é aproximado: literal de string (fora de comentário) com
// acento do português ou uma palavra comum (não, pra, com, você…). Pega
// quase tudo o que importa; o que for falso positivo cai junto quando o
// arquivo for extraído.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const BASE = fileURLToPath(new URL("./i18n-textos-soltos.json", import.meta.url));
const PT = /[ãõçáéíóúâêôà]|\b(não|pra|para|com|uma|seu|sua|você|nenhum|sem|mais|aqui|ainda|tela|salvar|apagar|criar|cancelar|confirmar|fechar|erro)\b/i;

const arquivos = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith(".js") ? [p] : [];
  });

export function contarSoltos(fonte) {
  const semComentarios = fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:"'`])\/\/.*$/gm, "$1");
  const literais = [...semComentarios.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3]
  );
  return literais.filter((s) => PT.test(s.replace(/\$\{[^}]*\}/g, ""))).length;
}

function contagemAtual() {
  const por = {};
  for (const f of arquivos(join(RAIZ, "frontend", "js"))) {
    if (f.endsWith(join("js", "i18n.js"))) continue;
    const n = contarSoltos(readFileSync(f, "utf8"));
    if (n) por[relative(RAIZ, f).split("\\").join("/")] = n;
  }
  return por;
}

test("nenhum arquivo ganha texto em português fora dos dicionários (e a conta só desce)", () => {
  const atual = contagemAtual();
  if (process.env.KAMI_ATUALIZAR_SOLTOS === "1") {
    writeFileSync(BASE, JSON.stringify(atual, null, 2) + "\n");
    return;
  }
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const subiram = Object.entries(atual).filter(([f, n]) => n > (base[f] ?? 0));
  assert.deepEqual(
    subiram.map(([f, n]) => `${f}: ${base[f] ?? 0} → ${n}`),
    [],
    "texto solto novo — use t(\"chave\") e ponha o texto nos 10 dicionários (frontend/i18n/)"
  );
  const desceram = Object.entries(base).filter(([f, n]) => (atual[f] ?? 0) < n);
  assert.deepEqual(
    desceram.map(([f, n]) => `${f}: ${n} → ${atual[f] ?? 0}`),
    [],
    "menos texto solto (boa!) — atualize a linha de base: KAMI_ATUALIZAR_SOLTOS=1 node --test tests/frontend/i18n-textos-soltos.test.js"
  );
});

test("a conta reconhece texto solto e ignora comentário e código", () => {
  assert.equal(contarSoltos(`// não conta\nconst a = "não conta não"; /* nem isso: você */`), 1);
  assert.equal(contarSoltos(`el.className = "btn sm primary"; t("nav.perfil");`), 0);
  assert.equal(contarSoltos("const s = `faltam ${n} dias pra meta`;"), 1);
});
