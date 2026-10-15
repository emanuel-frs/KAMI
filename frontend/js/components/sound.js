import { store } from "../state/store.js";
import { ALL_SEL as A11Y_CLICKABLE } from "./clickable-a11y.js";

/**
 * Sons do app (GAM-13) — bipes 8-bit sintetizados na hora pelo ZzFX
 * (js/vendor/zzfx.js, MIT, copiado sem alteração: o CSP do Tauri só aceita
 * arquivos locais). Nenhum arquivo de áudio. Regras combinadas com o
 * Emanuel em 2026-10-09:
 *
 *   - o som começa LIGADO (mudou no teste: era desligado);
 *   - três grupos, cada um liga/desliga sozinho (todos começam ligados):
 *       progresso: +xp, nível de atributo, LEVEL UP, conquista, missão,
 *                  sequência salva
 *       interface: TODO clique — com som próprio pra confirmar, perigo,
 *                  aba, alternar, fechar e navegar (clickSoundFor) —,
 *                  abrir/fechar modal, trocar de tela, a voz da kami e a
 *                  abertura do app (splash, components/boot-splash.js)
 *       avisos:    toast/notificação, erro, alerta (modal de confirmação)
 *                  e download de arquivo
 *   - volume 0–100; só o timbre 8-bit por enquanto.
 *
 * O ZzFX é importado assim que o perfil chega com o som ligado (não no
 * primeiro som: o bipe esperava o import) — com o som desligado nenhum
 * AudioContext é criado. Os sons não dependem da preferência de efeitos
 * visuais (são outra configuração).
 */

// cada som: lista de notas [atraso ms, parâmetros do ZzFX]. Parâmetros do
// ZzFX, na ordem: volume, aleatoriedade, frequência, ataque, sustentação,
// soltura, forma (0 seno · 1 triângulo · 2 serra · 4 ruído · 5 quadrada),
// curva, deslize, …, salto de tom, tempo do salto.
const sq = (freq, len = 0.05, vol = 0.5) => [vol, 0, freq, 0.005, len, 0.05, 5, 1];
const tri = (freq, len = 0.06, vol = 0.6) => [vol, 0, freq, 0.005, len, 0.08, 1, 1];

export const SOUNDS = {
  // progresso
  xp: { group: "progresso", notes: [[0, [0.4, 0, 1046, 0.005, 0.02, 0.05, 5, 1, 0, 0, 523, 0.03]]] },
  nivel: { group: "progresso", notes: [[0, sq(659)], [70, sq(880, 0.08)]] },
  levelup: { group: "progresso", notes: [[0, sq(523)], [80, sq(659)], [160, sq(784)], [240, sq(1046, 0.2)]] },
  conquista: { group: "progresso", notes: [[0, sq(784, 0.04)], [60, sq(1046, 0.04)], [120, sq(1318, 0.04)], [180, sq(1568, 0.18, 0.45)]] },
  missao: { group: "progresso", notes: [[0, sq(880, 0.04)], [60, sq(1318, 0.07)]] },
  sequencia: { group: "progresso", notes: [[0, tri(440)], [90, tri(660, 0.12)]] },
  // interface — um som por tipo de controle (ver clickSoundFor). Todos de
  // uma nota só, curtos: tocam a cada clique, então precisam ser discretos
  clique: { group: "interface", notes: [[0, [0.25, 0, 1500, 0, 0, 0.015, 4, 1]]] },
  confirmar: { group: "interface", notes: [[0, sq(1046, 0.03, 0.3)]] },
  perigo: { group: "interface", notes: [[0, sq(262, 0.03, 0.35)]] },
  alternar: { group: "interface", notes: [[0, tri(1318, 0.012, 0.3)]] },
  aba: { group: "interface", notes: [[0, [0.25, 0, 900, 0, 0.01, 0.03, 1, 1]]] },
  abrir: { group: "interface", notes: [[0, [0.3, 0, 500, 0.005, 0.02, 0.05, 1, 1, 30]]] },
  fechar: { group: "interface", notes: [[0, [0.3, 0, 700, 0.005, 0.02, 0.05, 1, 1, -30]]] },
  navegar: { group: "interface", notes: [[0, [0.2, 0, 1200, 0, 0.005, 0.02, 5, 1]]] },
  // a "voz" da kami no diálogo inicial (modals/kami-intro.js): um bipe
  // curtinho a cada par de letras, com 12% de variação de tom (o próprio
  // ZzFX sorteia) pra soar como fala de personagem de jogo antigo
  voz: { group: "interface", notes: [[0, [0.22, 0.12, 620, 0, 0.012, 0.02, 5, 1]]] },
  // abertura do app (boot-splash.js): a tela "liga" num zumbido subindo
  // (~80→760 Hz) e assenta num arpejo quando a logo começa a aparecer
  abertura: {
    group: "interface",
    notes: [[0, [0.3, 0, 80, 0.02, 0.18, 0.05, 1, 1, 6]], [260, sq(523, 0.03, 0.35)], [340, sq(784, 0.03, 0.35)], [420, sq(1046, 0.16, 0.4)]],
  },
  // avisos
  aviso: { group: "avisos", notes: [[0, tri(988, 0.04, 0.45)], [80, tri(784, 0.06, 0.45)]] },
  // modal de confirmação/pergunta (confirm-modal.js, prompt-modal.js)
  alerta: { group: "avisos", notes: [[0, sq(988, 0.05, 0.35)], [100, sq(740, 0.06, 0.35)]] },
  // arquivo salvo (backup, retrospectiva .txt…) — qualquer <a download>
  download: { group: "avisos", notes: [[0, sq(784, 0.03, 0.35)], [60, sq(1318, 0.07, 0.35)]] },
  erro: { group: "avisos", notes: [[0, [0.45, 0, 110, 0.005, 0.08, 0.12, 5, 1, -2]]] },
};

