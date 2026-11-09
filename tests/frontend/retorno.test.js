// EST-01 (P-190): links do "relatar um erro ou dar uma ideia"
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL, EMAIL_MAX, GITHUB_MAX, linkEmail, linkGithub, titulo,
} from "../../frontend/js/components/retorno.js";

const DIAG = ["Kami v2.0.0 — diagnóstico", "sistema: Linux", "", "--- últimas 3 linhas do kami-backend.log ---",
  "linha antiga", "linha do meio", "linha nova"].join("\n");
const base = { tipo: "bug", texto: "a tela travou", diag: DIAG, versao: "2.0.0", separador: "--- diagnóstico ---", assunto: "Kami 2.0.0 · um erro" };
const corpo = (url) => decodeURIComponent(new URL(url).searchParams.get("body") ?? "");

test("e-mail vai pro endereço do kami com assunto, texto e diagnóstico", () => {
  const { url, copiar } = linkEmail(base);
  assert.equal(copiar, null);
  assert.ok(url.startsWith(`mailto:${EMAIL}?subject=Kami%202.0.0`));
  assert.match(corpo(url), /^a tela travou\r\n\r\n--- diagnóstico ---\r\nKami v2\.0\.0/);
  assert.match(corpo(url), /linha nova/);
});

test("e-mail longo perde as linhas antigas do log; sem caber nem o texto, vai pela área de transferência", () => {
  const log = Array.from({ length: 300 }, (_, i) => `linha ${i} ${"x".repeat(20)}`);
  const diag = [...DIAG.split("\n").slice(0, 4), ...log].join("\n");
  const curto = linkEmail({ ...base, diag });
  assert.ok(curto.url.length <= EMAIL_MAX);
  assert.equal(curto.copiar, null);
  assert.match(corpo(curto.url), /sistema: Linux[\s\S]*…[\s\S]*linha 299/);
  assert.doesNotMatch(corpo(curto.url), /linha 0 /);

  const enorme = linkEmail({ ...base, texto: "ã".repeat(1000) });
  assert.equal(enorme.url, `mailto:${EMAIL}?subject=${encodeURIComponent(base.assunto)}`);
  assert.ok(enorme.copiar.startsWith("ã") && enorme.copiar.includes("linha nova"));
});

test("GitHub: erro preenche o bug.yml pelos campos; ideia vai no feedback.yml", () => {
  const erro = new URL(linkGithub(base).url);
  assert.equal(erro.searchParams.get("template"), "bug.yml");
  assert.equal(erro.searchParams.get("title"), "a tela travou");
  assert.equal(erro.searchParams.get("versao"), "2.0.0");
  assert.equal(erro.searchParams.get("o-que-aconteceu"), "a tela travou");
  assert.equal(erro.searchParams.get("log"), DIAG);

  const ideia = new URL(linkGithub({ ...base, tipo: "ideia", diag: "" }).url);
  assert.equal(ideia.searchParams.get("template"), "feedback.yml");
  assert.equal(ideia.searchParams.get("feedback"), "a tela travou");
  assert.equal(ideia.searchParams.get("log"), null);

  const grande = linkGithub({ ...base, texto: "y".repeat(GITHUB_MAX) });
  assert.ok(grande.url.length <= GITHUB_MAX && grande.copiar.includes("linha nova"));
});

test("título é a 1ª linha, cortada em 60", () => {
  assert.equal(titulo("  oi\nresto"), "oi");
  assert.equal(titulo("a".repeat(80)).length, 60);
});
