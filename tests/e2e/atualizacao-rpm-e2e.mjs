#!/usr/bin/env node
/**
 * Atualização pelo app no .rpm, de ponta a ponta (P-196) — roda no job
 * rpm-update-fedora do smoke-test.yml, num contêiner Fedora, como root.
 *
 * Por que existe: a 1.18 → 2.0.0 falhou no Fedora com "Failed to install
 * package". O rpm 6 (Fedora 44 em diante) recusa pacote sem assinatura GPG
 * (`%_pkgverify_level all`), e o plugin do Tauri rodava `rpm -U` puro. O
 * Windows tinha teste de atualização no CI; o .rpm não tinha.
 *
 * O job do Linux compila dois .rpm (a versão atual e a seguinte) assinados
 * com uma chave DESCARTÁVEL e com http liberado (ci/teste-atualizacao.json).
 * Este teste:
 *   1. obriga o rpm a exigir assinatura (macro em /etc/rpm, vale mesmo se
 *      um dia o Fedora mudar o padrão) e confere que `rpm -U` puro recusa o
 *      pacote novo — o controle negativo: é o que a 2.0.0 fazia;
 *   2. instala a versão atual com dnf (como o install.sh) e serve a seguinte
 *      e um latest.json (scripts/gerar_latest_json.py, o mesmo da release);
 *   3. troca o pkexec por um registrador que roda o comando (aqui já somos
 *      root e não há janela de senha) — o rpm, o pacote e a regra de
 *      assinatura continuam os de verdade;
 *   4. abre o app instalado pelo WebDriver e vai pela tela, como quem usa:
 *      configurações › sobre › procurar agora › atualizar agora › confirmar.
 *      a. com a janela de senha "cancelada" (pkexec sai com 126): a tela
 *         avisa com frase traduzida (não o código nem o erro cru), nada é
 *         instalado, o backend volta numa porta nova, a faixa "o backend
 *         do kami parou" não aparece e a pasta temporária some;
 *      b. de novo, de verdade: o rpm instala a seguinte, o app fecha e
 *         reabre sozinho já na versão nova, com o backend de pé.
 *
 * Variáveis: KAMI_E2E_ATUALIZACAO (pasta com antiga.rpm, nova.rpm,
 * nova.rpm.sig e versoes.json), KAMI_E2E_TAURI_DRIVER, KAMI_E2E_PYTHON,
 * KAMI_E2E_OUT.
 */
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebDriver } from "./webdriver.mjs";

