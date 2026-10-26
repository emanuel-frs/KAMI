// I18N-03 — glossário e tom das traduções (docs/TRADUCAO.md).
//
// O mesmo conceito com a mesma palavra em todo o app: cada variante abaixo
// já apareceu num dicionário e foi trocada pelo termo do glossário. E o
// tom decidido (P-97): informal — nada de "vous" no francês nem de 합쇼체
// (-습니다) no coreano.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dic = (idioma) => JSON.parse(readFileSync(new URL(`../../frontend/i18n/${idioma}.json`, import.meta.url), "utf8"));
const textos = (d) => Object.entries(d).flatMap(([k, v]) => (typeof v === "object" ? Object.values(v) : [v]).map((t) => [k, t]));

// idioma -> [variante proibida (regex), termo do glossário, chaves onde a variante é o sentido certo]
const VARIANTES = {
  fr: [[/capture rapide/i, "saisie rapide"], [/charges? fixes?/i, "facture fixe"]],
  it: [[/acquisizione rapida/i, "cattura rapida"]],
  es: [[/gastos? fijos?/i, "cuenta fija"]],
  zh: [[/固定支出/, "固定账单"]],
  ja: [[/クイックキャプチャ/, "クイック入力"], [/受信トレイ/, "受信箱", ["notificacoes.na_caixa_de_entrada"]]],
  ko: [[/빠른 기록/, "빠른 입력"], [/받은 편지함/, "받은편지함"], [/부채/, "빚"]],
  hi: [
    [/कर्ज़/, "क़र्ज़"],
    [/तय खर्च/, "तय बिल"],
    [/त्वरित नोट/, "झटपट दर्ज"],
    [/स्तर/, "लेवल", ["formacao.nivel", "erro.carreira.nivel_invalido_valores_aceitos_valores"]],
  ],
};

for (const [idioma, regras] of Object.entries(VARIANTES)) {
  test(`${idioma}: termos do glossário`, () => {
    const achados = [];
    for (const [k, t] of textos(dic(idioma))) {
      for (const [re, certo, excecoes = []] of regras) {
        if (re.test(t) && !excecoes.includes(k)) achados.push(`${k}: "${t.match(re)[0]}" → ${certo}`);
      }
    }
    assert.deepEqual(achados, []);
  });
}

test("fr: tutoiement (sem vous/votre/vos)", () => {
  const achados = textos(dic("fr"))
    .filter(([, t]) => /\b(vous|votre|vos)\b/i.test(t.replace(/rendez-vous/gi, "")))
    .map(([k]) => k);
  assert.deepEqual(achados, []);
});

test("ko: 해요체 (sem -습니다/-ㅂ니다)", () => {
  const achados = textos(dic("ko"))
    .filter(([, t]) => /(습니다|니다[.!?]?(\s|$)|십시오)/.test(t))
    .map(([k]) => k);
  assert.deepEqual(achados, []);
});
