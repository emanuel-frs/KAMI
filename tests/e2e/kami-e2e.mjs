#!/usr/bin/env node
/**
 * Teste ponta a ponta do app Kami compilado (CONF-03, CONF-09) — Linux e Windows.
 *
 * Abre o executável de verdade (Tauri + sidecar), com uma pasta de dados
 * descartável, e confere o que um usuário veria:
 *   1. o app abre e o backend sobe; os dados fictícios do modo demo
 *      (scripts/seed_demo.py) entram pela API, com o token da sessão;
 *   2. passa pelas 9 telas em 3 tamanhos de janela, tira um print de cada
 *      (e da paleta e da captura abertas) e confere que nenhum aviso de
 *      erro (CONF-01) apareceu;
 *   3. registra uma ação pela interface (widget "registrar ação");
 *   4. CONF-09 — os fluxos que chegaram depois da Sprint 2, pela interface
 *      e com teclado de verdade (WebDriver Actions): captura (Alt+Q) e um
 *      lembrete criado por ela que tem que disparar; dicas revistas pela
 *      ajuda (Ctrl+K não abre por baixo, Esc fecha); paleta (Ctrl+K); nota
 *      criada e editada; formato das datas; cópia automática + restaurar;
 *      assistente (IA-02/IA-04, P-121) com um provedor FALSO subido aqui
 *      (nenhuma chave de verdade no CI): passo a passo, pergunta (Alt+A),
 *      resposta, parar, continuar, refazer, histórico e o que foi enviado;
 *   5. derruba o backend e confere que o vigia (CONF-02) o traz de volta
 *      sozinho, sem fechar o app;
 *   6. PIN: liga → fecha e reabre o app → tela de bloqueio (print nos 3
 *      tamanhos) → digita o PIN → tranca e destranca uma nota → desliga;
 *   7. bandeja (fechar só esconde; abrir de novo traz a janela de volta,
 *      sem segunda instância) e iniciar com o sistema (entrada criada e
 *      removida — registro no Windows, .desktop no Linux);
 *   8. por último, DIST-03: "remover tudo do Kami deste computador" pela
 *      tela, com autostart e ícone da cor ligados — a pasta de dados, o
 *      autostart, o lançador e (Windows) a chave no cofre têm que sumir;
 *   9. no fim, o kami-backend.log não pode ter erro da tela
 *      ([app.frontend]) nem erro inesperado do backend ([app.erros]).
 *
 * Os prints e o log vão pra KAMI_E2E_OUT — no CI viram artefato do
 * workflow, que é como dá pra ver o layout no Windows sem ter Windows.
 *
 * Rodando na máquina de alguém (Linux), nada do Kami de verdade é tocado:
 * o app do teste roda com HOME/XDG_* descartáveis (autostart, lançador
 * com o ícone da cor) e KAMI_COFRE=desligado (a chave das senhas não vai
 * pro cofre da pessoa); e a instância única do app passa a ser por pasta
 * de dados (janela.rs), então um Kami aberto na bandeja não recebe o app
 * do teste no lugar dele.
 *
 * Variáveis de ambiente:
 *   KAMI_E2E_APP            executável do app (obrigatório)
 *   KAMI_E2E_TAURI_DRIVER   tauri-driver (padrão: "tauri-driver" no PATH)
 *   KAMI_E2E_NATIVE_DRIVER  driver nativo (Windows: msedgedriver.exe); opcional
 *   KAMI_E2E_PYTHON         python pra rodar o seed (padrão: python3 / python no Windows)
 *   KAMI_E2E_OUT            pasta dos prints e do log (padrão: ./e2e-output)
 *   KAMI_E2E_RAPIDO         "1": um tamanho de janela só (pra iterar no teste)
 *
 * Uso local (Linux; sem janela na tela, com o mutter headless do GNOME):
 *   mutter --headless --wayland --no-x11 --wayland-display=kami-e2e --virtual-monitor 2000x1200 &
 *   WAYLAND_DISPLAY=kami-e2e KAMI_E2E_APP=src-tauri/target/debug/kami node tests/e2e/kami-e2e.mjs
 */
import { spawn, execSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebDriver } from "./webdriver.mjs";

const IS_WINDOWS = process.platform === "win32";
const APP = process.env.KAMI_E2E_APP && resolve(process.env.KAMI_E2E_APP);
const TAURI_DRIVER = process.env.KAMI_E2E_TAURI_DRIVER || "tauri-driver";
const NATIVE_DRIVER = process.env.KAMI_E2E_NATIVE_DRIVER || "";
const PYTHON = process.env.KAMI_E2E_PYTHON || (IS_WINDOWS ? "python" : "python3");
const OUT = resolve(process.env.KAMI_E2E_OUT || "e2e-output");
const RAPIDO = process.env.KAMI_E2E_RAPIDO === "1";
const DATA_DIR = mkdtempSync(join(tmpdir(), "kami-e2e-"));
// Linux: casa descartável do app do teste (ver o topo)
const HOME_E2E = IS_WINDOWS ? null : mkdtempSync(join(tmpdir(), "kami-e2e-home-"));
const APP_ENV = {
  ...process.env,
  KAMI_DATA_DIR: DATA_DIR,
  // DIST-01: o aviso de versão nova consultaria o GitHub 1 min depois de
  // abrir — aqui vai pra um endereço local fechado e falha calado
  KAMI_ATUALIZACAO_URL: "https://127.0.0.1:9/latest.json",
  ...(HOME_E2E && {
    HOME: HOME_E2E,
    XDG_CONFIG_HOME: join(HOME_E2E, ".config"),
    XDG_DATA_HOME: join(HOME_E2E, ".local", "share"),
    XDG_CACHE_HOME: join(HOME_E2E, ".cache"),
    KAMI_COFRE: "desligado",
  }),
};

