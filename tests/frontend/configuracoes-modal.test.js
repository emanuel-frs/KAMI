// MAN-03 (P-86) — modal de configurações (modals/configuracoes-modal.js e
// modals/configuracoes/<aba>.js) contra um backend falso: cada aba abre e
// as ações que mexem em dado (exportar, importar, apagar tudo, PIN, chaves,
// perfil) mandam o pedido certo — e as travas (palavra de confirmação,
// senha mínima, PIN inválido) seguram antes de chegar no backend.
//
// O modal é um singleton do módulo: tudo roda numa página só, em subtestes
// na ordem.
import test from "node:test";
import assert from "node:assert/strict";
import { withDom } from "./helpers/dom.js";

const PERFIL = {
  id: "p1", display_name: "Ana", accent_color: "#8fbf8f", avatar_ascii: null, onboarding_completed: true,
  notif_alerts_enabled: true, notif_email_enabled: true, efeitos_visuais: "completo", titulo: null, tema: "padrao",
  som_ativo: true, som_volume: 60, som_progresso: true, som_interface: true, som_avisos: true, icone_tema: false,
  notif_fora_lembretes: true, notif_fora_vencimentos: true, notif_fora_eventos: true, notif_ocultar_texto: false,
  avisos_hora: "09:00", formato_data: "sistema",
};

