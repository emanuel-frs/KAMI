#!/usr/bin/env node
/**
 * Atualização pelo app no Windows, de ponta a ponta (DIST-01) — roda no
 * job e2e-windows do smoke-test.yml.
 *
 * O job do Windows compila dois instaladores assinados com uma chave
 * DESCARTÁVEL (a da release nunca entra no CI de PR): a versão atual e a
 * seguinte, os dois com `dangerousInsecureTransportProtocol` pra aceitar o
 * servidor local daqui. Este teste:
 *   1. serve a versão nova e um latest.json (scripts/gerar_latest_json.py,
 *      o mesmo da release) em http://127.0.0.1:8790;
 *   2. instala a versão atual (NSIS, por usuário, silencioso);
 *   3. abre o app instalado pelo WebDriver, com KAMI_ATUALIZACAO_URL
 *      apontando pro servidor, e pede "procurar" e "instalar" — os mesmos
 *      comandos do botão "atualizar agora";
 *   4. o app fecha, o instalador troca os arquivos e abre o app de novo:
 *      confere a versão do kami.exe instalado e que ele está rodando. Se o
 *      backend antigo não tivesse saído antes (on_before_exit), o
 *      instalador não conseguiria trocar o kami-backend.exe.
 *
 * Variáveis: KAMI_E2E_ATUALIZACAO (pasta com antiga-setup.exe,
 * nova-setup.exe, nova-setup.exe.sig e versoes.json), KAMI_E2E_TAURI_DRIVER,
 * KAMI_E2E_NATIVE_DRIVER, KAMI_E2E_PYTHON, KAMI_E2E_OUT.
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebDriver } from "./webdriver.mjs";

const PASTA = resolve(process.env.KAMI_E2E_ATUALIZACAO || "atualizacao");
const TAURI_DRIVER = process.env.KAMI_E2E_TAURI_DRIVER || "tauri-driver";
const NATIVE_DRIVER = process.env.KAMI_E2E_NATIVE_DRIVER || "";
const PYTHON = process.env.KAMI_E2E_PYTHON || "python";
const OUT = resolve(process.env.KAMI_E2E_OUT || "e2e-output");
const DATA_DIR = mkdtempSync(join(tmpdir(), "kami-atualizacao-"));
const { antiga, nova } = JSON.parse(readFileSync(join(PASTA, "versoes.json"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[atualizacao ${new Date().toISOString().slice(11, 19)}]`, ...a);
const ps = (script) => execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
// o recurso de versão do Windows pode vir com 4 partes (1.14.0.0)
const versaoDoExe = (exe) => ps(`(Get-Item '${exe}').VersionInfo.ProductVersion`).replace(/^(\d+\.\d+\.\d+)\.0$/, "$1");

async function waitFor(what, fn, { timeout = 30000, every = 1000 } = {}) {
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

async function main() {
  if (process.platform !== "win32") throw new Error("este teste é só do Windows (o AppImage é conferido à mão — ver docs/MANUTENCAO.md)");
  mkdirSync(OUT, { recursive: true });
  log(`de ${antiga} para ${nova}; dados: ${DATA_DIR}`);

  // 1. servidor local: latest.json + o instalador novo
  writeFileSync(
    join(PASTA, "latest.json"),
    execFileSync(PYTHON, [
      "scripts/gerar_latest_json.py", "--versao", nova, "--base-url", "http://127.0.0.1:8790",
      "--windows", "nova-setup.exe", join(PASTA, "nova-setup.exe.sig"),
      "--appimage", "nao-usado.AppImage", join(PASTA, "nova-setup.exe.sig"),
    ])
  );
  const pedidos = [];
  const servidor = createServer((req, res) => {
    pedidos.push(req.url);
    const arquivo = join(PASTA, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""));
    if (!arquivo.startsWith(PASTA) || !existsSync(arquivo)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Length": statSync(arquivo).size });
    createReadStream(arquivo).pipe(res);
  }).listen(8790, "127.0.0.1");

  // 2. instala a versão atual
  execFileSync(join(PASTA, "antiga-setup.exe"), ["/S"], { stdio: "inherit" });
  const exe = join(process.env.LOCALAPPDATA, "Kami", "kami.exe");
  if (!existsSync(exe)) throw new Error(`kami.exe não está em ${exe} depois de instalar`);
  const antes = versaoDoExe(exe);
  log(`instalado: ${exe} (${antes})`);
  if (antes !== antiga) throw new Error(`versão instalada ${antes}, esperada ${antiga}`);

  // 3. abre pelo WebDriver e pede a atualização
  const env = { ...process.env, KAMI_DATA_DIR: DATA_DIR, KAMI_ATUALIZACAO_URL: "http://127.0.0.1:8790/latest.json" };
  const driver = spawn(TAURI_DRIVER, NATIVE_DRIVER ? ["--native-driver", NATIVE_DRIVER] : [], { env, stdio: ["ignore", "inherit", "inherit"] });
  const wd = new WebDriver();
  try {
    await waitFor("o tauri-driver", async () => (await fetch("http://127.0.0.1:4444/status")).ok, { timeout: 20000 });
    await wd.start(exe);
    await waitFor("o backend", () => existsSync(join(DATA_DIR, "backend_port.txt")), { timeout: 120000 });
    const achou = await wd.execute("return window.__TAURI__.core.invoke('atualizacao_procurar')");
    log(`procurar: ${JSON.stringify(achou)}`);
    if (achou?.versao !== nova || !achou.instalavel) throw new Error(`procurar devolveu ${JSON.stringify(achou)}`);
    // não espera: dando certo, o app fecha no meio (o instalador assume)
    await wd.execute("window.__TAURI__.core.invoke('atualizacao_instalar').catch((e) => window.__erroAtualizacao = String(e)); return 1");
    const erro = await sleep(5000).then(() => wd.execute("return window.__erroAtualizacao || null")).catch(() => null);
    if (erro) throw new Error(`instalar: ${erro}`);
  } finally {
    await wd.quit().catch(() => {});
    driver.kill();
  }

  // 4. o instalador troca os arquivos e reabre o app
  await waitFor(`o kami.exe instalado na ${nova}`, () => versaoDoExe(exe) === nova, { timeout: 240000, every: 3000 });
  log(`kami.exe instalado agora: ${versaoDoExe(exe)}`);
  const rodando = await waitFor("o app reaberto", () => ps(`(Get-Process -Name kami -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exe}' }).Count`) !== "0" || null, { timeout: 60000, every: 2000 });
  log(`app reaberto pelo instalador (${rodando} processo)`);
  log(`pedidos ao servidor: ${pedidos.join(", ")}`);
  ps("Get-Process -Name kami,kami-backend -ErrorAction SilentlyContinue | Stop-Process -Force");
  servidor.close();
}

main().then(
  () => {
    log("tudo certo");
    process.exit(0);
  },
  (e) => {
    console.error(`\nfalha no teste de atualização: ${e.stack || e.message}`);
    try {
      ps("Get-Process -Name kami,kami-backend -ErrorAction SilentlyContinue | Stop-Process -Force");
    } catch {
      /* nada aberto */
    }
    process.exit(1);
  }
);
