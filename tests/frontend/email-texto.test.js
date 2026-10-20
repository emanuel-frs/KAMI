// ORG-06 — texto do e-mail (components/email-texto.js) e o leitor
// (modals/email-leitor-modal.js).
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";
import { grupoDoDia, horaCurta, dataLonga, textoParaCopiar } from "../../frontend/js/components/email-texto.js";

const L = (rotulo, url) => `${rotulo}${url}`;

test(
  "desenha parágrafos, lista, citação, assinatura e links sem interpretar HTML",
  withDom("<body></body>", async (dom) => {
    const { renderEmailTexto } = await import("../../frontend/js/components/email-texto.js");
    const doc = dom.window.document;
    const texto = [
      `Olá <img src=x onerror=alert(1)>, veja a ${L("Statica", "https://collect.x.com/jwt/eyJ0")}.`,
      "",
      "• um\n• dois",
      "",
      "> citado\n> mais",
      "",
      `perigo ${L("clique", "javascript:alert(1)")} e ${L("", "https://loja.com/a")}`,
      "-- ",
      "Fulano",
    ].join("\n");
    const box = doc.createElement("div");
    box.append(renderEmailTexto(texto, doc));

    assert.equal(box.querySelector("img"), null, "HTML do e-mail vira texto, não elemento");
    assert.match(box.querySelector("p").textContent, /<img src=x onerror=alert\(1\)>/);
    assert.deepEqual([...box.querySelectorAll("li")].map((li) => li.textContent), ["um", "dois"]);
    assert.equal(box.querySelector("blockquote").textContent, "citadomais");
    assert.equal(box.querySelector(".em-assinatura").textContent, "Fulano");

    const links = [...box.querySelectorAll("a.em-link")];
    assert.deepEqual(links.map((a) => a.textContent), ["Statica ↗", "↗"]);
    assert.equal(links[0].dataset.url, "https://collect.x.com/jwt/eyJ0");
    assert.equal(links[0].getAttribute("href"), "#", "URL fica fora do href e da tela");
    assert.match(links[0].dataset.tooltip, /collect\.x\.com/);
    assert.doesNotMatch(box.textContent, /eyJ0|javascript:/, "nem token nem javascript: aparecem");
    assert.match(box.textContent, /perigo clique e/);
  })
);

test("textoParaCopiar devolve rótulo (url)", () => {
  assert.equal(textoParaCopiar(`veja ${L("aqui", "https://a.com")} e ${L("", "https://b.com")}`), "veja aqui (https://a.com) e https://b.com");
});

test("grupoDoDia: hoje, ontem, esta semana, este mês e por mês", () => {
  // quarta-feira, 21/10/2026 às 15h
  const agora = new Date(2026, 9, 21, 15, 0);
  const g = (y, m, d) => grupoDoDia(new Date(y, m, d, 10, 0).toISOString(), agora).rotulo;
  assert.equal(g(2026, 9, 21), "hoje");
  assert.equal(g(2026, 9, 20), "ontem");
  assert.equal(g(2026, 9, 19), "esta semana"); // segunda
  assert.equal(g(2026, 9, 18), "este mês"); // domingo da semana anterior
  assert.equal(g(2026, 8, 30), "setembro");
  assert.equal(g(2025, 11, 1), "dezembro de 2025");
  assert.equal(grupoDoDia("lixo", agora).rotulo, "sem data");
});

test("horaCurta combina com o grupo", () => {
  const agora = new Date(2026, 9, 21, 15, 0);
  assert.equal(horaCurta(new Date(2026, 9, 21, 9, 5).toISOString(), agora), "09:05");
  assert.equal(horaCurta(new Date(2026, 9, 19, 18, 30).toISOString(), agora), "seg 18:30");
  assert.equal(horaCurta(new Date(2026, 8, 3, 8, 0).toISOString(), agora), "03/09");
  assert.match(dataLonga(new Date(2026, 9, 20, 14, 32).toISOString()), /^ter, 20 de outubro de 2026 · 14:32$/);
});

