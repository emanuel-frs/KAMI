#!/usr/bin/env node
/**
 * Teste ponta a ponta do app Kami compilado (CONF-03) — Linux e Windows.
 *
 * Abre o executável de verdade (Tauri + sidecar), com uma pasta de dados
 * descartável, e confere o que um usuário veria:
 *   1. o app abre e o backend sobe; os dados fictícios do modo demo
 *      (scripts/seed_demo.py) entram pela API, com o token da sessão;
 *   2. passa pelas 8 telas em 3 tamanhos de janela, tira um print de cada
 *      e confere que nenhum aviso de erro (CONF-01) apareceu;
 *   3. registra uma ação pela interface (widget "registrar ação");
 *   4. derruba o backend e confere que o vigia (CONF-02) o traz de volta
 *      sozinho, sem fechar o app;
 *   5. no fim, o kami-backend.log não pode ter erro da tela
 *      ([app.frontend]) nem erro inesperado do backend ([app.erros]).
 *
 * Os prints e o log vão pra KAMI_E2E_OUT — no CI viram artefato do
 * workflow, que é como dá pra ver o layout no Windows sem ter Windows.
 *
 * Variáveis de ambiente:
 *   KAMI_E2E_APP            executável do app (obrigatório)
 *   KAMI_E2E_TAURI_DRIVER   tauri-driver (padrão: "tauri-driver" no PATH)
 *   KAMI_E2E_NATIVE_DRIVER  driver nativo (Windows: msedgedriver.exe); opcional
 *   KAMI_E2E_PYTHON         python pra rodar o seed (padrão: python3 / python no Windows)
 *   KAMI_E2E_OUT            pasta dos prints e do log (padrão: ./e2e-output)
 *
 * Uso local (Linux):
 *   KAMI_E2E_APP=src-tauri/target/debug/kami node tests/e2e/kami-e2e.mjs
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebDriver } from "./webdriver.mjs";

const IS_WINDOWS = process.platform === "win32";
const APP = process.env.KAMI_E2E_APP && resolve(process.env.KAMI_E2E_APP);
const TAURI_DRIVER = process.env.KAMI_E2E_TAURI_DRIVER || "tauri-driver";
const NATIVE_DRIVER = process.env.KAMI_E2E_NATIVE_DRIVER || "";
const PYTHON = process.env.KAMI_E2E_PYTHON || (IS_WINDOWS ? "python" : "python3");
const OUT = resolve(process.env.KAMI_E2E_OUT || "e2e-output");
const DATA_DIR = mkdtempSync(join(tmpdir(), "kami-e2e-"));

const PAGES = ["nucleo", "perfil", "financas", "carreira", "aprendizado", "organizacao", "metas", "calendario"];
const SIZES = [
  [960, 600],
  [1280, 800],
  [1920, 1080],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);
const fail = (msg) => {
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};

async function waitFor(what, fn, { timeout = 30000, every = 500 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`tempo esgotado esperando ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
}

function killBackend() {
  // no CI só existe o nosso sidecar; nome do processo igual nos dois sistemas
  if (IS_WINDOWS) execSync("taskkill /F /T /IM kami-backend.exe", { stdio: "ignore" });
  else execSync("pkill -9 -x kami-backend", { stdio: "ignore" });
}

async function main() {
  if (!APP || !existsSync(APP)) throw new Error(`KAMI_E2E_APP não aponta pra um executável: ${APP}`);
  mkdirSync(OUT, { recursive: true });
  log(`app: ${APP}`);
  log(`dados: ${DATA_DIR}`);

  const driverArgs = NATIVE_DRIVER ? ["--native-driver", NATIVE_DRIVER] : [];
  const driver = spawn(TAURI_DRIVER, driverArgs, {
    env: { ...process.env, KAMI_DATA_DIR: DATA_DIR },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const wd = new WebDriver();
  try {
    await waitFor("o tauri-driver", async () => (await fetch("http://127.0.0.1:4444/status")).ok, { timeout: 20000 });
    await wd.start(APP);
    log("app aberto");

    // 1. backend de pé + dados fictícios
    const portFile = join(DATA_DIR, "backend_port.txt");
    await waitFor("o backend publicar a porta", () => existsSync(portFile), { timeout: 120000 });
    const port = readFileSync(portFile, "utf8").trim();
    const token = readFileSync(join(DATA_DIR, "backend_token.txt"), "utf8").trim();
    execSync(`${PYTHON} scripts/seed_demo.py --base-url http://127.0.0.1:${port} --token ${token}`, { stdio: "inherit" });
    await wd.refresh();
    await waitFor("os widgets do núcleo", () => wd.execute("return document.querySelectorAll('.card').length > 0"), { timeout: 60000 });
    // avisos que não são erro (ex.: lembrete de backup) atrapalham o print
    await wd.execute("document.querySelectorAll('.toast-item').forEach((t) => t.remove())");
    log("dados fictícios carregados");

    // 2. telas × tamanhos
    for (const [w, h] of SIZES) {
      const resized = await wd.setWindowSize(w, h);
      if (!resized) log(`  (o driver não mudou a janela pra ${w}×${h}; print no tamanho atual)`);
      await sleep(600);
      for (const page of PAGES) {
        await wd.execute(`document.querySelector('.nav-link[data-page="${page}"]').click()`);
        await sleep(2500);
        const errors = await wd.execute(
          "return [...document.querySelectorAll('.toast-erro')].map((t) => t.innerText.replace(/\\s+/g, ' '))"
        );
        if (errors.length) fail(`tela ${page} (${w}×${h}): aviso de erro: ${errors.join(" | ")}`);
        // avisos comuns (lembrete de backup, sequência...) cobrem o layout no print
        await wd.execute("document.querySelectorAll('.toast-item:not(.toast-erro), #backup-reminder-toast').forEach((t) => t.remove())");
        writeFileSync(join(OUT, `${w}x${h}-${page}.png`), await wd.screenshot());
      }
      log(`  ${w}×${h}: ${PAGES.length} telas`);
    }

    // 3. uma ação pela interface
    await wd.execute(`document.querySelector('.nav-link[data-page="nucleo"]').click()`);
    await sleep(2500);
    await wd.execute(`
      const d = document.querySelector('.reg-desc');
      d.value = 'teste ponta a ponta (CONF-03)';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.reg-submit').click();
    `);
    await waitFor("o 'registrado' do widget", () =>
      wd.execute("const m = document.querySelector('.reg-msg'); return m && getComputedStyle(m).display !== 'none'"),
      { timeout: 15000 }
    ).then(() => log("ação registrada pela interface"), (e) => fail(`registrar ação: ${e.message}`));

    // 4. derruba o backend → o vigia traz de volta
    await wd.execute("document.querySelectorAll('.toast-item').forEach((t) => t.remove())");
    killBackend();
    log("backend derrubado; esperando o vigia");
    await waitFor("a faixa 'reiniciando'", () =>
      wd.execute("const b = document.getElementById('backend-banner'); return !!b && !b.hidden"),
      { timeout: 40000 }
    ).catch((e) => fail(`vigia não reagiu: ${e.message}`));
    await waitFor("o backend voltar", () =>
      wd.execute("return [...document.querySelectorAll('.toast-item')].some((t) => /de volta/.test(t.textContent))"),
      { timeout: 90000 }
    ).then(() => log("backend reiniciado pelo vigia"), (e) => fail(`backend não voltou: ${e.message}`));
    writeFileSync(join(OUT, "depois-do-reinicio.png"), await wd.screenshot());
  } finally {
    await wd.quit().catch(() => {});
    driver.kill();
    await sleep(1500);
  }

  // 5. o log não pode ter erro da tela nem erro inesperado
  const logFile = join(DATA_DIR, "kami-backend.log");
  if (existsSync(logFile)) {
    copyFileSync(logFile, join(OUT, "kami-backend.log"));
    const text = readFileSync(logFile, "utf8");
    for (const line of text.split("\n")) {
      if (/\[app\.frontend\]|\[app\.erros\]/.test(line)) fail(`log: ${line.trim()}`);
    }
  } else {
    log("(sem kami-backend.log — normal no build debug, que roda o sidecar com console)");
  }
}

main()
  .catch((e) => fail(e.stack || e.message))
  .finally(() => {
    if (failures.length) {
      console.error(`\n${failures.length} falha(s) no teste ponta a ponta. Prints e log em ${OUT}`);
      process.exit(1);
    }
    log(`tudo certo. Prints e log em ${OUT}`);
    process.exit(0);
  });