function backendFalso() {
  const chamadas = [];
  const estado = { perfil: { ...PERFIL }, pin: { ativo: false, inatividade_min: null }, contas: [], gh: false };
  const rotas = {
    "GET /api/perfil": () => estado.perfil,
    "PUT /api/perfil": (b) => (estado.perfil = { ...estado.perfil, ...b }),
    "GET /api/nucleo/recompensas": () => ({
      level: 3,
      titulos: [{ key: "aprendiz", label: "aprendiz", description: "nível 2", unlocked: true }],
      temas: [{ key: "padrao", label: "padrão", description: "", unlocked: true }],
    }),
    "GET /api/organizacao/github-token": () => ({ configured: estado.gh }),
    "PUT /api/organizacao/github-token": () => ((estado.gh = true), { configured: true, imported: 0, removed: 0 }),
    "GET /api/organizacao/search-key": () => ({ configured: false }),
    "GET /api/organizacao/email-accounts": () => estado.contas,
    "POST /api/organizacao/email-accounts": (b) => {
      const conta = { id: `c${estado.contas.length + 1}`, ...b, app_password: undefined, sync_erro: null };
      estado.contas.push(conta);
      return conta;
    },
    "GET /api/organizacao/muted-accounts": () => [],
    "GET /api/sistema/export": () => ({ exported_at: "2026-10-22", tables: { user_profile: [] } }),
    "POST /api/sistema/export-protegido": () => ({ arquivo: { kami_backup_cifrado: 1 }, segredos_fora: 0 }),
    "POST /api/sistema/import": () => ({ ok: true }),
    "POST /api/sistema/reset": () => ({ ok: true }),
    "GET /api/sistema/diagnostico": () => ({ texto: "kami 1.14.0\nsistema: teste", versao: "1.14.0" }),
    "GET /api/seguranca/chave": () => ({ local: "cofre", cofre: "Secret Service", motivo: null, segredos_salvos: 0 }),
    "GET /api/seguranca/pin": () => estado.pin,
    "POST /api/seguranca/pin": () => ((estado.pin = { ativo: true, inatividade_min: null }), { ...estado.pin, codigo_recuperacao: "KAMI-AAAA-BBBB-CCCC" }),
    "PUT /api/seguranca/pin/inatividade": (b) => ((estado.pin = { ...estado.pin, inatividade_min: b.minutos }), estado.pin),
    "POST /api/seguranca/pin/desativar": () => ((estado.pin = { ativo: false, inatividade_min: null }), estado.pin),
  };
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const metodo = (opts.method || "GET").toUpperCase();
    const corpo = opts.body ? JSON.parse(opts.body) : undefined;
    chamadas.push({ metodo, caminho: u.pathname, corpo });
    const rota = rotas[`${metodo} ${u.pathname}`];
    if (!rota) return new Response(JSON.stringify({ detail: `rota falsa ausente: ${metodo} ${u.pathname}` }), { status: 404 });
    return new Response(JSON.stringify(rota(corpo) ?? {}), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { chamadas, estado, fetch };
}

const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test(
  "configurações: abas e ações contra um backend falso",
  withDom("<!doctype html><body></body>", async (dom, t) => {
    const back = backendFalso();
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.FileReader = dom.window.FileReader;
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    dom.window.Element.prototype.scrollIntoView = () => {}; // jsdom não implementa
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    t.mock.method(globalThis, "fetch", back.fetch);
    t.after(() => {
      delete globalThis.requestAnimationFrame;
      delete globalThis.FileReader;
      delete globalThis.CustomEvent;
      delete globalThis.getComputedStyle;
    });

    const { openConfiguracoesModal, closeConfiguracoesModal } = await import("../../frontend/js/modals/configuracoes-modal.js");
    const doc = dom.window.document;
    const $ = (sel) => doc.querySelector(sel);
    const aba = async (id) => {
      $(`.cfg-tab[data-tab="${id}"]`).click();
      await espera(60);
    };
    const digita = (el, valor) => {
      el.value = valor;
      el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    };
    const pedidos = (metodo, caminho) => back.chamadas.filter((c) => c.metodo === metodo && c.caminho === caminho);
    const confirma = async () => {
      await espera();
      $("#cm-confirm-btn").click();
      await espera(60);
    };

    await t.test("abre em aparência com o perfil carregado; as 7 abas existem", async () => {
      await openConfiguracoesModal();
      await espera(60);
      assert.ok($("#settings-modal").classList.contains("open"));
      assert.equal(doc.querySelectorAll(".cfg-tab").length, 7);
      assert.ok($('.cfg-panel[data-panel="aparencia"]').classList.contains("on"));
      assert.equal(doc.querySelectorAll("#cfg-accent-swatches .ki-swatch").length > 0, true);
      assert.match($("#cfg-rewards-desc").textContent, /nível 3/);
      assert.equal($("#cfg-name-input").value, "Ana");
    });

    await t.test("aparência: escolher outra cor salva no perfil", async () => {
      const outra = [...doc.querySelectorAll("#cfg-accent-swatches .ki-swatch")].find((b) => !b.classList.contains("selected") && b.getAttribute("aria-pressed") !== "true");
      outra.click();
      await espera(60);
      const put = pedidos("PUT", "/api/perfil").at(-1);
      assert.ok(put?.corpo?.accent_color, "deveria salvar accent_color");
      assert.notEqual(put.corpo.accent_color, PERFIL.accent_color);
    });

    await t.test("perfil: salvar o nome manda display_name", async () => {
      await aba("perfil");
      digita($("#cfg-name-input"), "Ana Clara");
      $("#cfg-name-save-btn").click();
      await espera(60);
      assert.equal(pedidos("PUT", "/api/perfil").at(-1).corpo.display_name, "Ana Clara");
    });

    await t.test("notificações: desligar e-mails no sino salva no perfil", async () => {
      await aba("notificacoes");
      const cb = $("#cfg-notif-email");
      cb.checked = false;
      cb.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await espera(60);
      assert.equal(pedidos("PUT", "/api/perfil").at(-1).corpo.notif_email_enabled, false);
    });

    await t.test("chaves: salvar token do github e cadastrar conta de e-mail", async () => {
      await aba("chaves");
      digita($("#cfg-gh-token-input"), "ghp_teste");
      $("#cfg-gh-save-btn").click();
      await espera(60);
      assert.deepEqual(pedidos("PUT", "/api/organizacao/github-token").at(-1).corpo, { token: "ghp_teste" });

      $("#cfg-acc-toggle-btn").click();
      digita($("#cfg-acc-label"), "pessoal");
      digita($("#cfg-acc-host"), "imap.exemplo.com");
      digita($("#cfg-acc-username"), "ana@exemplo.com");
      digita($("#cfg-acc-password"), "senha-de-app");
      $("#cfg-acc-save-btn").click();
      await espera(80);
      const criada = pedidos("POST", "/api/organizacao/email-accounts").at(-1)?.corpo;
      assert.equal(criada?.imap_host, "imap.exemplo.com");
      assert.equal(criada?.imap_port, 993);
      assert.match($("#cfg-accounts-list").textContent, /pessoal/);
    });

    await t.test("segurança: PIN inválido não chega no backend; PIN certo liga e mostra o código uma vez", async () => {
      await aba("seguranca");
      await espera(60);
      assert.match($("#cfg-seg-chave").textContent, /cofre do sistema/);
      digita($("#cfg-pin-novo"), "12a4");
      digita($("#cfg-pin-novo2"), "12a4");
      $('[data-pin-acao="ligar"]').click();
      await espera();
      assert.match($("#cfg-pin-status").textContent, /4 a 8 dígitos/);
      digita($("#cfg-pin-novo"), "1234");
      digita($("#cfg-pin-novo2"), "4321");
      $('[data-pin-acao="ligar"]').click();
      await espera();
      assert.match($("#cfg-pin-status").textContent, /não são iguais/);
      assert.equal(pedidos("POST", "/api/seguranca/pin").length, 0);

      digita($("#cfg-pin-novo"), "1234");
      digita($("#cfg-pin-novo2"), "1234");
      $('[data-pin-acao="ligar"]').click();
      await espera(60);
      assert.deepEqual(pedidos("POST", "/api/seguranca/pin").at(-1).corpo, { pin: "1234" });
      assert.match($("#cfg-pin").textContent, /KAMI-AAAA-BBBB-CCCC/);
      $('[data-pin-acao="guardei"]').click();
      await espera();
      assert.match($("#cfg-pin").textContent, /ligado/);

      doc.querySelector('[data-inat="15"]').click();
      await espera(60);
      assert.deepEqual(pedidos("PUT", "/api/seguranca/pin/inatividade").at(-1).corpo, { minutos: 15 });

      digita($("#cfg-pin-atual-off"), "1234");
      $('[data-pin-acao="desligar"]').click();
      await espera(60);
      assert.deepEqual(pedidos("POST", "/api/seguranca/pin/desativar").at(-1).corpo, { pin_atual: "1234" });
      assert.ok($('[data-pin-acao="ligar"]'), "volta pro formulário de ligar");
    });

    await t.test("backup: senha curta ou diferente não exporta; sem senha baixa o export comum", async () => {
      await aba("backup");
      assert.equal($("#sm-export-protect").checked, true, "proteger com senha vem marcado (P-20)");
      digita($("#sm-export-senha"), "curta");
      digita($("#sm-export-senha2"), "curta");
      $("#sm-export-btn").click();
      await espera();
      assert.match($("#sm-export-status").textContent, /pelo menos 8/);
      digita($("#sm-export-senha"), "senha-longa-1");
      digita($("#sm-export-senha2"), "senha-longa-2");
      $("#sm-export-btn").click();
      await espera();
      assert.match($("#sm-export-status").textContent, /não são iguais/);
      assert.equal(pedidos("POST", "/api/sistema/export-protegido").length, 0);

      digita($("#sm-export-senha2"), "senha-longa-1");
      $("#sm-export-btn").click();
      await espera(80);
      assert.deepEqual(pedidos("POST", "/api/sistema/export-protegido").at(-1).corpo, { senha: "senha-longa-1" });
      assert.match($("#sm-export-status").textContent, /protegido\.json/);
      assert.equal($("#sm-export-senha").value, "", "a senha não fica no campo depois");

      const protect = $("#sm-export-protect");
      protect.checked = false;
      protect.dispatchEvent(new dom.window.Event("change"));
      assert.equal($("#sm-export-unprotected-note").hidden, false, "aviso de que o arquivo leva tudo");
      $("#sm-export-btn").click();
      await espera(80);
      assert.equal(pedidos("GET", "/api/sistema/export").length, 1);
    });

    await t.test("backup: importar só libera com arquivo + palavra e pede confirmação", async () => {
      const arquivo = new dom.window.File([JSON.stringify({ tables: { user_profile: [] } })], "kami.json", { type: "application/json" });
      const input = $("#sm-import-file");
      Object.defineProperty(input, "files", { value: [arquivo], configurable: true });
      input.dispatchEvent(new dom.window.Event("change"));
      await espera(80);
      assert.equal($("#sm-import-btn").disabled, true, "sem a palavra continua travado");
      assert.equal($("#sm-import-senha-field").hidden, true, "arquivo sem senha não pede senha");
      digita($("#sm-import-confirm"), "importar");
      assert.equal($("#sm-import-btn").disabled, false);
      $("#sm-import-btn").click();
      await confirma();
      assert.deepEqual(pedidos("POST", "/api/sistema/import").at(-1).corpo, { confirmation: "importar", tables: { user_profile: [] } });
    });

    await t.test("backup: arquivo protegido pede a senha antes de liberar", async () => {
      const { estado } = await import("../../frontend/js/modals/configuracoes/estado.js");
      estado.busy = false; // o import acima "recarrega a página" (no jsdom não recarrega)
      const arquivo = new dom.window.File([JSON.stringify({ kami_backup_cifrado: 1, dados: "x" })], "p.json");
      const input = $("#sm-import-file");
      Object.defineProperty(input, "files", { value: [arquivo], configurable: true });
      input.dispatchEvent(new dom.window.Event("change"));
      await espera(80);
      assert.equal($("#sm-import-senha-field").hidden, false);
      digita($("#sm-import-confirm"), "importar");
      assert.equal($("#sm-import-btn").disabled, true, "sem a senha continua travado");
    });

    await t.test("backup: apagar tudo exige a palavra e a confirmação", async () => {
      const { estado } = await import("../../frontend/js/modals/configuracoes/estado.js");
      estado.busy = false;
      digita($("#sm-reset-confirm"), "apagar");
      assert.equal($("#sm-reset-btn").disabled, true);
      digita($("#sm-reset-confirm"), "excluir");
      assert.equal($("#sm-reset-btn").disabled, false);
      $("#sm-reset-btn").click();
      await espera();
      doc.querySelector('#confirm-modal [data-action="cancel"]').click();
      await espera();
      assert.equal(pedidos("POST", "/api/sistema/reset").length, 0, "cancelar não apaga");
      $("#sm-reset-btn").click();
      await confirma();
      assert.deepEqual(pedidos("POST", "/api/sistema/reset").at(-1).corpo, { confirmation: "excluir" });
    });

    await t.test("sobre: mostra a versão e o diagnóstico", async () => {
      const { estado } = await import("../../frontend/js/modals/configuracoes/estado.js");
      estado.busy = false;
      await aba("sobre");
      await espera(60);
      assert.match($("#cfg-diag-preview").textContent, /kami 1\.14\.0/);
      $("#cfg-diag-copy").click();
      await espera(60);
      assert.match($("#cfg-diag-status").textContent, /copiado|copie à mão/);
    });

    await t.test("fechar e reabrir em outra aba", async () => {
      closeConfiguracoesModal();
      assert.equal($("#settings-modal").classList.contains("open"), false);
      await openConfiguracoesModal("backup");
      await espera(60);
      assert.ok($('.cfg-panel[data-panel="backup"]').classList.contains("on"));
      assert.equal($("#sm-reset-confirm").value, "", "palavra de confirmação limpa ao reabrir");
      assert.equal($("#sm-reset-btn").disabled, true);
      closeConfiguracoesModal();
    });
  })
);
