// IA-06: avisos proativos — o texto padrão de cada regra (P-134), a pergunta
// pronta pro assistente, a notificação do sistema só pra "conta sem saldo"
// e uma vez só (P-146), e a seção das configurações (P-140, P-147).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const AVISOS = [
  { id: "a1", regra: "categoria_acima", alvo_id: "mercado", nome: "mercado", vars: { categoria: "mercado", valor_mes: 360, valor_anterior: 300, pct: 20 }, notificado: false },
  { id: "a2", regra: "conta_sem_saldo", alvo_id: "f1", nome: "luz", vars: { conta: "luz", valor: 80, valor_saldo: 50, data: "2026-10-23", dias: 1, conta_carteira: "nu" }, notificado: false },
  { id: "a3", regra: "meta_parada", alvo_id: "g1", nome: "viagem", vars: { meta: "viagem", dias: 21, aporte: false }, notificado: false },
  { id: "a4", regra: "atributo_esquecido", alvo_id: "t1", nome: "financas", vars: { atributo: "financas", dias: 14 }, notificado: false },
  { id: "a5", regra: "trilha_parada", alvo_id: "r1", nome: "rust", vars: { trilha: "rust", dias: 19, concluiu: true }, notificado: false },
];

const json = (v, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

test(
  "avisos: textos, pergunta e notificação do sistema",
  withDom(`<!doctype html><body></body>`, async (dom, t) => {
    const pedidos = [];
    t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
      const caminho = new URL(url).pathname;
      pedidos.push(`${opts.method || "GET"} ${caminho}`);
      return caminho === "/api/avisos" ? json(structuredClone(AVISOS)) : json(null, 204);
    });
    globalThis.CustomEvent = dom.window.CustomEvent;
    const notificacoes = [];
    dom.window.__TAURI__ = {
      notification: { isPermissionGranted: async () => true, sendNotification: (n) => notificacoes.push(n) },
    };
    t.after(() => delete globalThis.CustomEvent);
    const { store } = await import("../../frontend/js/state/store.js");
    store.set("profile", { avisos_hora: "00:00" });
    const av = await import("../../frontend/js/components/avisos.js");

    const textos = AVISOS.map(av.textoAviso);
    assert.deepEqual(textos.map((x) => x.titulo), [
      "gastos com mercado acima do mês passado",
      "luz vence amanhã e o saldo não cobre",
      "meta parada: viagem",
      "finanças sem xp há 14 dias",
      "trilha parada: rust",
    ]);
    assert.match(textos[0].detalhe, /R\$\s?360(,00)? até agora, 20% a mais que os R\$\s?300(,00)?/);
    assert.match(textos[1].detalhe, /R\$\s?80(,00)? pra pagar, R\$\s?50(,00)? livre em nu/);
    assert.equal(textos[2].detalhe, "21 dias desde que foi criada, sem nenhum aporte");
    assert.equal(textos[4].detalhe, "19 dias sem concluir um marco");
    assert.match(av.perguntaAviso(AVISOS[1]), /^a conta luz \(R\$\s?80(,00)?\) vence em .+ e meu saldo livre é R\$\s?50(,00)?/);
    assert.equal(av.perguntaAviso(AVISOS[3]), "estou sem xp em finanças há 14 dias. o que posso fazer hoje pra retomar?");

    let mudou = 0;
    dom.window.addEventListener("kami:avisos-mudaram", () => mudou++);
    const lista = await av.checarAvisos();
    assert.equal(lista.length, 5);
    assert.equal(av.avisosAtuais().length, 5);
    assert.ok(mudou >= 1);
    await new Promise((r) => setTimeout(r, 0));
    // só "conta sem saldo" sai do app, e o backend fica sabendo
    assert.deepEqual(notificacoes.map((n) => n.title), ["kami — luz vence amanhã e o saldo não cobre"]);
    assert.ok(pedidos.includes("POST /api/avisos/a2/notificado"));

    av.tirarAviso("a1");
    assert.equal(av.avisosAtuais().length, 4);

    // P-146: com "vencimentos" desligado fora do app, nada sai
    store.set("profile", { avisos_hora: "00:00", notif_fora_vencimentos: false });
    notificacoes.length = 0;
    await av.checarAvisos();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(notificacoes, []);
  }),
);

test(
  "avisos: configurações › notificações (tudo, por regra, silenciados)",
  withDom(`<!doctype html><body><div id="raiz"></div></body>`, async (dom, t) => {
    let cfg = {
      ligados: true,
      regras: { categoria_acima: true, conta_sem_saldo: false, meta_parada: true, atributo_esquecido: true, trilha_parada: true },
      silenciados: [{ regra: "meta_parada", alvo_id: "g1", nome: "viagem", criado_em: "x" }],
    };
    const pedidos = [];
    t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
      const caminho = decodeURIComponent(new URL(url).pathname);
      const metodo = opts.method || "GET";
      pedidos.push(`${metodo} ${caminho}${opts.body ? ` ${opts.body}` : ""}`);
      if (caminho === "/api/avisos") return json([]);
      if (metodo === "PUT" && caminho === "/api/avisos/regras/*") cfg = { ...cfg, ligados: JSON.parse(opts.body).ligada };
      if (metodo === "DELETE") cfg = { ...cfg, silenciados: [] };
      return json(cfg);
    });
    globalThis.CustomEvent = dom.window.CustomEvent;
    t.after(() => delete globalThis.CustomEvent);
    const doc = dom.window.document;
    const $ = (s) => doc.querySelector(s);
    const espera = () => new Promise((r) => setTimeout(r, 0));
    const { buildNotificacoesPanel, renderNotificacoesTab, wireNotificacoesTab } = await import(
      "../../frontend/js/modals/configuracoes/notificacoes.js"
    );
    $("#raiz").innerHTML = buildNotificacoesPanel();
    const wrap = $("#raiz");
    wireNotificacoesTab(wrap);
    renderNotificacoesTab(wrap, {});
    await espera();

    assert.equal($("#cfg-avisos-todos").checked, true);
    assert.equal($('[data-regra-aviso="conta_sem_saldo"]').checked, false);
    assert.match($("#cfg-avisos-silenciados").textContent, /viagem\s+meta parada/);

    const regra = $('[data-regra-aviso="conta_sem_saldo"]');
    regra.checked = true;
    regra.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await espera();
    assert.ok(pedidos.includes('PUT /api/avisos/regras/conta_sem_saldo {"ligada":true}'));

    $("#cfg-avisos-todos").checked = false;
    $("#cfg-avisos-todos").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await espera();
    assert.ok(pedidos.includes('PUT /api/avisos/regras/* {"ligada":false}'));
    assert.ok([...doc.querySelectorAll("[data-regra-aviso]")].every((el) => el.disabled), "regras travadas com tudo desligado");

    $("[data-voltar-aviso]").click();
    await espera();
    assert.ok(pedidos.includes("DELETE /api/avisos/silenciados/meta_parada/g1"));
    assert.equal($("#cfg-avisos-silenciados").textContent.trim(), "nenhum aviso silenciado.");
  }),
);
