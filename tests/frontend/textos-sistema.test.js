// I18N — textos que o backend cria em português e o app traduz pela chave
// (frontend/js/components/textos-sistema.js). Usa os dicionários de verdade:
// o português deles é conferido contra o backend em
// backend/tests/test_textos_sistema.py.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { usarDicionarios, tOu } from "../../frontend/js/i18n.js";
import {
  descricaoConquista,
  descricaoTema,
  rotuloTema,
  rotuloTitulo,
  textoDoRegistro,
  tituloConquista,
  tituloMissao,
} from "../../frontend/js/components/textos-sistema.js";

const dic = (c) => JSON.parse(readFileSync(new URL(`../../frontend/i18n/${c}.json`, import.meta.url), "utf8"));
const PT = dic("pt");

test("tOu(): chave conhecida traduz; sem chave ou desconhecida fica a reserva", () => {
  usarDicionarios("en", { "x.y": "hello {nome}" }, { "x.y": "olá {nome}" });
  assert.equal(tOu("x.y", "reserva", { nome: "kami" }), "hello kami");
  assert.equal(tOu(null, "reserva"), "reserva");
  assert.equal(tOu("nao.existe", "reserva"), "reserva");
});

test("conquista do catálogo traduz; personalizada e secreta bloqueada não vazam", () => {
  usarDicionarios("en", dic("en"), PT);
  const doCatalogo = { key: "streak_3", title: "aquecendo", description: "3 dias seguidos com pelo menos 1 ação", unlocked: true };
  assert.equal(tituloConquista(doCatalogo), "warming up");
  assert.equal(descricaoConquista(doCatalogo), "3 days in a row with at least 1 action");

  const sua = { key: null, rule_type: "custom", title: "ler 10 livros", description: "minha meta" };
  assert.equal(tituloConquista(sua), "ler 10 livros");
  assert.equal(descricaoConquista(sua), "minha meta");

  const secreta = { key: "coruja", secret: true, unlocked: false, title: "???", description: "conquista secreta" };
  assert.equal(tituloConquista(secreta), "???");
  assert.equal(descricaoConquista(secreta), "secret achievement");
  assert.equal(tituloConquista({ ...secreta, unlocked: true }), "night owl");

  // banco mais novo que o app: chave que o dicionário ainda não tem
  assert.equal(tituloConquista({ key: "do_futuro", title: "do futuro" }), "do futuro");
});

test("missão: diária com o nome da pessoa intacto, semanal pela chave", () => {
  usarDicionarios("de", dic("de"), PT);
  assert.equal(
    tituloMissao({ periodo: "dia", tipo: "meta", nome: "viagem", titulo: 'contribua com a meta "viagem"' }),
    "trag zum Ziel „viagem“ bei"
  );
  assert.equal(tituloMissao({ periodo: "dia", tipo: "link", nome: null, titulo: "salve um link" }), "speicher einen Link");
  assert.equal(
    tituloMissao({ periodo: "semana", tipo: "marcos", titulo: "conclua 2 marcos na semana" }),
    "schließ in der Woche 2 Meilensteine ab"
  );
  // resposta antiga (sem período) fica como veio
  assert.equal(tituloMissao({ tipo: "meta", titulo: "x" }), "x");
});

test("títulos e temas das recompensas", () => {
  usarDicionarios("ja", dic("ja"), PT);
  assert.equal(rotuloTitulo("mestre", "mestre do terminal"), "ターミナルの達人");
  assert.equal(rotuloTema("ambar", "âmbar clássico"), "クラシックアンバー");
  assert.ok(descricaoTema("crt", "x").includes("ブラウン管"));
  assert.equal(rotuloTitulo(undefined, "iniciante"), "iniciante");
});

test("registro de atividade e lançamentos: chave + nome intacto; sem chave fica como veio", () => {
  usarDicionarios("en", dic("en"), PT);
  const linha = (description, chave, vars) => ({ description, description_key: chave, description_vars: vars });
  assert.equal(textoDoRegistro(linha("pagou conta fixa: aluguel", "log.conta_fixa.paga", { nome: "aluguel" })), "paid fixed bill: aluguel");
  assert.equal(textoDoRegistro(linha("li um capítulo", null, {})), "li um capítulo");
  assert.equal(textoDoRegistro(linha("conta fixa: luz", "lancamento.conta_fixa", { nome: "luz" })), "fixed bill: luz");
  // plural
  assert.equal(
    textoDoRegistro(linha("x", "log.github.importou", { n: 1, conta: "eu" })),
    "imported 1 repository automatically from github (eu)"
  );
  // números e datas no jeito do idioma
  assert.equal(textoDoRegistro(linha("x", "log.salario.reajuste", { pct: "+12.5" })), "new salary raise (+12.5%)");
  assert.equal(textoDoRegistro(linha("x", "log.bonus.sequencia", { dias: 14, mult: "1,3" })), "bonus · 14-day streak 1.3×");
  // missão concluída leva o título da missão traduzido junto
  assert.equal(
    textoDoRegistro(linha("x", "log.missao.concluida", { missao: 'salve um link', periodo: "dia", tipo: "link", nome: null })),
    "mission complete: save a link"
  );

  usarDicionarios("de", dic("de"), PT);
  assert.equal(textoDoRegistro(linha("x", "log.salario.reajuste", { pct: "+12.5" })), "neue Gehaltserhöhung (+12,5 %)");
});