const PAGES = ["nucleo", "perfil", "financas", "carreira", "aprendizado", "organizacao", "metas", "calendario", "habitos"];
const SIZES = RAPIDO
  ? [[1280, 800]]
  : [
      [960, 600],
      [1280, 800],
      [1920, 1080],
    ];
const PIN = "2468";

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

/** Uma etapa do CONF-09: falhou → registra e segue pras outras. */
async function etapa(nome, fn) {
  try {
    await fn();
    log(`✓ ${nome}`);
  } catch (e) {
    fail(`${nome}: ${e.message.split("\n")[0]}`);
  }
}

function killBackend() {
  // no CI só existe o nosso sidecar
  if (IS_WINDOWS) {
    execSync("taskkill /F /T /IM kami-backend.exe", { stdio: "ignore" });
    return;
  }
  // Linux: só o backend DESTE teste (pela pasta de dados) — rodando na
  // máquina de alguém, um Kami de verdade aberto não pode cair junto
  const pids = execSync("pgrep -x kami-backend || true", { encoding: "utf8" }).split(/\s+/).filter(Boolean);
  for (const pid of pids) {
    let env = "";
    try {
      env = readFileSync(`/proc/${pid}/environ`, "utf8");
    } catch {
      continue;
    }
    if (env.split("\0").includes(`KAMI_DATA_DIR=${DATA_DIR}`)) execSync(`kill -9 ${pid}`, { stdio: "ignore" });
  }
}

/**
 * Provedor de IA falso (P-121): compatível com OpenAI, em 127.0.0.1 numa
 * porta livre. Pergunta com "devagar" recebe uma resposta longa, em
 * pedaços lentos (dá tempo de apertar "parar"); o resto, uma curta.
 */
function provedorFalso() {
  const pedidos = [];
  const sse = (res, pedacos, atraso) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    let i = 0;
    const manda = () => {
      if (res.destroyed) return;
      if (i < pedacos.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: pedacos[i++] }, finish_reason: null }] })}\n\n`);
        setTimeout(manda, atraso);
        return;
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: pedacos.length } })}\n\n`);
      res.end("data: [DONE]\n\n");
    };
    manda();
  };
  const srv = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      const json = corpo ? JSON.parse(corpo) : null;
      pedidos.push({ caminho: req.url, json });
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "falso-e2e" }] }));
      } else if (req.url.endsWith("/chat/completions")) {
        const ultima = json?.messages?.filter((m) => m.role === "user").at(-1)?.content || "";
        if (/devagar/.test(ultima)) sse(res, Array.from({ length: 120 }, (_, k) => `parte${k} `), 60);
        else sse(res, ["resposta do ", "**provedor falso**", " do e2e."], 20);
      } else {
        res.writeHead(404).end();
      }
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ srv, pedidos, url: `http://127.0.0.1:${srv.address().port}/v1` })));
}

// sem passar pelo cmd (execFileSync com argumentos): nada de aspas escapadas
const ps = (script) => execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();

