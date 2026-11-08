#!/usr/bin/env node
/**
 * EST-03 (P-181): axe-core em todas as telas e nos modais principais, no
 * Chromium headless (o mesmo motor do WebView2) com dados de demonstração.
 * Falha com qualquer problema "critical" ou "serious"; "moderate" e
 * "minor" só aparecem no relatório.
 *
 * Precisa do backend com o demo e do frontend servido:
 *   cd backend && KAMI_DATA_DIR=<pasta nova> .venv/bin/python -m uvicorn app.main:app --port 8000
 *   backend/.venv/bin/python scripts/seed_demo.py
 *   cd frontend && python3 -m http.server 8765 --bind 127.0.0.1
 *   node scripts/a11y_axe.mjs [--url http://127.0.0.1:8765/index.html] [--largura 1280]
 *
 * O axe entra pela página (Runtime.evaluate), só aqui: não vai no app.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const URL_APP = arg("--url", "http://127.0.0.1:8765/index.html");
const LARGURA = Number(arg("--largura", 1280));
const AXE = readFileSync(join(RAIZ, "node_modules", "axe-core", "axe.min.js"), "utf8");
const GRAVES = new Set(["critical", "serious"]);

const tela = (nome) => `import("/js/components/navigate.js").then((m) => m.navigateTo(${JSON.stringify(nome)}))`;
const config = (aba) => `import("/js/modals/configuracoes-modal.js").then((m) => m.openConfiguracoesModal(${JSON.stringify(aba)}))`;
const CENAS = [
  ...["perfil", "nucleo", "financas", "carreira", "aprendizado", "organizacao", "metas", "calendario", "habitos"].map((n) => ({ nome: `tela ${n}`, abrir: tela(n) })),
  ...["aparencia", "perfil", "notificacoes", "chaves", "assistente", "seguranca", "backup", "sobre"].map((a) => ({ nome: `configurações › ${a}`, abrir: config(a) })),
  { nome: "atalhos (Alt+H)", abrir: `import("/js/modals/shortcuts-help-modal.js").then((m) => (m.openShortcutsHelpModal || m.openShortcutsHelp)?.())` },
  { nome: "notificações (sino)", abrir: `import("/js/modals/notificacoes-modal.js").then((m) => m.openNotificacoesModal())` },
  { nome: "captura rápida", abrir: `import("/js/components/captura.js").then((m) => m.abrirCaptura())` },
  { nome: "novo lançamento", abrir: `import("/js/modals/transacao-modal.js").then((m) => m.openTransacaoModal({ accounts: [] }))` },
  { nome: "novo hábito", abrir: `import("/js/modals/habito-modal.js").then((m) => m.openHabitoModal({}))` },
  { nome: "novo lembrete", abrir: `import("/js/modals/lembrete-modal.js").then((m) => m.openLembreteModal({}))` },
  { nome: "novo evento", abrir: `import("/js/modals/calendario-evento-modal.js").then((m) => m.openCalendarioEventoModal({ date: "2026-11-10" }))` },
  { nome: "paleta (Ctrl+K)", abrir: `Promise.resolve(document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })))` },
  { nome: "aviso clicável (toast)", abrir: `import("/js/components/toast.js").then((m) => m.showToast({ title: "lembrete", message: "pagar a conta", duration: 0, onClick: () => {}, actions: [{ label: "adiar", onClick: () => true }] }))` },
  { nome: "assistente (Alt+A)", abrir: `import("/js/components/assistente-painel.js").then((m) => m.alternarAssistente())` },
];

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = mkdtempSync(join(tmpdir(), "kami-axe-"));
const cr = spawn("chromium-browser", ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${perfil}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let falhou = false;
try {
  let alvo;
  for (let i = 0; i < 50 && !alvo; i++) {
    await espera(200);
    try { alvo = (await (await fetch("http://127.0.0.1:9334/json")).json()).find((t) => t.type === "page"); } catch { /* subindo */ }
  }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "erro na página");
    return r.result?.result?.value;
  };
  await cmd("Network.enable");
  await cmd("Network.setCacheDisabled", { cacheDisabled: true });
  await cmd("Emulation.setDeviceMetricsOverride", { width: LARGURA, height: 900, deviceScaleFactor: 1, mobile: false });

  const graves = [];
  const menores = new Map();
  for (const cena of CENAS) {
    await cmd("Page.navigate", { url: URL_APP });
    await espera(3500);
    try {
      await ev(cena.abrir);
    } catch (err) {
      console.log(`! ${cena.nome}: não abriu (${err.message.split("\n")[0]})`);
      falhou = true;
      continue;
    }
    await espera(1200);
    await ev(AXE);
    const res = await ev(`axe.run(document, { resultTypes: ["violations"] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, alvos: v.nodes.slice(0, 4).map((n) => n.target.join(" ")), n: v.nodes.length })))`);
    for (const v of res) {
      if (GRAVES.has(v.impact)) graves.push({ cena: cena.nome, ...v });
      else menores.set(v.id, { ...v, cenas: [...(menores.get(v.id)?.cenas || []), cena.nome] });
    }
    console.log(`${res.some((v) => GRAVES.has(v.impact)) ? "✗" : "✓"} ${cena.nome}`);
  }
  // a tela de trás aparece em toda cena de modal: agrupa por regra + elemento
  const unicos = new Map();
  for (const g of graves) {
    for (const alvo of g.alvos) {
      const k = `${g.id} ${alvo}`;
      const u = unicos.get(k) || { ...g, alvo, cenas: [] };
      u.cenas.push(g.cena);
      unicos.set(k, u);
    }
  }
  console.log(`\n${unicos.size} problema(s) critical/serious`);
  for (const u of unicos.values()) console.log(`- [${u.impact}] ${u.id}: ${u.alvo}  (${u.help}) — ${u.cenas.length === CENAS.length ? "todas" : u.cenas.join(", ")}`);
  if (menores.size) {
    console.log("\nmoderate/minor (não falham):");
    for (const v of menores.values()) console.log(`- [${v.impact}] ${v.id}: ${v.help} — ${v.cenas.length} cena(s), ex. ${v.alvos[0]}`);
  }
  if (graves.length) falhou = true;
} finally {
  cr.kill();
  await espera(300);
  rmSync(perfil, { recursive: true, force: true });
}
process.exit(falhou ? 1 : 0);
