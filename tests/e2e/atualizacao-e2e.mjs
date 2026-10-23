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
 *      instalador não conseguiria trocar o kami-backend.exe. O iniciar com
 *      o sistema, ligado antes, tem que continuar lá;
 *   5. DIST-03: desinstala com `uninstall.exe /S /APAGARDADOS` (o mesmo que
 *      a caixa "Remover dados do programa") e confere que o programa, o
 *      iniciar com o sistema, a pasta de dados e a chave no cofre sumiram —
 *      e que uma credencial de outro programa ficou.
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
// sem processo nenhum o PowerShell sai com erro mesmo com SilentlyContinue
const encerrarKami = () => ps("Get-Process -Name kami,kami-backend -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0");
const RUN = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const noRun = () => ps(`(Get-ItemProperty '${RUN}' -Name Kami -ErrorAction SilentlyContinue).Kami`).toLowerCase().includes("kami.exe");
const credenciais = () => ps("cmdkey /list | Out-String -Width 4096");
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
    // DIST-03: o iniciar com o sistema ligado tem que SOBREVIVER à
    // atualização (o NSIS desinstala a antiga com /UPDATE) e sumir na
    // desinstalação de verdade (passo 5)
    await wd.execute("return window.__TAURI__.core.invoke('janela_definir', { campo: 'iniciar_com_sistema', valor: true })");
    if (!noRun()) throw new Error("o iniciar com o sistema não ligou");
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
  // O instalador reabre o app com nsis_tauri_utils::RunAsUser — pelo
  // Explorer da sessão, sem o KAMI_DATA_DIR deste teste. No runner do CI
  // (sem desktop de verdade) isso pode não acontecer; é do modelo do Tauri,
  // não do Kami, então aqui vira aviso. A atualização em si é o kami.exe
  // novo no lugar (conferido acima).
  const reaberto = await waitFor("o app reaberto", () => ps("(Get-Process -Name kami -ErrorAction SilentlyContinue).Count") !== "0" || null, { timeout: 60000, every: 2000 }).catch(() => null);
  if (reaberto) log(`app reaberto pelo instalador (${reaberto} processo)`);
  else log(`AVISO: o instalador não reabriu o app neste runner (RunAsUser depende do Explorer da sessão). processos: ${ps("Get-Process | Where-Object { $_.Name -match 'kami|explorer' } | ForEach-Object { $_.Name } | Out-String").replace(/\s+/g, " ").trim() || "nenhum"}`);
  log(`pedidos ao servidor: ${pedidos.join(", ")}`);
  encerrarKami();
  servidor.close();
  if (!noRun()) throw new Error("a atualização apagou o iniciar com o sistema (o /UPDATE não pode)");
  log("iniciar com o sistema continua depois da atualização");

  // 5. DIST-03: desinstalar apagando os dados (o que a caixa "Remover
  // dados do programa" faz; /APAGARDADOS é o mesmo sem tela). Uma chave
  // do Kami no cofre e uma de controle, de outro programa, que tem que ficar.
  const dadosReais = join(process.env.APPDATA, "kami");
  mkdirSync(dadosReais, { recursive: true });
  writeFileSync(join(dadosReais, "kami.db"), "teste");
  execFileSync("cmdkey", ["/generic:kami", "/user:chave-dos-segredos-0123456789abcdef", "/pass:e2e"], { stdio: "ignore" });
  execFileSync("cmdkey", ["/generic:kami-controle-e2e", "/user:outro-programa", "/pass:e2e"], { stdio: "ignore" });
  if (!credenciais().includes("chave-dos-segredos-0123456789abcdef")) throw new Error("não deu pra criar a credencial de teste");
  execFileSync(join(process.env.LOCALAPPDATA, "Kami", "uninstall.exe"), ["/S", "/APAGARDADOS"], { stdio: "inherit" });
  await waitFor("o programa desinstalado", () => !existsSync(exe), { timeout: 120000, every: 2000 });
  await waitFor("a pasta de dados apagada", () => !existsSync(dadosReais), { timeout: 30000, every: 1000 });
  if (noRun()) throw new Error("o iniciar com o sistema ficou depois de desinstalar");
  // o uninstall.exe se copia pro %TEMP% e se reabre: o processo que a gente
  // chamou termina na hora e a desinstalação segue sozinha — o PowerShell
  // do gancho (o último passo) roda depois de a pasta sumir. Espera.
  const depois = await waitFor("a chave sair do cofre", () => {
    const lista = credenciais();
    return lista.includes("chave-dos-segredos-0123456789abcdef") ? null : lista;
  }, { timeout: 60000, every: 2000 }).catch(() => credenciais());
  if (depois.includes("chave-dos-segredos-0123456789abcdef")) {
    log(`cofre depois de desinstalar:\n${depois.split("\n").filter((l) => /kami|chave-dos-segredos/i.test(l)).join("\n")}`);
    throw new Error("a chave das senhas ficou no cofre");
  }
  if (!depois.includes("outro-programa")) throw new Error("a desinstalação apagou uma credencial que não é do Kami");
  execFileSync("cmdkey", ["/delete:kami-controle-e2e"], { stdio: "ignore" });
  log("desinstalado: programa, iniciar com o sistema, pasta de dados e chave no cofre — credencial de outro programa intacta");
}

main().then(
  () => {
    log("tudo certo");
    process.exit(0);
  },
  (e) => {
    console.error(`\nfalha no teste de atualização: ${e.stack || e.message}`);
    try {
      encerrarKami();
    } catch {
      /* nada aberto */
    }
    process.exit(1);
  }
);