const PASTA = resolve(process.env.KAMI_E2E_ATUALIZACAO || "atualizacao");
const TAURI_DRIVER = process.env.KAMI_E2E_TAURI_DRIVER || "tauri-driver";
const PYTHON = process.env.KAMI_E2E_PYTHON || "python3";
const OUT = resolve(process.env.KAMI_E2E_OUT || "e2e-output");
const DATA_DIR = mkdtempSync(join(tmpdir(), "kami-dados-"));
const SHIM = mkdtempSync(join(tmpdir(), "kami-pkexec-"));
const MACRO = "/etc/rpm/macros.zz-kami-e2e";
const BIN = "/usr/bin/kami";
const { antiga, nova } = JSON.parse(readFileSync(join(PASTA, "versoes.json"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[atualizacao-rpm ${new Date().toISOString().slice(11, 19)}]`, ...a);
const C = { ...process.env, LANG: "C", LC_ALL: "C" };
const versaoInstalada = () => {
  const r = spawnSync("rpm", ["-q", "--qf", "%{VERSION}", "kami"], { encoding: "utf8", env: C });
  return r.status === 0 ? r.stdout.trim() : null;
};
/** pids rodando o binário do Kami (o kami-backend tem outro exe). */
const processosDoKami = () =>
  readdirSync("/proc")
    .filter((p) => /^\d+$/.test(p))
    .filter((p) => {
      try {
        return readlinkSync(`/proc/${p}/exe`) === BIN;
      } catch {
        return false;
      }
    });
const pastasTemporarias = () => readdirSync(tmpdir()).filter((n) => n.startsWith("kami-atualizacao-"));
const porta = () => {
  try {
    return readFileSync(join(DATA_DIR, "backend_port.txt"), "utf8").trim() || null;
  } catch {
    return null;
  }
};
async function saude(p) {
  try {
    const r = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

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
  if (process.platform !== "linux" || process.getuid() !== 0) throw new Error("rode como root num contêiner Fedora (ver o job rpm-update-fedora)");
  mkdirSync(OUT, { recursive: true });
  log(`de ${antiga} para ${nova}; dados: ${DATA_DIR}`);

  // 1. rpm exigindo assinatura + controle negativo
  writeFileSync(MACRO, "%_pkgverify_level all\n");
  log(`rpm ${execFileSync("rpm", ["--version"], { encoding: "utf8" }).trim()} · %_pkgverify_level = ${execFileSync("rpm", ["--eval", "%_pkgverify_level"], { encoding: "utf8" }).trim()}`);
  // 2. versão atual instalada com dnf (o dnf não exige GPG em arquivo
  // local) + servidor local
  if (versaoInstalada() !== antiga) execFileSync("dnf", ["install", "-y", "-q", join(PASTA, "antiga.rpm")], { stdio: "inherit" });
  if (versaoInstalada() !== antiga) throw new Error(`versão instalada ${versaoInstalada()}, esperada ${antiga}`);
  log(`instalado: kami ${antiga}`);
  // controle negativo, já com as dependências no lugar: é o que a 2.0.0 fazia
  const puro = spawnSync("rpm", ["-U", "--test", join(PASTA, "nova.rpm")], { encoding: "utf8", env: C });
  if (puro.status === 0 || !/signature/i.test(puro.stderr + puro.stdout)) {
    throw new Error(`controle negativo: 'rpm -U' puro devia recusar o pacote sem assinatura GPG (saiu ${puro.status}: ${(puro.stderr + puro.stdout).trim()})`);
  }
  log(`controle negativo ok — rpm -U puro: ${(puro.stderr + puro.stdout).trim()}`);

  writeFileSync(
    join(PASTA, "latest.json"),
    execFileSync(PYTHON, [
      "scripts/gerar_latest_json.py", "--versao", nova, "--base-url", "http://127.0.0.1:8791",
      "--rpm", "nova.rpm", join(PASTA, "nova.rpm.sig"),
      "--appimage", "nao-usado.AppImage", join(PASTA, "nova.rpm.sig"),
      "--windows", "nao-usado.exe", join(PASTA, "nova.rpm.sig"),
    ])
  );
  const pedidos = [];
  const servidor = createServer((req, res) => {
    pedidos.push(req.url);
    const arquivo = join(PASTA, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""));
    if (!arquivo.startsWith(PASTA) || !existsSync(arquivo)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Length": statSync(arquivo).size });
    createReadStream(arquivo).pipe(res);
  }).listen(8791, "127.0.0.1");

  // 3. pkexec registrador (só no PATH deste teste)
  const registro = join(SHIM, "chamadas.txt");
  const cancelar = join(SHIM, "cancelar");
  writeFileSync(join(SHIM, "pkexec"), `#!/bin/sh\necho "$*" >> '${registro}'\n[ -f '${cancelar}' ] && exit 126\nexec "$@"\n`);
  chmodSync(join(SHIM, "pkexec"), 0o755);
  const chamadas = () => (existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n") : []);

  // 4. o app instalado, pelo WebDriver
  const env = {
    ...process.env,
    PATH: `${SHIM}:${process.env.PATH}`,
    KAMI_DATA_DIR: DATA_DIR,
    KAMI_ATUALIZACAO_URL: "http://127.0.0.1:8791/latest.json",
  };
  const driver = spawn(TAURI_DRIVER, [], { env, stdio: ["ignore", "inherit", "inherit"] });
  const wd = new WebDriver();
  try {
    await waitFor("o tauri-driver", async () => (await fetch("http://127.0.0.1:4444/status")).ok, { timeout: 20000 });
    await wd.start(BIN);
    const porta1 = await waitFor("o backend", async () => {
      const p = porta();
      return p && (await saude(p)) ? p : null;
    }, { timeout: 120000 });
    const antes = processosDoKami();
    log(`app aberto (pid ${antes.join(",")}), backend na porta ${porta1}`);

    // pela tela, como quem usa: configurações › sobre › procurar agora
    const ui = (js) => wd.execute(js);
    const visivel = (sel) => ui(`const e = document.querySelector(${JSON.stringify(sel)}); return !!(e && !e.hidden && e.offsetParent !== null)`);
    const clicar = async (sel, oque) => {
      await waitFor(oque, () => visivel(sel), { timeout: 15000, every: 300 });
      await ui(`document.querySelector(${JSON.stringify(sel)}).click()`);
    };
    const copias = () => (existsSync(join(DATA_DIR, "backups")) ? readdirSync(join(DATA_DIR, "backups")).filter((n) => n.startsWith("kami-antes-de-atualizar")).length : 0);
    await waitFor("a tela inicial", () => visivel("#btn-open-settings"), { timeout: 60000 });
    await clicar("#btn-open-settings", "o botão de configurações");
    await clicar('.cfg-tab[data-tab="sobre"]', "a aba sobre");
    await clicar("#cfg-atualiza-agora", "procurar agora");
    await waitFor("o botão atualizar agora", () => visivel("#cfg-atualiza-instalar"), { timeout: 30000 });
    log(`sobre: ${(await ui("return document.getElementById('cfg-atualiza-status').textContent")).trim()}`);
    const atualizarAgora = async () => {
      await clicar("#cfg-atualiza-instalar", "atualizar agora");
      await clicar("#cm-confirm-btn", "a confirmação");
    };

    // 4a. a janela de senha fechada
    writeFileSync(cancelar, "");
    await atualizarAgora();
    await waitFor("o aviso de que não atualizou", () => visivel("#error-modal.open #em-message"), { timeout: 120000 });
    const aviso = (await ui("return document.getElementById('em-message').textContent")).trim();
    writeFileSync(join(OUT, "cancelado.png"), await wd.screenshot());
    log(`aviso na tela: "${aviso}"`);
    if (/^rpm:|Failed to install/.test(aviso)) throw new Error(`a tela mostrou o erro cru: ${aviso}`);
    if (versaoInstalada() !== antiga) throw new Error(`cancelado, mas a versão instalada virou ${versaoInstalada()}`);
    const porta2 = await waitFor("o backend de volta depois do cancelamento", async () => {
      const p = porta();
      return p && p !== porta1 && (await saude(p)) ? p : null;
    }, { timeout: 60000 });
    log(`backend de volta na porta ${porta2}`);
    const cmd = chamadas().at(-1) || "";
    if (!/^rpm -U --nosignature \/.+\/kami-atualizacao-\d+\/kami\.rpm$/.test(cmd)) throw new Error(`pkexec chamado com: ${cmd}`);
    if (pastasTemporarias().length) throw new Error(`pasta temporária ficou: ${pastasTemporarias()}`);
    log(`pkexec recebeu: ${cmd}`);
    // o vigia testa a cada 15 s: passa de um ciclo e confere que a faixa
    // "o backend do kami parou" não apareceu (a 2.0.0 deixava ela na tela)
    await sleep(20000);
    if (await visivel("#backend-banner")) {
      writeFileSync(join(OUT, "faixa.png"), await wd.screenshot());
      throw new Error(`a faixa do backend ficou na tela: ${await ui("return document.getElementById('backend-banner').innerText")}`);
    }
    if (copias() < 1) throw new Error("não fez a cópia kami-antes-de-atualizar");
    await clicar('#error-modal.open [data-action="close"].btn', "o ok do aviso");

    // 4b. de verdade, pelo mesmo botão. A cópia de antes de atualizar é um
    // pedido ao backend NOVO: se a tela tivesse ficado na porta velha, não
    // chegaria nem a instalar.
    rmSync(cancelar);
    await atualizarAgora();
    await waitFor(`o rpm na ${nova}`, async () => {
      const erro = await ui("const m = document.querySelector('#error-modal.open #em-message'); return m ? m.textContent : null").catch(() => null);
      if (erro) throw new Error(`a tela avisou: ${erro}`);
      return versaoInstalada() === nova;
    }, { timeout: 240000, every: 2000 }).catch((e) => {
      throw new Error(`${e.message}; chamadas ao pkexec: ${chamadas().join(" | ")}`);
    });
    if (copias() < 2) throw new Error("a segunda tentativa não fez a cópia kami-antes-de-atualizar");
    log(`rpm agora: kami ${versaoInstalada()}`);
    const novos = await waitFor("o app reaberto pelo binário novo", () => {
      const agora = processosDoKami();
      return agora.length && agora.every((p) => !antes.includes(p)) ? agora : null;
    }, { timeout: 60000 });
    const porta3 = await waitFor("o backend do app reaberto", async () => {
      const p = porta();
      return p && p !== porta2 && (await saude(p)) ? p : null;
    }, { timeout: 120000 });
    log(`reabriu sozinho (pid ${novos.join(",")}), backend na porta ${porta3}`);
    if (pastasTemporarias().length) throw new Error(`pasta temporária ficou: ${pastasTemporarias()}`);
    log(`pedidos ao servidor: ${pedidos.join(", ")}`);
  } finally {
    await wd.quit().catch(() => {});
    driver.kill();
    for (const p of processosDoKami()) {
      try {
        process.kill(Number(p));
      } catch {
        /* já saiu */
      }
    }
    servidor.close();
    rmSync(MACRO, { force: true });
  }
}

main().then(
  () => {
    log("tudo certo");
    process.exit(0);
  },
  (e) => {
    console.error(`\nfalha no teste de atualização do .rpm: ${e.stack || e.message}`);
    try {
      writeFileSync(join(OUT, "kami-backend.log"), readFileSync(join(DATA_DIR, "kami-backend.log")));
    } catch {
      /* sem log */
    }
    process.exit(1);
  }
);
