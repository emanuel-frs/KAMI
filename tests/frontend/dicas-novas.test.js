// MAN-05 — dicas vistas uma a uma: quais faltam (components/dicas-novas.js),
// o que o motor devolve ao terminar (components/tip-sequence.js) e a
// consistência dos ids escritos à mão nos *-tips.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { withDom } from "./helpers/dom.js";
import { dicasPendentes, jaViuATela } from "../../frontend/js/components/dicas-novas.js";
import { startTipSequence, cancelActiveTipSequence } from "../../frontend/js/components/tip-sequence.js";

const PASSOS = [{ id: "grade" }, { id: "pausar" }, { id: "lembrar" }];

test("tela nunca vista: todas as dicas", () => {
  assert.deepEqual(dicasPendentes("habitos", PASSOS, { vistas: [], telas_antigas: [] }, []), PASSOS);
  assert.equal(jaViuATela("habitos", { vistas: [], telas_antigas: [] }), false);
});

test("só as dicas que ainda não apareceram", () => {
  const estado = { vistas: ["habitos/grade", "nucleo/pausar"], telas_antigas: [] };
  assert.deepEqual(dicasPendentes("habitos", PASSOS, estado, []).map((p) => p.id), ["pausar", "lembrar"]);
  assert.equal(jaViuATela("habitos", estado), true);
});

test("tela vista no esquema antigo: as dicas até a 1.12 contam como vistas, as novas não", () => {
  const estado = { vistas: [], telas_antigas: ["metas"] };
  const ate112 = ["grade", "pausar"];
  assert.deepEqual(dicasPendentes("metas", PASSOS, estado, ate112).map((p) => p.id), ["lembrar"]);
  // outra tela não herda a marca antiga
  assert.equal(dicasPendentes("habitos", PASSOS, estado, ate112).length, 3);
  assert.equal(jaViuATela("metas", estado), true);
});

test("'<tela>/*' (modo demo): nenhuma dica daquela tela, nem as futuras", () => {
  const estado = { vistas: ["habitos/*"], telas_antigas: [] };
  assert.deepEqual(dicasPendentes("habitos", [...PASSOS, { id: "nova-da-1-20" }], estado, []), []);
  assert.equal(dicasPendentes("metas", PASSOS, estado, []).length, 3);
  assert.equal(jaViuATela("habitos", estado), true);
});

function stubsDeLayout(dom) {
  const prev = {
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
    gcs: globalThis.getComputedStyle,
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  return () => {
    globalThis.requestAnimationFrame = prev.raf;
    globalThis.cancelAnimationFrame = prev.caf;
    globalThis.getComputedStyle = prev.gcs;
  };
}

const HTML = `<body><div id="a"></div><div id="b"></div></body>`;
const STEPS = [
  { id: "a", selector: "#a", text: "primeira" },
  { id: "sumido", selector: "#nao-existe", text: "elemento ainda não existe" },
  { id: "b", selector: "#b", text: "segunda" },
];

test(
  "fim normal: devolve só o que apareceu (o passo sem elemento fica pra depois)",
  withDom(HTML, async (dom, t) => {
    t.after(stubsDeLayout(dom));
    let resultado = null;
    assert.equal(startTipSequence(STEPS, { onFinish: (r) => (resultado = r) }), true);
    const proximo = () => document.querySelector(".tip-next-btn").click();
    proximo();
    proximo();
    assert.deepEqual(resultado, { mostrados: ["a", "b"], pulados: [] });
  }),
);

test(
  "pular tudo: o que não apareceu vai em pulados; rótulo de novidade",
  withDom(HTML, async (dom, t) => {
    t.after(stubsDeLayout(dom));
    let resultado = null;
    startTipSequence(STEPS, { rotulo: "novidade", onFinish: (r) => (resultado = r) });
    assert.equal(document.querySelector(".tip-step-label").textContent, "novidade · 1 / 2");
    document.querySelector('[data-action="skip"]').click();
    assert.deepEqual(resultado, { mostrados: ["a"], pulados: ["b"] });
  }),
);

test(
  "sequência já na tela: a segunda não começa e avisa com false",
  withDom(HTML, async (dom, t) => {
    t.after(stubsDeLayout(dom));
    let chamou = false;
    startTipSequence(STEPS, {});
    assert.equal(startTipSequence(STEPS, { onFinish: () => (chamou = true) }), false);
    assert.equal(chamou, false);
    cancelActiveTipSequence();
  }),
);

// ─── ids escritos à mão nos *-tips.js ─────────────────────────────────────

const PAGES = new URL("../../frontend/js/pages/", import.meta.url);

test("cada tela: ids únicos e ATE_1_12 só com ids que existem", () => {
  const arquivos = readdirSync(PAGES).filter((f) => f.endsWith("-tips.js"));
  assert.equal(arquivos.length, 9);
  for (const arquivo of arquivos) {
    const src = readFileSync(new URL(arquivo, PAGES), "utf8");
    const ids = [...src.matchAll(/^\s*id: "([^"]+)",/gm)].map((m) => m[1]);
    const textos = src.match(/const WIDGET_TEXTS = \{([\s\S]*?)\n\};/);
    if (textos) {
      const revisoes = src.match(/buildWidgetSteps\([^)]*\{([^}]*)\}\)/)?.[1] ?? "";
      for (const [, tipo] of textos[1].matchAll(/^ {2}([a-z_]+): "/gm)) {
        const rev = revisoes.match(new RegExp(`${tipo}: (\\d+)`))?.[1];
        ids.push(rev ? `widget-${tipo}-${rev}` : `widget-${tipo}`);
      }
    }
    assert.ok(ids.length > 0, `${arquivo}: nenhuma dica com id`);
    assert.equal(new Set(ids).size, ids.length, `${arquivo}: id repetido`);

    const legado = src.match(/const ATE_1_12 = \[([\s\S]*?)\];/);
    assert.ok(legado, `${arquivo}: falta ATE_1_12`);
    for (const [, id] of legado[1].matchAll(/"([^"]+)"/g)) {
      assert.ok(ids.includes(id), `${arquivo}: ATE_1_12 cita "${id}", que não é dica da tela`);
    }
    assert.match(src, /mostrarDicasNovas\(/, `${arquivo}: não usa mostrarDicasNovas`);
  }
});