function emailsFake() {
  return [
    { id: "a", account_id: "c1", subject: "Primeiro", sender: '"Ana" <ana@x.com>', sender_name: "Ana", sender_email: "ana@x.com", received_at: "2026-10-20T10:00:00", is_read: false },
    { id: "b", account_id: "c1", subject: "Segundo", sender: "bob@x.com", sender_name: "bob", sender_email: "bob@x.com", received_at: "2026-10-19T10:00:00", is_read: true },
  ];
}

function mockFetch(t, detalhes) {
  // client.js avisa "kami:data-changed" depois de um PUT — o evento tem
  // que ser da janela do jsdom, não o CustomEvent do Node
  const anterior = globalThis.CustomEvent;
  globalThis.CustomEvent = globalThis.window.CustomEvent;
  t.after(() => (globalThis.CustomEvent = anterior));
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    const id = String(url).match(/email-cache\/([^/]+)/)?.[1];
    return { ok: true, status: 200, json: async () => detalhes[id] || {} };
  });
  return calls;
}

test(
  "leitor: abre com o texto completo, marca como lido, navega e esconde o webmail sem link",
  withDom("<body></body>", async (dom, t) => {
    const calls = mockFetch(t, {
      a: { body_text: `Oi ${L("site", "https://s.com")}`, body_cortado: false, webmail_url: "https://mail.google.com/mail/u/eu/" },
      b: { body_text: "", body_cortado: true, webmail_url: null },
    });
    const emails = emailsFake();
    const lidos = [];
    const { openEmailLeitor, closeEmailLeitor } = await import("../../frontend/js/modals/email-leitor-modal.js");
    const doc = dom.window.document;
    // espera a condição (fetch + then encadeados) sem tempo fixo
    const ate = async (cond) => {
      for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
      assert.ok(cond(), "condição não aconteceu");
    };

    openEmailLeitor({
      ids: ["a", "b"],
      index: 0,
      resumo: (id) => emails.find((e) => e.id === id),
      conta: () => ({ label: "gmail", color: "#f00" }),
      onLido: (id, lido) => lidos.push([id, lido]),
    });
    await ate(() => lidos.length === 1);

    const modal = doc.querySelector("#email-leitor-modal");
    assert.ok(modal.classList.contains("open"));
    assert.equal(doc.querySelector("#eml-assunto").textContent, "Primeiro");
    assert.equal(doc.querySelector("#eml-nome").textContent, "Ana");
    assert.equal(doc.querySelector("#eml-endereco").textContent, "ana@x.com");
    assert.equal(doc.querySelector("#eml-pos").textContent, "1/2");
    assert.match(doc.querySelector("#eml-corpo").textContent, /Oi site ↗/);
    assert.equal(doc.querySelector("#eml-webmail").hidden, false);
    assert.equal(doc.querySelector('[data-eml="anterior"]').disabled, true);
    assert.ok(calls.some((c) => c.method === "PUT" && c.url.endsWith("/email-cache/a/read")), "marca como lido ao abrir");
    assert.deepEqual(lidos, [["a", true]]);

    // → vai pro próximo (já lido: não marca de novo)
    doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await ate(() => doc.querySelector(".eml-aviso"));
    assert.equal(doc.querySelector("#eml-assunto").textContent, "Segundo");
    assert.equal(doc.querySelector("#eml-endereco").textContent, "bob@x.com");
    assert.equal(doc.querySelector("#eml-webmail").hidden, true);
    assert.match(doc.querySelector("#eml-corpo").textContent, /não tem texto/);
    assert.match(doc.querySelector(".eml-aviso").textContent, /não está guardado/);
    assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
    closeEmailLeitor();
    assert.ok(!modal.classList.contains("open"));
  })
);
