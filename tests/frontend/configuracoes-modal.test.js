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
import { readFileSync } from "node:fs";

const CATALOGO = JSON.parse(readFileSync(new URL("../../backend/app/assistente/provedores.json", import.meta.url), "utf8")).provedores;
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
  const estado = {
    perfil: { ...PERFIL }, pin: { ativo: false, inatividade_min: null }, contas: [], gh: false,
    backups: {
      copias: [{ nome: "kami-antes-de-apagar-tudo-20261021-090000.db", tipo: "antes", acao: "apagar-tudo", quando: "2026-10-21T09:00:00-03:00", tamanho: 2048 }],
      semanal_manter: 4, semanal_dias: 7, pasta_extra: null, extra_ok_em: null, extra_erro: null, extra_atrasada: false,
    },
    ia: {
      permissoes: { financas: true, metas: true, agenda: true, habitos: true, aprendizado: true, progresso: true, entrada: true, links: true, github: true, notas: false },
      conversas: [
        { id: "c1", titulo: "guardada", guardada: true, updated_at: "2026-10-27T11:34:00-03:00" },
        { id: "c2", titulo: "só na memória", guardada: false, updated_at: "2026-10-27T11:35:00-03:00" },
      ],
      provedores: [],
      config: { ativo: false, escondido: false, provedor_id: null, teto_chamadas: 150, teto_tokens: 200000, max_rodadas: 6, guardar_conversas: true, dias_historico: 30 },
    },
  };
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
    // CONF-08
    "GET /api/backups": () => estado.backups,
    "POST /api/backups/agora": () => {
      estado.backups.copias.unshift({ nome: "kami-semanal-20261022-100000.db", tipo: "semanal", acao: null, quando: "2026-10-22T10:00:00-03:00", tamanho: 524288 });
      return estado.backups;
    },
    "PUT /api/backups/pasta-extra": (b) => {
      if (b.pasta && !b.pasta.startsWith("/")) return { __status: 422, detail: "use o caminho completo da pasta" };
      estado.backups = { ...estado.backups, pasta_extra: b.pasta, extra_ok_em: b.pasta ? "2026-10-22T10:01:00-03:00" : null };
      return estado.backups;
    },
    "POST /api/backups/restaurar": () => estado.backups,
    // IA-01: assistente (a chave nunca volta — só tem_chave)
    // o catálogo de verdade (IA-04: o passo a passo usa os caminhos e links dele)
    "GET /api/assistente/catalogo": () => CATALOGO,
    "GET /api/assistente": () => estadoIa(),
    "GET /api/assistente/provedores": () => estado.ia.provedores,
    "POST /api/assistente/modelos": (b) => (b.url_base.includes("11434") ? { modelos: ["llama3.1:8b", "qwen2.5:7b"] } : { __status: 422, detail: "x", chave: "erro.assistente.falta.chave", vars: {} }),
    "POST /api/assistente/provedores": (b) => {
      const p = { id: `ia${estado.ia.provedores.length + 1}`, catalogo: b.catalogo, nome: b.catalogo === "ollama" ? "Ollama" : "Groq", tipo: "openai", url_base: b.url_base, modelo: b.modelo, tem_chave: Boolean(b.api_key), local: b.catalogo === "ollama", chave_exigida: b.catalogo !== "ollama", links: {}, selo: null, teste_ok: null, ferramentas_ok: null, teste_em: null };
      estado.ia.provedores.push(p);
      estado.ia.config.provedor_id = estado.ia.config.provedor_id || p.id;
      return p;
    },
    "POST /api/assistente/provedores/ia1/testar": () => {
      const p = estado.ia.provedores[0];
      Object.assign(p, { teste_ok: true, ferramentas_ok: true, teste_em: "2026-10-26T21:00:00-03:00" });
      return { ok: true, ferramentas: true, ms: 1234, provedor: p, uso_hoje: { chamadas: 1, tokens: 40, estimado: false } };
    },
    "PUT /api/assistente/config": (b) => {
      const { permissoes, ...resto } = b;
      estado.ia.config = { ...estado.ia.config, ...resto };
      estado.ia.permissoes = { ...estado.ia.permissoes, ...(permissoes || {}) };
      return estadoIa();
    },
    "GET /api/assistente/conversas": () => estado.ia.conversas,
    "DELETE /api/assistente/conversas": () => ((estado.ia.conversas = []), {}),
  };
  function estadoIa() {
    const p = estado.ia.provedores.find((x) => x.id === estado.ia.config.provedor_id) || null;
    const falta = !p ? "provedor" : !p.modelo ? "modelo" : estado.ia.config.ativo ? null : "desligado";
    return { config: { ...estado.ia.config }, permissoes: { ...estado.ia.permissoes }, provedor: p, pronto: falta === null, falta, uso_hoje: { chamadas: 0, tokens: 0, estimado: false } };
  }
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const metodo = (opts.method || "GET").toUpperCase();
    const corpo = opts.body ? JSON.parse(opts.body) : undefined;
    chamadas.push({ metodo, caminho: u.pathname, corpo });
    const rota = rotas[`${metodo} ${u.pathname}`];
    if (!rota) return new Response(JSON.stringify({ detail: `rota falsa ausente: ${metodo} ${u.pathname}` }), { status: 404 });
    const resposta = rota(corpo) ?? {};
    const status = resposta.__status ?? 200;
    return new Response(JSON.stringify(resposta), { status, headers: { "content-type": "application/json" } });
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

    await t.test("abre em aparência com o perfil carregado; as 8 abas existem", async () => {
      await openConfiguracoesModal();
      await espera(60);
      assert.ok($("#settings-modal").classList.contains("open"));
      assert.equal(doc.querySelectorAll(".cfg-tab").length, 8);
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

    await t.test("backup: cópias automáticas — lista, copiar agora, pasta extra e restaurar", async () => {
      await espera(60);
      assert.match($("#cfg-copias-lista").textContent, /antes de apagar tudo/);
      $("#cfg-copias-agora").click();
      await espera(60);
      assert.equal(doc.querySelectorAll("#cfg-copias-lista [data-restaurar]").length, 2);
      assert.match($("#cfg-copias-lista").textContent, /semanal · 512 KB/);

      digita($("#cfg-copias-pasta"), "relativa/kami");
      $("#cfg-copias-pasta-salvar").click();
      await espera(60);
      assert.match($("#cfg-copias-pasta-status").textContent, /caminho completo/);
      assert.equal($("#cfg-copias-pasta-tirar").hidden, true);
      digita($("#cfg-copias-pasta"), "/media/pendrive/kami");
      $("#cfg-copias-pasta-salvar").click();
      await espera(60);
      assert.deepEqual(pedidos("PUT", "/api/backups/pasta-extra").at(-1).corpo, { pasta: "/media/pendrive/kami" });
      assert.equal($("#cfg-copias-pasta-tirar").hidden, false);
      $("#cfg-copias-pasta-tirar").click();
      await espera(60);
      assert.deepEqual(pedidos("PUT", "/api/backups/pasta-extra").at(-1).corpo, { pasta: null });

      doc.querySelector('#cfg-copias-lista [data-restaurar="kami-antes-de-apagar-tudo-20261021-090000.db"]').click();
      await espera();
      doc.querySelector('#confirm-modal [data-action="cancel"]').click();
      await espera();
      assert.equal(pedidos("POST", "/api/backups/restaurar").length, 0, "cancelar não restaura");
      doc.querySelector('#cfg-copias-lista [data-restaurar="kami-antes-de-apagar-tudo-20261021-090000.db"]').click();
      await confirma();
      assert.deepEqual(pedidos("POST", "/api/backups/restaurar").at(-1).corpo, { nome: "kami-antes-de-apagar-tudo-20261021-090000.db", confirmation: "restaurar" });
      const { estado } = await import("../../frontend/js/modals/configuracoes/estado.js");
      estado.busy = false; // restaurar "recarrega a página" (no jsdom não recarrega)
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

    await t.test("assistente (IA-01): começa desligado; cadastrar o Ollama, buscar modelos, salvar e testar, ligar", async () => {
      await aba("assistente");
      await espera(60);
      assert.equal($("#cfg-ia-ativo").disabled, true, "sem provedor não dá pra ligar");
      assert.match($("#cfg-ia-falta").textContent, /provedor/);
      $("#cfg-ia-novo").click();
      const sel = $("#cfg-ia-catalogo");
      sel.value = "ollama";
      sel.dispatchEvent(new dom.window.Event("change"));
      assert.equal($("#cfg-ia-url").value, "http://localhost:11434/v1");
      assert.equal($("#cfg-ia-chave-campo").hidden, true, "local não pede chave");
      $("#cfg-ia-form-ok").click();
      await espera();
      assert.equal(pedidos("POST", "/api/assistente/provedores").length, 0, "sem modelo não salva");
      $("#cfg-ia-buscar").click();
      await espera(60);
      const opcoes = [...doc.querySelectorAll("#cfg-ia-modelos [data-modelo]")].map((li) => li.dataset.modelo);
      assert.deepEqual(opcoes, ["llama3.1:8b", "qwen2.5:7b"]);
      digita($("#cfg-ia-modelo"), "qwen");
      assert.deepEqual([...doc.querySelectorAll("#cfg-ia-modelos [data-modelo]")].map((li) => li.dataset.modelo), ["qwen2.5:7b"]);
      doc.querySelector("#cfg-ia-modelos [data-modelo]").click();
      assert.equal($("#cfg-ia-modelo").value, "qwen2.5:7b");
      $("#cfg-ia-form-ok").click();
      await espera(400);
      assert.deepEqual(pedidos("POST", "/api/assistente/provedores").at(-1).corpo, { catalogo: "ollama", url_base: "http://localhost:11434/v1", modelo: "qwen2.5:7b" });
      assert.equal(pedidos("POST", "/api/assistente/provedores/ia1/testar").length, 1, "salvar já testa");
      assert.match($(".cfg-ia-prov").textContent, /Ollama/);
      assert.match($(".cfg-ia-prov-status").textContent, /1,2|1\.2/);
      assert.equal($("#cfg-ia-ativo").disabled, false);
      $("#cfg-ia-ativo").click();
      await espera(60);
      assert.deepEqual(pedidos("PUT", "/api/assistente/config").at(-1).corpo, { ativo: true });
      assert.match($("#cfg-ia-em-uso").textContent, /qwen2\.5:7b/);
    });

    await t.test("assistente (IA-01): na nuvem sem chave, buscar modelos mostra o erro sem quebrar", async () => {
      $("#cfg-ia-novo").click();
      const sel = $("#cfg-ia-catalogo");
      sel.value = "groq";
      sel.dispatchEvent(new dom.window.Event("change"));
      assert.equal($("#cfg-ia-chave-campo").hidden, false);
      $("#cfg-ia-buscar").click();
      await espera(60);
      assert.ok($("#cfg-ia-form-status").classList.contains("cfg-ia-falha"));
      $("#cfg-ia-form-voltar").click();
      assert.equal($("#cfg-ia-form").hidden, true);
    });

    await t.test("assistente (IA-03): permissões por área — notas começam desligadas e ligam com um clique", async () => {
      const notas = $('[data-ia-area="notas"]');
      assert.equal(doc.querySelectorAll("[data-ia-area]").length, 10);
      assert.equal(notas.checked, false);
      assert.equal($('[data-ia-area="financas"]').checked, true);
      notas.checked = true;
      notas.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await espera(60);
      assert.deepEqual(pedidos("PUT", "/api/assistente/config").at(-1).corpo, { permissoes: { notas: true } });
      assert.equal($('[data-ia-area="notas"]').checked, true);
    });

    await t.test("assistente (IA-02): desligar 'guardar conversas' pergunta se apaga as já guardadas", async () => {
      const guardar = $("#cfg-ia-guardar");
      assert.equal(guardar.checked, true);
      guardar.checked = false;
      guardar.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await espera(60);
      assert.match($("#cm-message").textContent, /1 conversa guardada/, "conta só as guardadas");
      assert.match($("#cm-confirm-btn").textContent, /desligar e apagar/);
      await confirma();
      assert.equal(pedidos("DELETE", "/api/assistente/conversas").length, 1);
      assert.deepEqual(pedidos("PUT", "/api/assistente/config").at(-1).corpo, { guardar_conversas: false });
      // religar não pergunta nada
      guardar.checked = true;
      guardar.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await espera(60);
      assert.deepEqual(pedidos("PUT", "/api/assistente/config").at(-1).corpo, { guardar_conversas: true });
      // sem conversa guardada, desliga direto
      guardar.checked = false;
      guardar.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await espera(60);
      assert.equal(pedidos("DELETE", "/api/assistente/conversas").length, 1);
      assert.deepEqual(pedidos("PUT", "/api/assistente/config").at(-1).corpo, { guardar_conversas: false });
    });

    await t.test("assistente (IA-04): passo a passo — gratuita › OpenRouter, com o aviso de dados, e 'usar este' abre o formulário", async () => {
      $("#cfg-ia-guia-btn").click();
      await espera(60);
      const opcoes = () => [...$("#cfg-ia-guia").querySelectorAll("[data-guia]")].map((b) => `${b.dataset.guia}:${b.dataset.valor || ""}`);
      assert.deepEqual(opcoes(), ["caminho:paga", "caminho:gratuita", "caminho:local", "sair:"]);
      assert.equal($("#cfg-ia-guia-btn").hidden, true);
      $('[data-guia="caminho"][data-valor="gratuita"]').click();
      assert.deepEqual(opcoes(), ["provedor:gemini", "provedor:groq", "provedor:openrouter", "provedor:outro", "voltar:"]);
      $('[data-guia="provedor"][data-valor="openrouter"]').click();
      const ficha = $("#cfg-ia-guia").textContent;
      assert.match(ficha, /guardam ou usam o que você envia/, "aviso de dados (P-118)");
      assert.match(ficha, /deixe "só os gratuitos" marcado/, "passo cita o rótulo da tela");
      assert.doesNotMatch(ficha, /\{\w+\}/, "nenhuma variável sem trocar");
      const links = [...$("#cfg-ia-guia").querySelectorAll("[data-open-link]")].map((l) => l.dataset.openLink);
      assert.ok(links.includes("https://openrouter.ai/settings/privacy") && links.includes("https://openrouter.ai/settings/keys"));
      $('[data-guia="usar"]').click();
      await espera(20);
      assert.equal($("#cfg-ia-guia").hidden, true);
      assert.equal($("#cfg-ia-catalogo").value, "openrouter");
      assert.equal($("#cfg-ia-url").value, "https://openrouter.ai/api/v1");
      $("#cfg-ia-form-voltar").click();
      // no computador: requisitos e nada de aviso de nuvem
      $("#cfg-ia-guia-btn").click();
      $('[data-guia="caminho"][data-valor="local"]').click();
      assert.deepEqual(opcoes(), ["provedor:ollama", "provedor:lmstudio", "provedor:outro", "voltar:"]);
      $('[data-guia="provedor"][data-valor="ollama"]').click();
      assert.match($("#cfg-ia-guia").textContent, /8 GB/);
      assert.equal($("#cfg-ia-guia").querySelector(".cfg-ia-guia-item--dados"), null);
      $('[data-guia="voltar"]').click();
      $('[data-guia="voltar"]').click();
      $('[data-guia="sair"]').click();
      assert.equal($("#cfg-ia-guia").hidden, true);
      assert.equal($("#cfg-ia-guia-btn").hidden, false);
    });

    await t.test("assistente (IA-04): aberto pelo painel já cai no passo a passo", async () => {
      closeConfiguracoesModal();
      await openConfiguracoesModal("assistente", { guia: true });
      await espera(80);
      assert.equal($("#cfg-ia-guia").hidden, false);
      assert.ok($('[data-guia="caminho"][data-valor="paga"]'));
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