const GROUP_FIELD = { progresso: "som_progresso", interface: "som_interface", avisos: "som_avisos" };

// ── motor ────────────────────────────────────────────────────────────
// Atraso e som que não saía (relato do teste, 2026-10-14) vinham de: o ZzFX
// só carregava no primeiro som (import + AudioContext novo + resume, tudo
// antes do bipe), cada nota passava por setTimeout e era sintetizada de novo
// a cada toque, e a saída de áudio do sistema (PipeWire/Pulse) dormia entre
// um som e outro — o bipe curtinho do clique sumia inteiro enquanto ela
// acordava. Agora: o motor carrega junto com o perfil (wireSounds), o buffer
// de cada nota é montado uma vez, as notas são agendadas no relógio do
// próprio áudio e um sinal inaudível mantém a saída acordada enquanto o app
// está visível com o som ligado.

let ZZFX = null; // o motor, depois de carregado
let loading = null;
let keepAlive = null;

function loadEngine() {
  loading ??= import("../vendor/zzfx.js").then((m) => {
    ZZFX = m.ZZFX;
    // buffers na taxa da própria saída: sem conversão a cada nota
    ZZFX.sampleRate = ZZFX.audioContext.sampleRate || ZZFX.sampleRate;
    wakeOutput();
    return ZZFX;
  });
  return loading;
}

function wakeOutput() {
  const ctx = ZZFX?.audioContext;
  if (!ctx) return;
  if (ctx.state !== "running") Promise.resolve(ctx.resume?.()).catch(() => {});
  if (keepAlive || typeof ctx.createConstantSource !== "function") return;
  try {
    keepAlive = ctx.createConstantSource();
    keepAlive.offset.value = 1e-5; // ~-100 dB: inaudível, mas não é silêncio pro sistema
    keepAlive.connect(ctx.destination);
    keepAlive.start();
  } catch {
    keepAlive = null;
  }
}

// app escondido ou som desligado: solta a saída de áudio do sistema
function sleepOutput() {
  const ctx = ZZFX?.audioContext;
  if (ctx?.state === "running") Promise.resolve(ctx.suspend?.()).catch(() => {});
}

// parâmetros da nota → AudioBuffer pronto (as notas de SOUNDS são arrays
// fixos, então a identidade serve de chave)
const buffers = new WeakMap();

