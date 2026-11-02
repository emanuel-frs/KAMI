// IA-07a — quadro com os números da consulta (resumo financeiro, metas,
// visão do mês): o Kami mostra o que leu e o modelo só comenta.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const FIN = {
  month: "2026-11", income: 0, expenses: 10, net_this_month: null, accounts_total_available: 0,
  conclusions: { no_income_recorded_yet: true, income_still_expected: 1800, biggest_category: { category: "gasto", amount: 10, share_of_expenses_pct: 100 } },
  expected_income: [{ label: "parte 1", amount: 1800, expected_date: "2026-11-09", status: "previsto" }],
};
const METAS = {
  goals: [
    { title: "viagem", unit: "money", progress_pct: 30, status: "ativa", situation: "behind", remaining: 700, needed_per_week: 233.33, deadline: "2026-11-23" },
    { title: "ler", unit: "páginas", progress_pct: 100, status: "concluida", situation: "done", remaining: 0 },
  ],
};

const linhas = (el) =>
  [...el.querySelectorAll(".ia-quadro-linha")].map((l) => `${l.querySelector("dt").textContent} ${l.querySelector("dd").textContent}`.replace(/\s+/g, " "));

test(
  "quadro: finanças sem entrada no mês e metas com a situação",
  withDom("<!doctype html><body></body>", async () => {
    const { noQuadro } = await import("../../frontend/js/components/assistente-quadro.js");
    const fin = noQuadro({ nome: "finance_summary", dados: FIN });
    assert.equal(fin.querySelector(".ia-quadro-titulo").textContent, "11/2026");
    assert.deepEqual(linhas(fin), [
      "entrou R$ 0,00 (nada registrado ainda)",
      "saiu R$ 10,00 · mais em gasto (100%)",
      "previsto R$ 1.800,00 em 09/11",
      "nas contas R$ 0,00",
    ]);
    assert.ok(!fin.textContent.includes("resultado do mês"), "sem entrada não tem resultado do mês");

    const metas = noQuadro({ nome: "goals", dados: METAS });
    const meta = metas.querySelectorAll(".ia-quadro-meta");
    assert.equal(meta.length, 1, "só as ativas");
    assert.equal(meta[0].querySelector(".ia-quadro-meta-nome").textContent, "viagem");
    assert.equal(meta[0].querySelector(".ia-quadro-tag--atrasada").textContent, "atrasada");
    assert.equal(meta[0].querySelector(".bar-fill").style.width, "30%");
    assert.equal(meta[0].querySelector(":scope > .ia-quadro-extra").textContent.replace(/\s+/g, " "), "falta R$ 700,00 · R$ 233,33/semana · até 23/11");
    // cores do sistema: entrou sem nada fica neutro, saiu em vermelho, previsto em âmbar
    assert.equal(fin.querySelector(".ia-quadro-v--sai").textContent.replace(/\s+/g, " "), "R$ 10,00");
    assert.equal(fin.querySelector(".ia-quadro-v--previsto").textContent.replace(/\s+/g, " "), "R$ 1.800,00");
    assert.equal(fin.querySelector(".ia-quadro-v--entra"), null);
    assert.equal(noQuadro({ nome: "goals", dados: { goals: [] } }).querySelector(".ia-quadro-vazio").textContent, "nenhuma meta ativa");
    assert.equal(noQuadro({ nome: "inbox", dados: {} }), null);
  }),
);

const MES = {
  month: "2026-11",
  finances: { income: 0, expenses: 10, net_this_month: null, accounts_total_available: 0, conclusions: { income_still_expected: 1800 } },
  goals: [{ title: "teste", progress_pct: 0, status: "ativa", situation: "on track", deadline: "2026-11-25" }],
  habits: [{ name: "correr", streak: 4, success_30d_pct: 63, done_today: true }, { name: "ler", streak: 0, success_30d_pct: 10, done_today: false }],
  learning: { milestones_completed_this_month: 2, tracks: [{ track: "Java e Spring Boot", status: "em_andamento", progress_pct: 40 }] },
  progress: { xp_gained: 120, active_days: 9, missions_completed: 3, achievements_unlocked: ["primeiro passo"],
    previous_month: { xp_gained: 200, active_days: 5 } },
};

const filas = (el) =>
  [...el.querySelectorAll(".ia-q-fila")].map((l) => [...l.children].map((c) => c.textContent).join(" = ").replace(/\s+/g, " "));

