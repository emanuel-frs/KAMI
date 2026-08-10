/**
 * Splash de abertura — item 1 do plano de onboarding (plano-onboarding-kami.md,
 * etapa 1: "Abertura kami").
 *
 * Tela cheia preta com a palavra "kami" em ASCII (mesma arte do banner do
 * README, fonte ANSI Shadow — tipografia do próprio sistema, não é imagem
 * nem sprite). Os caracteres "materializam" progressivamente em varredura
 * diagonal, com um flicker curto por ruído/glifos antes de assentar no
 * caractere final — o clássico efeito de abertura de portátil, remontado
 * com a paleta cinza + accent do Kami. Depois de uma pausa curta, desfaz
 * do mesmo jeito (scramble → espaço).
 *
 * Roda em TODO boot (não só no primeiro), como assinatura visual — por
 * isso é rápida (poucos segundos) e pode ser pulada a qualquer momento
 * com clique/toque/tecla. app.js decide o que acontece depois dela
 * (setup + tour na primeira vez, direto pro app nas seguintes).
 */

const ART = [
  "██╗  ██╗ █████╗ ███╗   ███╗ ██╗",
  "██║ ██╔╝██╔══██╗████╗ ████║ ██║",
  "█████╔╝ ███████║██╔████╔██║ ██║",
  "██╔═██╗ ██╔══██║██║╚██╔╝██║ ██║",
  "██║  ██╗██║  ██║██║ ╚═╝ ██║ ██║",
  "╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═╝",
];

// glifos usados no flicker de materialização/dissolução — mistura de
// blocos (mesma família da arte) com o "ruído" leve da rampa de avatar
// (components/ascii.js), pra parecer scan/decode, não troca aleatória
// de qualquer símbolo.
const NOISE_CHARS = "░▒▓█▚▞│┤┐└┴┬├─╱╲".split("");

const INITIAL_DELAY_MS = 1000; // tela preta antes de começar a materializar
const ROW_STEP_MS = 85; // distância entre linhas na varredura diagonal
const COL_STEP_MS = 5; // distância entre colunas na mesma varredura
const FLICKER_TICKS = 3; // nº de glifos de ruído antes de assentar
const FLICKER_INTERVAL_MS = 35;
const HOLD_MS = 2000; // pausa parada com a logo pronta, antes de dissolver
const FADE_OUT_MS = 320; // fade do overlay inteiro ao final

let active = false;

function randNoise() {
  return NOISE_CHARS[(Math.random() * NOISE_CHARS.length) | 0];
}

/**
 * Toca o splash e resolve quando ele termina (materializa → pausa →
 * dissolve → fade) OU quando o usuário pula. Sempre resolve, nunca rejeita.
 */
export function playBootSplash() {
  return new Promise((resolve) => {
    if (active) {
      resolve();
      return;
    }
    active = true;

    const timers = [];
    const schedule = (fn, ms) => {
      const id = setTimeout(fn, ms);
      timers.push(id);
      return id;
    };
    const clearAllTimers = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };

    const overlay = document.createElement("div");
    overlay.className = "boot-splash";
    overlay.setAttribute("role", "presentation");

    const pre = document.createElement("pre");
    pre.className = "boot-splash-art";

    // constrói tudo como um único fluxo de texto dentro do <pre>: cada
    // caractere não-espaço vira um span animável, espaços viram texto
    // puro, e a quebra entre as 6 linhas da arte é uma quebra de linha
    // REAL (\n) dentro do próprio fluxo — nada de <div> por linha, que
    // por ser block-level já quebra sozinho e, somado a um \n extra
    // entre elas, dobrava o espaçamento vertical.
    const cells = []; // { span, finalChar, delay }
    let maxDelay = 0;

    ART.forEach((line, row) => {
      if (row > 0) pre.appendChild(document.createTextNode("\n"));
      [...line].forEach((ch, col) => {
        if (ch === " ") {
          pre.appendChild(document.createTextNode(" "));
          return;
        }
        const span = document.createElement("span");
        span.className = "boot-char";
        span.textContent = " ";
        pre.appendChild(span);
        const delay = row * ROW_STEP_MS + col * COL_STEP_MS;
        maxDelay = Math.max(maxDelay, delay);
        cells.push({ span, finalChar: ch, delay });
      });
    });

    overlay.appendChild(pre);
    document.body.appendChild(overlay);
    // força reflow antes de adicionar a classe que dispara o fade-in do overlay
    void overlay.offsetWidth;
    overlay.classList.add("open");

    function materializeCell(cell) {
      cell.span.classList.add("boot-char--on");
      let ticks = 0;
      const flicker = () => {
        if (ticks >= FLICKER_TICKS) {
          cell.span.textContent = cell.finalChar;
          cell.span.classList.add("boot-char--settled");
          return;
        }
        cell.span.textContent = randNoise();
        ticks++;
        schedule(flicker, FLICKER_INTERVAL_MS);
      };
      flicker();
    }

    function dissolveCell(cell) {
      let ticks = 0;
      const flicker = () => {
        if (ticks >= FLICKER_TICKS) {
          cell.span.textContent = " ";
          cell.span.classList.remove("boot-char--settled");
          cell.span.classList.remove("boot-char--on");
          return;
        }
        cell.span.textContent = randNoise();
        ticks++;
        schedule(flicker, FLICKER_INTERVAL_MS);
      };
      flicker();
    }

    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      clearAllTimers();
      overlay.classList.remove("open");
      overlay.classList.add("closing");
      const cleanupDelay = schedule(() => {
        overlay.remove();
        overlay.removeEventListener("pointerdown", skip);
        window.removeEventListener("keydown", skip);
        active = false;
        resolve();
      }, FADE_OUT_MS);
      timers.push(cleanupDelay);
    }

    function skip() {
      finish();
    }

    overlay.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip, { once: false });

    // segura em preto por INITIAL_DELAY_MS antes de começar — só depois
    // disso a varredura diagonal de materialização começa
    cells.forEach((cell) =>
      schedule(() => materializeCell(cell), INITIAL_DELAY_MS + cell.delay)
    );

    // depois da última célula assentar (delay + flickers) + pausa parada
    // com a logo pronta, inicia a dissolução na mesma ordem/varredura
    const materializeEnd = INITIAL_DELAY_MS + maxDelay + FLICKER_TICKS * FLICKER_INTERVAL_MS;
    schedule(() => {
      cells.forEach((cell) => schedule(() => dissolveCell(cell), cell.delay));
      const dissolveEnd = maxDelay + FLICKER_TICKS * FLICKER_INTERVAL_MS;
      schedule(finish, dissolveEnd + 120);
    }, materializeEnd + HOLD_MS);
  });
}
