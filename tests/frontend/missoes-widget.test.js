import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";
import { definirFormatoData } from "../../frontend/js/components/format.js";

// ORG-07: as datas seguem o idioma do sistema — o CI roda em inglês (EUA) e
// daria "09/03". Estes testes conferem a tela em português, então fixam dd/mm.
definirFormatoData("dma");

const DATA = {
  hoje: "2026-10-09",
  semana_inicio: "2026-10-05",
  semana_fim: "2026-10-11",
  diarias: [
    { id: "a", tipo: "lancamento", titulo: "lance um gasto ou uma entrada", atributo: "financas",
      xp_bonus: 10, progresso: 1, quantidade: 1, concluida: true },
    { id: "b", tipo: "link", titulo: 'salve um link <b>', atributo: "organizacao",
      xp_bonus: 10, progresso: 0, quantidade: 1, concluida: false },
  ],
  semanal: { id: "c", tipo: "dias_ativos", titulo: "aja em 5 dias diferentes da semana", atributo: "metas",
             xp_bonus: 40, progresso: 3, quantidade: 5, concluida: false },
};

test(
  "widget de missões lista o dia e a semana, e a pendente leva à tela dela",
  withDom('<div class="card"><div id="w"></div></div>', async (dom, t) => {
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => DATA }));
    const visited = [];
    const { registerNavigator } = await import("../../frontend/js/components/navigate.js");
    registerNavigator((page) => visited.push(page));

    const { render } = await import("../../frontend/js/widgets/missoes.js");
    const el = document.querySelector("#w");
    await render(el, {});

    const items = [...el.querySelectorAll(".ms-item")];
    assert.equal(items.length, 3);
    assert.match(el.querySelector(".ms-head").textContent, /hoje · 1\/2/);
    assert.equal(items[0].tagName, "DIV"); // concluída não é botão
    assert.match(items[0].textContent, /\[x\]/);
    assert.equal(items[1].tagName, "BUTTON");
    assert.match(items[1].innerHTML, /&lt;b&gt;/); // título escapado
    assert.match(items[2].textContent, /\[###--\]\s*3\/5/);
    assert.match(items[2].textContent, /metas · \+40 xp/);
    assert.match(el.textContent, /até 11\/10\/2026/);

    items[1].click();
    assert.deepEqual(visited, ["organizacao"]);
  })
);

test("renova em: horas até a meia-noite local, minutos na última hora", async () => {
  const { renewsIn } = await import("../../frontend/js/widgets/missoes.js");
  assert.equal(renewsIn(new Date(2026, 9, 9, 18, 0)), "renova em 6h");
  assert.equal(renewsIn(new Date(2026, 9, 9, 23, 20)), "renova em 40min");
});

test(
  "widget de missões mostra o atributo com acento e agrupa barra + recompensa (quebra junto em card estreito)",
  withDom('<div class="card"><div id="w"></div></div>', async (dom, t) => {
    t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => DATA }));
    const { render } = await import("../../frontend/js/widgets/missoes.js");
    const el = document.querySelector("#w");
    await render(el, {});
    const items = [...el.querySelectorAll(".ms-item")];
    assert.match(items[1].querySelector(".ms-reward").textContent, /organização · \+10 xp/);
    assert.match(items[0].querySelector(".ms-reward").textContent, /finanças/);
    const meta = items[2].querySelector(".ms-meta");
    assert.ok(meta.querySelector(".ms-bar") && meta.querySelector(".ms-reward"));
  })
);