async function main() {
  if (!APP || !existsSync(APP)) throw new Error(`KAMI_E2E_APP não aponta pra um executável: ${APP}`);
  mkdirSync(OUT, { recursive: true });
  rmSync(join(OUT, "kami-backend.log"), { force: true }); // o de uma rodada anterior
  log(`app: ${APP}`);
  log(`dados: ${DATA_DIR}`);

  const driverArgs = NATIVE_DRIVER ? ["--native-driver", NATIVE_DRIVER] : [];
  const driver = spawn(TAURI_DRIVER, driverArgs, { env: APP_ENV, stdio: ["ignore", "inherit", "inherit"] });
  const wd = new WebDriver();
  const portFile = join(DATA_DIR, "backend_port.txt");
  // porta e token mudam quando o app reabre (PIN) — por isso num objeto
  const conn = { port: null, token: null };
  const lerConexao = async () => {
    await waitFor("o backend publicar a porta", () => existsSync(portFile), { timeout: 120000 });
    conn.port = readFileSync(portFile, "utf8").trim();
    conn.token = readFileSync(join(DATA_DIR, "backend_token.txt"), "utf8").trim();
  };
  const abrirApp = async () => {
    // uma segunda chance: no Windows, a primeira sessão pode falhar com
    // "session not created" se um processo do WebView2 ainda estiver saindo
    try {
      await wd.start(APP);
    } catch (e) {
      if (!/session not created/i.test(e.message)) throw e;
      log(`primeira tentativa de abrir o app falhou (${e.message.split("\n")[0]}); tentando de novo`);
      await sleep(5000);
      await wd.start(APP);
    }
  };
  const api = async (path, init = {}) => {
    const r = await fetch(`http://127.0.0.1:${conn.port}${path}`, {
      ...init,
      headers: { "X-Kami-Token": conn.token, "Content-Type": "application/json" },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const irPara = async (page) => {
    await wd.execute(`document.querySelector('.nav-link[data-page="${page}"]').click()`);
    await sleep(2000);
  };
  const tirarAvisos = () => wd.execute("document.querySelectorAll('.toast-item:not(.toast-erro), #backup-reminder-toast').forEach((t) => t.remove())");
  const visivel = (sel) => wd.execute(`const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getClientRects().length > 0`);
  const clicar = (sel) => wd.execute(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.click()`);
  const focar = (sel) => wd.execute(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("não achei ${sel.replace(/"/g, "'")}"); e.focus()`);
  const print = async (nome) => writeFileSync(join(OUT, `${nome}.png`), await wd.screenshot());
  // o demo marca todas as dicas como vistas; se alguma aparecer mesmo
  // assim (dica nova que o seed não cobre), "pular tudo" pra não cobrir o
  // print — e avisa, porque o modo demo deveria abrir limpo
  const pularDicas = async () => {
    const apareceu = await waitFor("a sequência de dicas", () => visivel(".tip-seq-root"), { timeout: 1500, every: 250 }).catch(() => false);
    if (!apareceu) return;
    log(`  (dica apareceu em ${await wd.execute("return document.querySelector('.nav-link.active')?.dataset.page")} — o seed não marcou)`);
    await clicar(".tip-seq-root .tip-skip");
    await waitFor("as dicas fecharem", async () => !(await visivel(".tip-seq-root")), { timeout: 5000 });
  };
  const errosNaTela = () => wd.execute("return [...document.querySelectorAll('.toast-erro')].map((t) => t.innerText.replace(/\\s+/g, ' '))");

  try {
    await waitFor("o tauri-driver", async () => (await fetch("http://127.0.0.1:4444/status")).ok, { timeout: 20000 });
    await abrirApp();
    log("app aberto");

    // 1. backend de pé + dados fictícios
    await lerConexao();
    // --token=… junto: o token é base64 de URL e às vezes começa com "-",
    // que o argparse leria como outra opção ("expected one argument")
    execSync(`${PYTHON} scripts/seed_demo.py --base-url http://127.0.0.1:${conn.port} --token=${conn.token}`, { stdio: "inherit" });
    // I18N-01/06: instalação nova segue o idioma e o país do sistema, e os
    // runners do CI são en-US — o teste confere textos em português
    // ("hábitos", "PIN errado"…), então fixa português, real e Brasil
    const perfil = await api("/api/perfil", { method: "PUT", body: JSON.stringify({ idioma: "pt", moeda: "BRL", pais: "BR" }) });
    if (perfil.body?.idioma !== "pt") fail(`não deu pra fixar o português: ${JSON.stringify(perfil)}`);
    await wd.refresh();
    await waitFor("os widgets do núcleo", () => wd.execute("return document.querySelectorAll('.card').length > 0"), { timeout: 60000 });
    await waitFor("a animação de abertura acabar", async () => !(await wd.execute("return !!document.querySelector('.boot-splash')")), { timeout: 15000 });
    // avisos que não são erro (ex.: lembrete de backup) atrapalham o print
    await wd.execute("document.querySelectorAll('.toast-item').forEach((t) => t.remove())");
    log("dados fictícios carregados");

    // 1b. SEG-01: a chave das senhas salvas — no Windows tem que ir pro
    // Gerenciador de Credenciais; no Linux fica no arquivo (no CI não há
    // Secret Service, e fora dele o teste desliga o cofre de propósito).
    // E uma senha salva tem que voltar decifrada: o sync de um IMAP
    // inexistente falha na CONEXÃO, não na leitura da senha.
    const chave = (await api("/api/seguranca/chave")).body;
    log(`chave das senhas: ${chave.local}${chave.cofre ? ` (${chave.cofre})` : ""}${chave.motivo ? ` — ${chave.motivo}` : ""}`);
    if (IS_WINDOWS && chave.local !== "cofre") fail(`no Windows a chave deveria estar no cofre: ${JSON.stringify(chave)}`);
    const conta = await api("/api/organizacao/email-accounts", {
      method: "POST",
      body: JSON.stringify({ label: "e2e", imap_host: "127.0.0.1", imap_port: 1, username: "e2e@exemplo.invalid", app_password: "senha-e2e" }),
    });
    const sync = await api(`/api/organizacao/email-accounts/${conta.body?.id}/sync`, { method: "POST" });
    if (!/conectar/.test(sync.body?.detail || "")) fail(`senha salva não voltou decifrada: ${sync.status} ${JSON.stringify(sync.body)}`);
    else log("senha salva e lida de volta pela chave");
    await api(`/api/organizacao/email-accounts/${conta.body?.id}`, { method: "DELETE" });

    // 1c. ICO-01: ícone na cor de destaque. No Windows confere de verdade o
    // atalho do Menu Iniciar (cria um Kami.lnk de teste, que o comando tem
    // que apontar pro .ico da cor e depois de volta pro executável).
    const LNK = "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Kami.lnk";
    if (IS_WINDOWS) {
      ps(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut("${LNK}"); $s.TargetPath="${APP}"; $s.Save()`);
    }
    const onde = await wd.execute("return window.__TAURI__.core.invoke('aplicar_icone_tema', { cor: 'coral' })");
    log(`ícone coral aplicado em: ${JSON.stringify(onde)}`);
    if (!Array.isArray(onde) || !onde.includes("janela")) fail(`ícone na cor de destaque: ${JSON.stringify(onde)}`);
    if (IS_WINDOWS) {
      const icone = ps(`(New-Object -ComObject WScript.Shell).CreateShortcut("${LNK}").IconLocation`);
      if (!/kami-coral\.ico,0$/i.test(icone)) fail(`atalho do Menu Iniciar não apontou pro ícone coral: ${icone}`);
      else log("atalho do Menu Iniciar na cor coral");
    }
    await wd.execute("return window.__TAURI__.core.invoke('aplicar_icone_tema', { cor: null })");
    if (IS_WINDOWS) {
      const icone = ps(`(New-Object -ComObject WScript.Shell).CreateShortcut("${LNK}").IconLocation`);
      if (!/kami\.exe,0$/i.test(icone)) fail(`desligar não devolveu o ícone do executável ao atalho: ${icone}`);
      else log("desligar devolveu o ícone padrão ao atalho");
      ps(`Remove-Item "${LNK}" -ErrorAction SilentlyContinue`);
    }

    // 2. telas × tamanhos (+ paleta e captura abertas, CONF-09)
    for (const [w, h] of SIZES) {
      const resized = await wd.setWindowSize(w, h);
      if (!resized) log(`  (o driver não mudou a janela pra ${w}×${h}; print no tamanho atual)`);
      await sleep(600);
      for (const page of PAGES) {
        await irPara(page);
        await pularDicas();
        const errors = await errosNaTela();
        if (errors.length) fail(`tela ${page} (${w}×${h}): aviso de erro: ${errors.join(" | ")}`);
        // avisos comuns (lembrete de backup, sequência...) cobrem o layout no print
        await tirarAvisos();
        await print(`${w}x${h}-${page}`);
      }
      await etapa(`paleta e captura abertas em ${w}×${h}`, async () => {
        await wd.keys("Control+k");
        await waitFor("a paleta abrir", () => visivel("#paleta"), { timeout: 5000 });
        await wd.keys("meta", { texto: true });
        await sleep(1200);
        await print(`${w}x${h}-paleta`);
        await wd.keys("Escape");
        await waitFor("a paleta fechar", async () => !(await visivel("#paleta")), { timeout: 5000 });
        await wd.keys("Alt+q");
        await waitFor("a captura abrir", () => visivel("#captura"), { timeout: 5000 });
        await wd.keys("$ 25 almoço", { texto: true });
        await sleep(400);
        await print(`${w}x${h}-captura`);
        await wd.keys("Escape");
        await waitFor("a captura fechar", async () => !(await visivel("#captura")), { timeout: 5000 });
      });
      log(`  ${w}×${h}: ${PAGES.length} telas`);
    }
    await wd.setWindowSize(1280, 800);

    // 3. uma ação pela interface
    await irPara("nucleo");
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

    // 4. CONF-09: fluxos novos
    // todo aviso que aparecer daqui em diante fica guardado (o do lembrete
    // pode chegar no meio de outra etapa)
    await wd.execute(`
      window.__e2eAvisos = [];
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList.contains('toast-item')) window.__e2eAvisos.push(n.innerText.replace(/\\s+/g, ' '));
      }))).observe(document.body, { childList: true, subtree: true });
    `);

    let lembrete = null;
    await etapa("captura rápida (Alt+Q) vai pra caixa de entrada", async () => {
      await wd.keys("Alt+q");
      await waitFor("a captura abrir", () => visivel("#captura"), { timeout: 5000 });
      await wd.keys("ideia guardada pelo e2e", { texto: true });
      await wd.keys("Enter");
      await waitFor("o item na caixa de entrada", async () =>
        (await api("/api/organizacao/entrada")).body?.some((i) => i.texto === "ideia guardada pelo e2e"), { timeout: 10000 });
    });
    await etapa("lembrete criado pela captura (@ hora)", async () => {
      // daqui a 2 minutos: dá tempo de salvar antes do minuto chegar
      const quando = new Date(Date.now() + 2 * 60000);
      if (quando.getDate() !== new Date().getDate()) throw new Error("perto da meia-noite — o lembrete cairia amanhã; rode de novo");
      const hhmm = `${String(quando.getHours()).padStart(2, "0")}:${String(quando.getMinutes()).padStart(2, "0")}`;
      await wd.keys("Alt+q");
      await waitFor("a captura abrir", () => visivel("#captura"), { timeout: 5000 });
      await wd.keys(`@ ${hhmm} lembrete do e2e`, { texto: true });
      await wd.keys("Enter");
      await waitFor("o formulário do lembrete", () => visivel("#lembrete-modal"), { timeout: 10000 });
      const preenchido = await wd.execute("return [document.getElementById('lbm-titulo').value, document.getElementById('lbm-hora').value]");
      if (preenchido[1] !== hhmm) throw new Error(`formulário veio com ${JSON.stringify(preenchido)}, esperado ${hhmm}`);
      await clicar('#lembrete-modal [data-action="save"]');
      lembrete = await waitFor("o lembrete salvo", async () =>
        (await api("/api/lembretes")).body?.find((l) => /lembrete do e2e/.test(l.titulo)), { timeout: 10000 });
    });

    await etapa("dicas: rever pela ajuda; Ctrl+K não abre por baixo e Esc fecha", async () => {
      // a dica fica por cima da paleta e o Esc é dela (achado no CONF-09)
      await irPara("habitos");
      await clicar("#btn-open-help");
      await waitFor("o menu de ajuda", () => visivel('#help-menu-pop [data-action="screen-tips"]'), { timeout: 5000 });
      await clicar('#help-menu-pop [data-action="screen-tips"]');
      await waitFor("a sequência de dicas", () => visivel(".tip-seq-root"), { timeout: 5000 });
      await print("dicas-habitos");
      await wd.keys("Control+k");
      await sleep(400);
      if (await visivel("#paleta")) {
        await wd.execute("document.getElementById('paleta').hidden = true");
        throw new Error("Ctrl+K abriu a paleta por baixo da sequência de dicas");
      }
      await wd.keys("Escape");
      await waitFor("as dicas fecharem com Esc", async () => !(await visivel(".tip-seq-root")), { timeout: 5000 });
    });

    await etapa("paleta (Ctrl+K) leva pra tela escolhida", async () => {
      await irPara("nucleo");
      await wd.keys("Control+k");
      await waitFor("a paleta abrir", () => visivel("#paleta"), { timeout: 5000 });
      await wd.keys("habitos", { texto: true });
      await waitFor("a tela hábitos nos resultados", () =>
        wd.execute("return /hábitos/.test(document.getElementById('paleta-lista').innerText)"), { timeout: 8000 });
      await wd.keys("Enter");
      await waitFor("a tela hábitos aberta", () =>
        wd.execute("return document.querySelector('.nav-link.active')?.dataset.page === 'habitos'"), { timeout: 8000 });
    });

    let notaId = null;
    await etapa("nota criada e editada", async () => {
      await irPara("organizacao");
      await clicar('.tab[data-tab="notas"]');
      await waitFor("a lista de notas", () => visivel('[data-nt="nova"]'), { timeout: 8000 });
      await clicar('[data-nt="nova"]');
      await waitFor("o editor", () => visivel("#nota-titulo"), { timeout: 5000 });
      await focar("#nota-titulo");
      await wd.keys("nota do e2e", { texto: true });
      await focar("#nota-corpo .ne-area");
      await wd.keys("primeira linha", { texto: true });
      const salva = async (texto) => {
        const notas = (await api("/api/organizacao/notas")).body || [];
        const n = notas.find((x) => x.titulo === "nota do e2e");
        if (!n) return false;
        const cheia = (await api(`/api/organizacao/notas/${n.id}`)).body;
        return cheia?.conteudo?.includes(texto) ? n.id : false;
      };
      notaId = await waitFor("a nota salva sozinha", () => salva("primeira linha"), { timeout: 15000 });
      await wd.keys(" e uma edição", { texto: true });
      await waitFor("a edição salva", () => salva("primeira linha e uma edição"), { timeout: 15000 });
      await print("nota-editada");
    });

    await etapa("formato das datas troca na tela", async () => {
      // os lançamentos do demo mostram datas; troca pra ISO pela interface
      await irPara("financas");
      const iso = /\b20\d\d-\d\d-\d\d\b/;
      if (iso.test(await wd.execute("return document.getElementById('page-root').innerText"))) {
        throw new Error("a tela já mostrava data em ISO antes da troca");
      }
      await clicar("#btn-open-settings");
      await waitFor("configurações", () => visivel('.cfg-tab[data-tab="aparencia"]'), { timeout: 5000 });
      await clicar('.cfg-tab[data-tab="aparencia"]');
      await clicar('input[name="cfg-formato-data"][value="iso"]');
      await waitFor("o formato salvo", async () => (await api("/api/perfil")).body?.formato_data === "iso", { timeout: 5000 });
      await wd.keys("Escape");
      await waitFor("datas em ISO na tela de finanças", async () =>
        iso.test(await wd.execute("return document.getElementById('page-root').innerText")), { timeout: 8000 });
      await print("datas-iso");
      await api("/api/perfil", { method: "PUT", body: JSON.stringify({ formato_data: "sistema" }) });
    });

    await etapa("configurações › sobre mostra as atualizações (DIST-01)", async () => {
      await clicar("#btn-open-settings");
      await waitFor("configurações", () => visivel('.cfg-tab[data-tab="sobre"]'), { timeout: 5000 });
      await clicar('.cfg-tab[data-tab="sobre"]');
      await waitFor("a seção de atualizações", () => visivel("#cfg-atualiza"), { timeout: 5000 });
      if (!(await wd.execute("return document.getElementById('cfg-atualiza-procurar').checked"))) throw new Error("\"procurar atualizações\" deveria começar ligado (P-88)");
      await print("configuracoes-sobre");
      await wd.keys("Escape");
    });

    await etapa("lembrete dispara na hora (aviso dentro do app)", async () => {
      if (!lembrete) throw new Error("o lembrete não foi criado (ver a etapa da captura)");
      // o agendador pergunta a cada 30 s; o lembrete vence em até 2 min
      await waitFor("o aviso do lembrete", () =>
        wd.execute("return (window.__e2eAvisos || []).some((t) => /lembrete do e2e/.test(t))"), { timeout: 180000, every: 2000 });
    });

    await etapa("cópia automática: copiar agora e restaurar", async () => {
      const antes = (await api("/api/backups")).body;
      if (!antes?.copias?.some((c) => /semanal/.test(c.nome))) throw new Error(`sem a cópia semanal da abertura: ${JSON.stringify(antes)}`);
      await clicar("#btn-open-settings");
      await waitFor("configurações", () => visivel('.cfg-tab[data-tab="backup"]'), { timeout: 5000 });
      await clicar('.cfg-tab[data-tab="backup"]');
      await waitFor("a seção das cópias", () => visivel("#cfg-copias-agora"), { timeout: 5000 });
      await clicar("#cfg-copias-agora");
      const nova = await waitFor("a cópia nova na lista", async () => {
        const c = (await api("/api/backups")).body?.copias || [];
        return c.find((x) => !antes.copias.some((y) => y.nome === x.nome));
      }, { timeout: 15000 });
      if (!existsSync(join(DATA_DIR, "backups", nova.nome))) throw new Error(`a cópia ${nova.nome} não está em backups/`);
      await print("copias-automaticas");
      // algo feito DEPOIS da cópia tem que sumir ao restaurar
      await api("/api/organizacao/entrada", { method: "POST", body: JSON.stringify({ texto: "depois da cópia" }) });
      await waitFor("o botão restaurar da cópia nova", () => visivel(`[data-restaurar="${nova.nome}"]`), { timeout: 8000 });
      // restaurar recarrega a página: a marca some quando a página nova
      // assume (sem esperar isso, a etapa seguinte derrubava o backend com
      // a página antiga na tela e o aviso "de volta" sumia no reload —
      // falhou assim no CI da 1.14)
      await wd.execute("window.__antesDeRestaurar = true");
      await clicar(`[data-restaurar="${nova.nome}"]`);
      await waitFor("a confirmação", () => visivel("#cm-confirm-btn"), { timeout: 5000 });
      await clicar("#cm-confirm-btn");
      await waitFor("a página recarregada", async () => !(await wd.execute("return !!window.__antesDeRestaurar").catch(() => true)), { timeout: 30000 });
      await waitFor("o app de volta depois de restaurar", async () => {
        const itens = (await api("/api/organizacao/entrada")).body;
        return Array.isArray(itens) && !itens.some((i) => i.texto === "depois da cópia") && itens.some((i) => i.texto === "ideia guardada pelo e2e");
      }, { timeout: 30000 });
      await waitFor("as telas carregadas de novo", () => wd.execute("return document.querySelectorAll('.card').length > 0"), { timeout: 30000 });
    });

    await etapa("assistente: passo a passo, pergunta, parar, continuar, refazer, histórico e enviados (IA-02/IA-04)", async () => {
      const falso = await provedorFalso();
      const ultimaResposta = () => wd.execute("return document.querySelector('.ia-msg--kami:last-child .ia-msg-texto')?.innerText || ''");
      const respondeu = (o_que) => waitFor(o_que, () => wd.execute("return document.querySelector('#ia-form')?.getAttribute('aria-busy') === 'false'"), { timeout: 30000, every: 300 });
      const perguntar = async (texto) => {
        await focar("#ia-texto");
        await wd.keys(texto, { texto: true });
        await wd.keys("Enter");
        await sleep(300);
      };
      try {
        // sem provedor: o painel oferece o passo a passo, que abre em configurações
        await wd.keys("Alt+a");
        await waitFor("o painel do assistente", () => visivel("#ia-painel"), { timeout: 5000 });
        await waitFor("o botão do passo a passo", () => visivel('[data-ia="guia"]'), { timeout: 5000 });
        await clicar('[data-ia="guia"]');
        await waitFor("o passo a passo aberto", () => visivel('[data-guia="caminho"][data-valor="local"]'), { timeout: 8000 });
        await clicar('[data-guia="caminho"][data-valor="local"]');
        await clicar('[data-guia="provedor"][data-valor="ollama"]');
        await print("assistente-passo-a-passo");
        await clicar('[data-guia="usar"]');
        await waitFor("o formulário no Ollama", () => wd.execute("return document.querySelector('#cfg-ia-catalogo')?.value === 'ollama'"), { timeout: 5000 });
        await wd.keys("Escape");
        await waitFor("configurações fechar", async () => !(await visivel("#settings-modal.open")), { timeout: 5000 }).catch(() => {});
        // o provedor falso entra pela API (o formulário já tem teste próprio)
        const p = await api("/api/assistente/provedores", { method: "POST", body: JSON.stringify({ catalogo: "ollama", url_base: falso.url, modelo: "falso-e2e" }) });
        if (p.status !== 201 && p.status !== 200) throw new Error(`cadastrar o provedor falso: ${p.status} ${JSON.stringify(p.body)}`);
        const cfg = await api("/api/assistente/config", { method: "PUT", body: JSON.stringify({ ativo: true }) });
        if (!cfg.body?.pronto) throw new Error(`assistente não ficou pronto: ${JSON.stringify(cfg.body)}`);
        await wd.refresh();
        await waitFor("as telas de novo", () => wd.execute("return document.querySelectorAll('.card').length > 0"), { timeout: 30000 });
        await tirarAvisos();

        await wd.keys("Alt+a");
        await waitFor("o painel pronto", () => visivel("#ia-texto"), { timeout: 8000 });
        await perguntar("oi do e2e");
        await respondeu("a resposta");
        if (!/provedor falso/.test(await ultimaResposta())) throw new Error(`resposta inesperada: ${await ultimaResposta()}`);
        await print("assistente-resposta");

        await perguntar("responde devagar");
        await waitFor("a resposta começar a chegar", async () => /parte3/.test(await ultimaResposta()), { timeout: 15000, every: 200 });
        await clicar("#ia-enviar"); // parar
        await respondeu("parar");
        if (!(await visivel(".ia-msg--kami:last-child .ia-interrompida"))) throw new Error("a resposta parada não ficou marcada como interrompida");
        const cortada = (await ultimaResposta()).length;
        await clicar('.ia-msg--kami:last-child [data-ia="continuar"]');
        await sleep(300);
        await respondeu("o continuar"); // o texto novo vem emendado na MESMA resposta
        const emendada = await ultimaResposta();
        if (!(emendada.length > cortada && /^parte0 /.test(emendada))) throw new Error(`continuar não emendou: ${cortada} → ${emendada.length}`);

        await clicar('.ia-msg--kami:last-child [data-ia="refazer"]');
        await respondeu("o refazer");
        const msgs = await wd.execute("return [document.querySelectorAll('.ia-msg--usuario').length, document.querySelectorAll('.ia-msg--kami').length]");
        if (msgs[0] !== 2 || msgs[1] !== 2) throw new Error(`refazer mexeu nas perguntas: ${JSON.stringify(msgs)}`);
        if (/interrompida/.test(await wd.execute("return document.querySelector('.ia-msg--kami:last-child').innerText"))) throw new Error("a resposta refeita ainda está marcada como interrompida");

        await clicar('[data-ia="historico"]');
        await waitFor("o histórico", () => visivel('.ia-item[data-ia="abrir"]'), { timeout: 5000 });
        await clicar('.ia-item[data-ia="abrir"]');
        await waitFor("a conversa reaberta", async () => (await wd.execute("return document.querySelectorAll('.ia-msg--usuario').length")) === 2, { timeout: 5000 });

        await clicar('[data-ia="envios"]');
        await waitFor("o que foi enviado", () => visivel(".ia-envios"), { timeout: 5000 });
        const enviados = await wd.execute("return document.querySelectorAll('.ia-envios > li').length");
        // oi + devagar + continuar (+ o que mais o parar deixou contar) + refazer
        if (enviados < 4) throw new Error(`só ${enviados} envios no registro`);
        if (falso.pedidos.filter((r) => r.caminho.endsWith("/chat/completions")).length < 4) throw new Error("o provedor falso recebeu menos chamadas que o esperado");
        await print("assistente-enviados");
        await wd.keys("Escape");
        await wd.keys("Escape");
      } finally {
        // desliga e tira o provedor: as etapas seguintes (PIN, remover tudo) não dependem dele
        const lista = (await api("/api/assistente/provedores")).body || [];
        for (const p of lista) await api(`/api/assistente/provedores/${p.id}`, { method: "DELETE" });
        await wd.execute("document.querySelector('#ia-painel')?.setAttribute('hidden', '')").catch(() => {});
        falso.srv.close();
      }
    });

    // 5. derruba o backend → o vigia traz de volta
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
    await print("depois-do-reinicio");
    await lerConexao(); // o vigia sobe o backend numa porta nova

    // 6. PIN: ligar → reabrir → desbloquear → trancar nota → desligar
    await etapa("PIN: reabrir o app pede o PIN e o PIN certo desbloqueia", async () => {
      const r = await api("/api/seguranca/pin", { method: "POST", body: JSON.stringify({ pin: PIN }) });
      if (r.status !== 201) throw new Error(`ligar o PIN: ${r.status} ${JSON.stringify(r.body)}`);
      await wd.quit();
      rmSync(portFile, { force: true });
      await sleep(2000);
      await abrirApp();
      await lerConexao();
      await waitFor("a tela de bloqueio", () => visivel("#lock-pin"), { timeout: 60000 });
      for (const [w, h] of SIZES) {
        await wd.setWindowSize(w, h);
        await sleep(600);
        await print(`${w}x${h}-pin`);
      }
      await wd.setWindowSize(1280, 800);
      await focar("#lock-pin");
      await wd.keys("1111", { texto: true });
      await wd.keys("Enter");
      // pela classe, não pelo texto: a tela de PIN vem antes do perfil e,
      // sem o idioma guardado no navegador (o msedgedriver abre o WebView2
      // com perfil novo a cada sessão), sai no idioma do sistema (en-US)
      await waitFor("o aviso de PIN errado", () => wd.execute("const m = document.querySelector('.lock-msg.lock-msg--erro'); return !!m && m.textContent.trim().length > 0"), { timeout: 8000 });
      await focar("#lock-pin");
      await wd.execute("document.getElementById('lock-pin').value = ''");
      await wd.keys(PIN, { texto: true });
      await wd.keys("Enter");
      await waitFor("o app desbloqueado", async () => !(await visivel("#lock-pin")) && (await wd.execute("return document.querySelectorAll('.card').length > 0")), { timeout: 30000 });
    });

    await etapa("nota trancada e destrancada com o PIN", async () => {
      if (!notaId) throw new Error("a nota não foi criada (ver a etapa da nota)");
      await irPara("organizacao");
      await clicar('.tab[data-tab="notas"]');
      await waitFor("a nota na lista", () => visivel(`[data-nt-abrir="${notaId}"]`), { timeout: 8000 });
      await clicar(`[data-nt-abrir="${notaId}"]`);
      await waitFor("a nota aberta", () => visivel('[data-nt="trancar"]'), { timeout: 5000 });
      const rotuloTrancar = await wd.execute(`return document.querySelector('[data-nt="trancar"]').getAttribute('aria-label')`);
      await clicar('[data-nt="trancar"]');
      await waitFor("a confirmação", () => visivel("#cm-confirm-btn"), { timeout: 5000 });
      await clicar("#cm-confirm-btn");
      await waitFor("a nota trancada", async () => (await api(`/api/organizacao/notas/${notaId}`)).body?.trancada === true, { timeout: 8000 });
      const fechada = (await api(`/api/organizacao/notas/${notaId}`)).body;
      if (fechada.conteudo?.includes("primeira linha")) throw new Error("a nota trancada ainda devolve o texto");
      // o rótulo vira "destrancar" (comparado com o de antes: vale em qualquer idioma)
      await waitFor("o botão destrancar", () =>
        wd.execute(`const r = document.querySelector('[data-nt="trancar"]')?.getAttribute('aria-label'); return !!r && r !== ${JSON.stringify(rotuloTrancar)}`), { timeout: 8000 });
      await print("nota-trancada");
      await clicar('[data-nt="trancar"]');
      await waitFor("o pedido do PIN", () => visivel("#pm-input"), { timeout: 5000 });
      await focar("#pm-input");
      await wd.keys(PIN, { texto: true });
      await clicar('#prompt-modal [data-action="confirm"]');
      await waitFor("a nota destrancada", async () => {
        const n = (await api(`/api/organizacao/notas/${notaId}`)).body;
        return n?.trancada === false && n.conteudo?.includes("primeira linha e uma edição");
      }, { timeout: 8000 });
    });

    await etapa("PIN desligado", async () => {
      const r = await api("/api/seguranca/pin/desativar", { method: "POST", body: JSON.stringify({ pin_atual: PIN }) });
      if (r.status !== 200 || r.body?.ativo) throw new Error(`desligar o PIN: ${r.status} ${JSON.stringify(r.body)}`);
    });

    // 7. bandeja, segunda instância e iniciar com o sistema
    const invoke = (cmd, args = {}) => wd.execute(`return window.__TAURI__.core.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
    const janelaVisivel = () => wd.execute("return window.__TAURI__.window.getCurrentWindow().isVisible()");
    await etapa("bandeja: fechar esconde e abrir de novo traz a janela", async () => {
      await invoke("janela_definir", { campo: "bandeja", valor: true });
      await wd.execute("window.__TAURI__.window.getCurrentWindow().close()");
      await waitFor("a janela escondida", async () => (await janelaVisivel()) === false, { timeout: 10000 });
      // continua vivo: o backend responde e a página roda
      if ((await api("/api/perfil")).status !== 200) throw new Error("o backend caiu junto com a janela");
      // segunda instância: tem que repassar pra primeira e sair sozinha
      const segunda = spawn(APP, [], { env: APP_ENV, stdio: "ignore" });
      const saiu = await Promise.race([
        new Promise((r) => segunda.on("exit", (code) => r({ code }))),
        sleep(30000).then(() => null),
      ]);
      if (!saiu) {
        segunda.kill();
        throw new Error("a segunda instância não saiu (abriu um segundo Kami?)");
      }
      await waitFor("a janela de volta", () => janelaVisivel(), { timeout: 10000 });
      await invoke("janela_definir", { campo: "bandeja", valor: false });
    });

    const entrada = () => {
      if (IS_WINDOWS) {
        // HKCU\...\Run: o valor com o caminho do executável
        const out = ps("(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue | Out-String -Width 4096)");
        return out.toLowerCase().includes(APP.toLowerCase()) ? out : null;
      }
      const pasta = join(HOME_E2E, ".config", "autostart");
      if (!existsSync(pasta)) return null;
      const f = readdirSync(pasta).map((n) => readFileSync(join(pasta, n), "utf8")).find((t) => t.includes(APP));
      return f || null;
    };
    await etapa("iniciar com o sistema: entrada criada e removida", async () => {
      await invoke("janela_definir", { campo: "iniciar_com_sistema", valor: true });
      const criada = entrada();
      if (!criada) throw new Error("nenhuma entrada de início com o sistema apontando pro app");
      if (!criada.includes("--oculto")) throw new Error(`a entrada não abre escondido (--oculto): ${criada}`);
      // DIST-03: removido o programa, a sessão ignora a entrada sozinha
      if (!IS_WINDOWS && !criada.includes(`TryExec=${APP}`)) throw new Error(`a entrada não tem TryExec: ${criada}`);
      if (!(await invoke("janela_preferencias")).iniciar_com_sistema) throw new Error("as preferências não dizem que está ligado");
      await invoke("janela_definir", { campo: "iniciar_com_sistema", valor: false });
      if (entrada()) throw new Error("desligar não removeu a entrada");
    });

    const errosFinais = await errosNaTela();
    if (errosFinais.length) fail(`aviso de erro no fim dos fluxos: ${errosFinais.join(" | ")}`);

    // 8. DIST-03, por último (o app fecha): remover tudo do Kami deste
    // computador pela tela, com autostart e ícone da cor ligados antes
    if (existsSync(join(DATA_DIR, "kami-backend.log"))) copyFileSync(join(DATA_DIR, "kami-backend.log"), join(OUT, "kami-backend.log"));
    await etapa("remover tudo do kami deste computador (DIST-03)", async () => {
      // o nome da entrada no cofre é o do backend (app/crypto.py::_entry_user)
      const usuarioCofre = "chave-dos-segredos-" + createHash("sha256").update(realpathSync.native(DATA_DIR)).digest("hex").slice(0, 16);
      const noCofre = () => ps("cmdkey /list | Out-String -Width 4096").includes(usuarioCofre);
      if (IS_WINDOWS && !noCofre()) throw new Error(`a chave das senhas não estava no cofre antes (${usuarioCofre})`);
      const lancador = HOME_E2E && join(HOME_E2E, ".local", "share", "applications", "Kami.desktop");
      await invoke("janela_definir", { campo: "iniciar_com_sistema", valor: true });
      const onde = await wd.execute("return window.__TAURI__.core.invoke('aplicar_icone_tema', { cor: 'coral' })");
      if (!entrada()) throw new Error("o início com o sistema não ligou antes de remover");

      await clicar("#btn-open-settings");
      await waitFor("configurações", () => visivel('.cfg-tab[data-tab="backup"]'), { timeout: 5000 });
      await clicar('.cfg-tab[data-tab="backup"]');
      await waitFor("a seção remover tudo", () => visivel("#sm-remover"), { timeout: 5000 });
      await wd.execute("document.getElementById('sm-remover').scrollIntoView()");
      await focar("#sm-remover-confirm");
      await wd.keys("remover", { texto: true });
      await print("remover-tudo");
      await clicar("#sm-remover-btn");
      await waitFor("a confirmação", () => visivel("#cm-confirm-btn"), { timeout: 5000 });
      await clicar("#cm-confirm-btn").catch(() => {}); // o app fecha no meio
      await waitFor("a pasta de dados apagada", () => !existsSync(DATA_DIR), { timeout: 30000 });
      if (entrada()) throw new Error("o início com o sistema ficou");
      if (onde?.includes("lançador") && existsSync(lancador)) throw new Error(`o lançador com o ícone da cor ficou: ${lancador}`);
      if (IS_WINDOWS && noCofre()) throw new Error("a chave das senhas ficou no cofre");
      log(`  removido: pasta de dados, início com o sistema${onde?.includes("lançador") ? ", lançador" : ""}${IS_WINDOWS ? ", chave no cofre" : ""}`);
    });
  } finally {
    await wd.quit().catch(() => {});
    driver.kill();
    await sleep(1500);
    if (HOME_E2E) rmSync(HOME_E2E, { recursive: true, force: true });
  }

  // 9. o log não pode ter erro da tela nem erro inesperado (copiado pra
  // OUT antes do "remover tudo", que apaga a pasta de dados)
  const logFile = join(OUT, "kami-backend.log");
  if (existsSync(logFile)) {
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
