import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SET = {
  mes: "2026-09", dias_no_mes: 30, xp_total: 1240, acoes: 86, dias_ativos: 24, missoes: 41,
  melhor_sequencia: 12,
  xp_por_atributo: { aprendizado: 520, financas: 260, carreira: 0, metas: 300, organizacao: 160 },
  conquistas: ["maratona", "aquecendo"],
  acao_do_mes: { descricao: "concluiu marco: projeto final", xp: 20, dia: "2026-09-12" },
  anterior: { mes: "2026-08", xp_total: 1050, acoes: 90, dias_ativos: 21, missoes: 0 },
  vista: false,
};

test("texto da retrospectiva: números, comparação, barras, conquistas e ação do mês", async () => {
  const { retroText, monthLabel } = await import("../../frontend/js/modals/retrospectiva-modal.js");
  assert.equal(monthLabel("2026-09"), "setembro de 2026");
  const text = retroText(SET);
  assert.match(text, /RETROSPECTIVA · SETEMBRO DE 2026/);
  assert.match(text, /xp no mês \.+ 1\.240\s+↑ 18% vs agosto/);
  assert.match(text, /ações \.+ 86\s+↓ 4/);
  assert.match(text, /dias ativos \.+ 24\/30\s+↑ 3/);
  assert.match(text, /melhor sequência \.+ 12 dias/);
  assert.match(text, /missões \.+ 41\s+novo/);
  assert.match(text, /aprendizado\s+\[#{20}\]\s+520/);
  assert.match(text, /finanças\s+\[#{10}-{10}\]\s+260/);
  assert.match(text, /CONQUISTAS DO MÊS \(2\)\n  \* maratona\n  \* aquecendo/);
  assert.match(text, /concluiu marco: projeto final\n  \+20 xp · 12\/09/);
  // a tela é o mesmo texto, pintado (o .txt não leva cor)
  const { retroHtml } = await import("../../frontend/js/modals/retrospectiva-modal.js");
  const html = retroHtml(SET);
  assert.match(html, /<span class="rt-up">↑ 18%<\/span>/);
  assert.match(html, /<span class="rt-down">↓ 4<\/span>/);
  assert.match(html, /<span class="rt-bar-on">#{10}<\/span><span class="rt-bar-off">-{10}<\/span>/);
  assert.doesNotMatch(text, /<span/);
  // a moldura fecha certinho
  const [top, mid, bottom] = text.split("\n");
  assert.equal(top.length, mid.length);
  assert.equal(mid.length, bottom.length);
});

test(
  "abre sozinha quando a mais nova não foi vista, marca como vista e navega",
  withDom("<body></body>", async (dom, t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
      const path = new URL(url, "http://localhost").pathname;
      calls.push(`${opts.method ?? "GET"} ${path}`);
      if (path === "/api/nucleo/retrospectivas") {
        return { ok: true, status: 200, json: async () => [{ mes: "2026-09", vista: false }, { mes: "2026-08", vista: true }] };
      }
      if (path.endsWith("/vista")) return { ok: true, status: 204, json: async () => null };
      const mes = path.split("/").pop();
      return { ok: true, status: 200, json: async () => ({ ...SET, mes }) };
    });

    const { startRetrospective } = await import("../../frontend/js/modals/retrospectiva-modal.js");
    await startRetrospective();
    await wait(20);

    const modal = document.querySelector("#retrospectiva-modal");
    assert.ok(modal.classList.contains("open"));
    assert.match(modal.querySelector("#retro-title").textContent, /setembro de 2026/);
    assert.ok(calls.includes("POST /api/nucleo/retrospectivas/2026-09/vista"));
    assert.equal(modal.querySelector('[data-action="next"]').disabled, true);

    modal.querySelector('[data-action="prev"]').click();
    await wait(20);
    assert.match(modal.querySelector("#retro-title").textContent, /agosto de 2026/);
    assert.ok(!calls.includes("POST /api/nucleo/retrospectivas/2026-08/vista")); // já era vista
    assert.ok(modal.querySelector(".retro-pre .rt-title"), "a tela é pintada (retroHtml)");

    // exportar dá retorno visual: botão vira "exportado" e aparece um aviso
    dom.window.URL.createObjectURL = () => "blob:x";
    dom.window.URL.revokeObjectURL = () => {};
    globalThis.URL.createObjectURL = () => "blob:x";
    globalThis.URL.revokeObjectURL = () => {};
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    modal.querySelector('[data-action="export"]').click();
    assert.match(modal.querySelector('[data-action="export"]').textContent, /exportado/);
    const toast = [...document.querySelectorAll(".toast-item")].map((e) => e.textContent).join(" ");
    assert.match(toast, /kami-retrospectiva-2026-08\.txt/);
  })
);