function makeBuffer(params) {
  const samples = ZZFX.buildSamples(...params);
  const buffer = ZZFX.audioContext.createBuffer(1, samples.length, ZZFX.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

function bufferFor(params) {
  // nota com aleatoriedade (a voz da kami) é sintetizada a cada toque
  if (params[1]) return makeBuffer(params);
  let buffer = buffers.get(params);
  if (!buffer) buffers.set(params, (buffer = makeBuffer(params)));
  return buffer;
}

// Uma saída só (volume geral) pra todos os sons, e cada nota se desliga
// quando termina. Antes cada som criava o próprio nó de volume ligado na
// saída e nunca desligado: no WebKitGTK eles iam se acumulando (a voz da
// kami cria centenas no diálogo inicial; cliques rápidos, dezenas) até a
// thread de áudio não dar conta — a saída engasgava e ficava muda por um
// tempo (5º teste, 2026-10-14). MAX_VOICES limita as notas simultâneas:
// passou disso, a mais antiga é cortada.
const MAX_VOICES = 16;
let master = null;
const live = new Set(); // notas tocando ou agendadas

function masterFor(ctx) {
  if (master?.context !== ctx) {
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  return master;
}

function release(source) {
  if (!live.delete(source)) return;
  try {
    source.disconnect?.();
  } catch {
    // já desligada
  }
}

function render(sound, volume) {
  wakeOutput();
  const ctx = ZZFX.audioContext;
  const out = masterFor(ctx);
  out.gain.value = 0.3 * (volume / 100);
  const start = ctx.currentTime ?? 0;
  for (const [delay, params] of sound.notes) {
    const source = ctx.createBufferSource();
    source.buffer = bufferFor(params);
    source.connect(out);
    source.onended = () => release(source);
    live.add(source);
    source.start(start + delay / 1000);
  }
  for (const oldest of live) {
    if (live.size <= MAX_VOICES) break;
    try {
      oldest.stop?.();
    } catch {
      // ainda não tinha começado
    }
    release(oldest);
  }
}

/** Se o som `name` deve tocar agora, pelas preferências do perfil. */
export function soundAllowed(name, profile = store.get("profile")) {
  const sound = SOUNDS[name];
  if (!sound || !profile?.som_ativo) return false;
  return Boolean(profile[GROUP_FIELD[sound.group]]);
}

/**
 * Toca o som `name` se as preferências deixam. `force` ignora liga/desliga
 * (botão "ouvir" das configurações), mas respeita o volume.
 */
export function playSound(name, { force = false } = {}) {
  const sound = SOUNDS[name];
  const profile = store.get("profile");
  if (!sound || (!force && !soundAllowed(name, profile))) return;
  const volume = profile?.som_volume ?? 60;
  // sem áudio no ambiente (ou bloqueado) — o app segue em silêncio
  if (!ZZFX) return loadEngine().then(() => render(sound, volume)).catch(() => {});
  try {
    render(sound, volume);
  } catch {
    // idem
  }
}

/**
 * Toca `name` assim que o perfil existir — o splash de abertura roda antes
 * de ele carregar. Devolve a função que cancela (splash pulado antes).
 */
export function playWhenReady(name) {
  if (store.get("profile")) {
    playSound(name);
    return () => {};
  }
  const off = store.subscribe("profile", () => {
    off();
    playSound(name);
  });
  return off;
}

// ── ganchos do app inteiro ───────────────────────────────────────────

// tudo que é clicável — além dos botões de verdade, os papéis ARIA e a
// lista de clicáveis de clickable-a11y.js (que inclui os contêineres com
// proxy, ex.: o item do sino, que não ganham papel nenhum)
const CLICKABLE =
  "button, a[href], summary, label, input, select, [role='button'], [role='tab'], [role='switch'], " +
  "[role='checkbox'], [role='radio'], [role='option'], [role='menuitem'], [role='link'], [data-action], .btn, " +
  A11Y_CLICKABLE;
const TOGGLES =
  "input[type='checkbox'], input[type='radio'], [role='switch'], [role='checkbox'], [role='radio'], [aria-pressed]";
const TABS = "[role='tab'], [data-tab], .cfg-tab, .tab, .modal-tab";
// fechar/cancelar
const CLOSERS = "[data-action='close'], .close, [aria-label='fechar']";

function hasPointerCursor(el) {
  // o cursor em pixel art (pixel-cursor.js) deixa o valor como "url(...) x y, pointer"
  const cursor = getComputedStyle(el).cursor;
  return cursor === "pointer" || cursor.endsWith(", pointer");
}

/**
 * Qual som um clique em `target` faz (ou null). Exportada pros testes.
 * Ordem: arquivo baixado > nav lateral > fechar > (campo de texto e o
 * label dele: sem som — não é botão) > perigo > confirmar > aba >
 * alternar > clique comum.
 */
export function clickSoundFor(target) {
  if (typeof target?.closest !== "function") return null; // só elementos (não nó de texto)
  if (target.closest("a[download]")) return "download";
  let el = target.closest(CLICKABLE);
  if (!el) {
    // <div> clicável sem papel nenhum: o cursor de mão denuncia
    for (let n = target, depth = 0; n && n !== document.body && depth < 4; n = n.parentElement, depth++) {
      if (hasPointerCursor(n)) {
        el = n;
        break;
      }
    }
  }
  if (!el) return null;
  // botão desabilitado não faz nada — não finge que fez
  if (el.matches(":disabled, [aria-disabled='true']")) return null;
  // TODO botão tem som (pedido no teste): a navegação lateral e o
  // fechar/cancelar também, cada um com o seu
  if (el.closest(".nav-link")) return "navegar";
  if (el.matches(CLOSERS) || el.closest(CLOSERS)) return "fechar";
  // clicar num campo de texto pra digitar não bipa
  if (el.matches("input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='button']):not([type='submit']), textarea, select")) {
    return null;
  }
  // label de campo de texto só põe o foco no campo
  if (el.matches("label") && !el.querySelector("input[type='checkbox'], input[type='radio']")) return null;
  if (el.matches(".btn.danger, .danger")) return "perigo";
  if (el.matches(".btn.primary, [type='submit']")) return "confirmar";
  if (el.matches(TABS)) return "aba";
  if (el.matches(TOGGLES) || el.querySelector?.("input[type='checkbox'], input[type='radio']")) return "alternar";
  return "clique";
}

// clicar num <label> de checkbox gera dois cliques (o do label e o do
// input) — o mesmo som em menos de DEDUP_MS toca uma vez só
const DEDUP_MS = 60;
let last = { name: null, at: 0 };

// quando foi o último som de clique — os sons "de consequência" (janela
// fechando, tela trocando) não repetem logo depois de um clique, que já deu
// o retorno; só tocam quando a coisa acontece sem clique (atalho de teclado,
// Esc, fechamento automático)
const AFTER_CLICK_MS = 250;
let lastClickAt = -Infinity;

// o som do clique de mouse/toque sai no pointerdown — no "click" ele só
// saía ao SOLTAR o botão, e soava atrasado. O "click" que vem em seguida
// fica quieto; ele só toca o que não passa por pointerdown: Enter/Espaço
// num botão e o .click() do código (event.detail 0)
let pressed = false;

function playClick(target) {
  const name = clickSoundFor(target);
  if (!name) return;
  const now = performance.now();
  if (name === last.name && now - last.at < DEDUP_MS) return;
  last = { name, at: now };
  lastClickAt = now;
  playSound(name);
}

function onPointerDown(e) {
  if (e.button !== 0) return; // botão direito/do meio não é clique
  pressed = true;
  playClick(e.target);
}

function onClick(e) {
  if (e.detail !== 0 && pressed) {
    pressed = false;
    return;
  }
  playClick(e.target);
}

/** Som de consequência (fechar janela, trocar de tela) — fica quieto se um clique acabou de tocar. */
export function playFollowUp(name) {
  if (performance.now() - lastClickAt < AFTER_CLICK_MS) return;
  playSound(name);
}

function watchModals() {
  // .modal-backdrop ganha/perde a classe "open" (padrão de todos os modais;
  // .ki-backdrop é o diálogo inicial da kami, modals/kami-intro.js)
  const open = new WeakMap();
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      const el = m.target;
      if (!el.classList?.contains("modal-backdrop") && !el.classList?.contains("ki-backdrop")) continue;
      const isOpen = el.classList.contains("open");
      if (open.get(el) === isOpen) continue;
      open.set(el, isOpen);
      // o modal de erro toca "erro" ele mesmo (err-modal.js); confirmação e
      // pergunta são alertas — pedem atenção antes de seguir
      if (isOpen && el.id === "error-modal") continue;
      const alert = el.id === "confirm-modal" || el.id === "prompt-modal";
      // abrir sempre toca, mesmo vindo de um clique (pedido no teste,
      // 2026-10-14: aberta por clique — o caso comum — a janela ficava só
      // no bipe do clique); alerta idem (pede atenção antes de seguir)
      if (isOpen) playSound(alert ? "alerta" : "abrir");
      else playFollowUp("fechar");
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
}

export function wireSounds() {
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  // motor pronto antes do primeiro som; saída de áudio solta com o som
  // desligado ou o app escondido
  const sync = (profile) => (profile?.som_ativo ? loadEngine().then(wakeOutput).catch(() => {}) : sleepOutput());
  store.subscribe("profile", sync);
  sync(store.get("profile"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sleepOutput();
    else if (store.get("profile")?.som_ativo && ZZFX) wakeOutput();
  });
  watchModals();
  // conquista / missão / sequência salva (components/achievement-popup.js)
  window.addEventListener("kami:achievement-popup", (e) => {
    const kind = e.detail?.kind;
    playSound(kind === "missao" ? "missao" : kind === "sequencia" ? "sequencia" : "conquista");
  });
}