test(
  "quadro: o mês num cartão por área; área sem nada vira uma linha só",
  withDom("<!doctype html><body></body>", async () => {
    const { noQuadro } = await import("../../frontend/js/components/assistente-quadro.js");
    const el = noQuadro({ nome: "month_overview", dados: MES });
    assert.deepEqual([...el.querySelectorAll(".ia-q-area")].map((x) => x.textContent),
      ["finanças", "metas", "hábitos", "aprendizado", "progresso"]);
    const f = filas(el);
    for (const esperada of ["entrou = R$ 0,00", "saiu = R$ 10,00", "previsto = R$ 1.800,00", "nas contas = R$ 0,00",
      "teste no ritmo = 0%", "✓ correr = 4d · 63%", "ler = 0d · 10%", "marcos no mês = 2", "Java e Spring Boot = 40%",
      "xp no mês = +120 ↓", "dias ativos = 9 ↑", "missões = 3", "conquistas = 1"]) {
      assert.ok(f.includes(esperada), `${esperada} | ${f.join(" | ")}`);
    }
    assert.equal(el.querySelector(".ia-q-cartao--progresso .ia-quadro-v--sai").textContent, "+120 ↓", "xp caiu: vermelho");
    assert.equal(el.querySelector(".ia-q-vazias"), null);
    // sem hábitos nem trilhas: sem cartão, uma linha no fim
    const pouco = noQuadro({ nome: "month_overview", dados: { ...MES, habits: [], learning: { milestones_completed_this_month: 0, tracks: [] } } });
    assert.deepEqual([...pouco.querySelectorAll(".ia-q-area")].map((x) => x.textContent), ["finanças", "metas", "progresso"]);
    assert.equal(pouco.querySelector(".ia-q-vazias").textContent, "sem registros no mês: hábitos, aprendizado");
    // área desligada pela pessoa não vem nos dados — nem cartão nem linha
    const sem = noQuadro({ nome: "month_overview", dados: { month: "2026-11", goals: MES.goals } });
    assert.deepEqual([...sem.querySelectorAll(".ia-q-area")].map((x) => x.textContent), ["metas"]);
    assert.equal(sem.querySelector(".ia-q-vazias"), null);
  }),
);

test(
  "quadro: conversa reaberta põe o quadro na resposta que vem depois",
  withDom("<!doctype html><body></body>", async () => {
    const { deConversa } = await import("../../frontend/js/components/assistente-painel.js");
    const saida = deConversa([
      { papel: "usuario", texto: "estou gastando muito?" },
      { papel: "ferramenta", quadro: { nome: "finance_summary", dados: FIN } },
      { papel: "assistente", texto: "Ainda não entrou nada." },
      { papel: "usuario", texto: "e agora?" },
      { papel: "assistente", texto: "ok" },
    ]);
    assert.equal(saida.length, 4);
    assert.deepEqual(saida[1].quadros, [{ nome: "finance_summary", dados: FIN }]);
    assert.deepEqual(saida[1].ferramentas, ["finance_summary"]);
    assert.equal(saida[3].quadros, undefined);
  }),
);

test(
  "quadro: 10 metas rolam dentro do cartão (sem cortar) e dá pra rolar pelo teclado",
  withDom("<!doctype html><body></body>", async () => {
    const { noQuadro } = await import("../../frontend/js/components/assistente-quadro.js");
    const dez = Array.from({ length: 10 }, (_, i) => ({ title: `meta ${i + 1}`, progress_pct: i * 10, status: "ativa", situation: "on track" }));
    const sozinho = noQuadro({ nome: "goals", dados: { goals: dez } });
    const lista = sozinho.querySelector(".ia-q-lista--alta");
    assert.equal(lista.querySelectorAll(".ia-quadro-meta").length, 10);
    assert.equal(lista.getAttribute("tabindex"), "0");
    const mes = noQuadro({ nome: "month_overview", dados: { month: "2026-11", goals: dez } });
    const noCartao = mes.querySelector(".ia-q-cartao--metas .ia-q-lista");
    assert.equal(noCartao.querySelectorAll(".ia-q-barra-fila").length, 10);
    assert.equal(noCartao.getAttribute("tabindex"), "0");
    const poucas = noQuadro({ nome: "month_overview", dados: { month: "2026-11", goals: dez.slice(0, 2) } });
    assert.equal(poucas.querySelector(".ia-q-lista").hasAttribute("tabindex"), false, "sem rolagem, sem parada no tab");
  }),
);

test(
  "resposta: :nome: vira o ícone do Kami (só os liberados, fora de código)",
  withDom("<!doctype html><body><div id='r'></div></body>", async (dom) => {
    const { trocarIcones } = await import("../../frontend/js/components/assistente-painel.js");
    const r = dom.window.document.querySelector("#r");
    r.innerHTML = "<p>meta :target: no ritmo e :rocket: não existe</p><pre><code>:target:</code></pre>";
    trocarIcones(r);
    const p = r.querySelector("p");
    assert.equal(p.querySelectorAll(".ia-texto-icone svg.icon-target").length, 1);
    assert.equal(p.textContent.replace(/\s+/g, " "), "meta no ritmo e :rocket: não existe");
    assert.equal(r.querySelector("code").textContent, ":target:", "dentro de código fica como está");
  }),
);
