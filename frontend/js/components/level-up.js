import { allowsMotion } from "./visual-effects.js";
import { escapeHtml } from "./format.js";

/**
 * Tela de subida do NÍVEL GERAL (GAM-04) — disparada pelo
 * progress-watcher.js quando /api/nucleo/player.level sobe e a
 * preferência de efeitos é `completo`. Subida de um atributo só continua
 * como toast; esta tela fica pra o marco maior.
 *
 * Visual: "LEVEL UP" na mesma fonte ASCII do splash de abertura
 * (boot-splash.js, família "ANSI Shadow"), scanlines de CRT e um glitch
 * curto ao entrar — tudo em CSS (css/level-up.css), sem movimento quando
 * allowsMotion() é falso.
 *
 * GAM-10: `unlocked` (títulos/temas liberados nesta subida) vira a linha
 * "desbloqueado: …" — eles se escolhem em configurações > aparência.
 *
 * Acessível: role="dialog" + aria-modal, foco vai pro botão de fechar e
 * volta pra onde estava ao sair; fecha com clique, Esc, Enter/Espaço ou
 * sozinha depois de AUTO_CLOSE_MS (a contagem pausa com mouse/foco em cima).
 */

const AUTO_CLOSE_MS = 3500;

// letras em "ANSI Shadow" (6 linhas cada) — só as que "LEVEL UP" usa
const GLYPHS = {
  L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  V: ["██╗   ██╗", "██║   ██║", "██║   ██║", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚═══╝  "],
  U: ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  P: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔═══╝ ", "██║     ", "╚═╝     "],
  " ": ["  ", "  ", "  ", "  ", "  ", "  "],
};

export function asciiBanner(text) {
  const rows = ["", "", "", "", "", ""];
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    glyph.forEach((part, i) => (rows[i] += part));
  }
  return rows.map((r) => r.replace(/\s+$/, "")).join("\n");
}

let openEl = null;

export function showLevelUp({ level, previousLevel, totalXp, unlocked = [] }) {
  openEl?.dismiss();

  const previousFocus = document.activeElement;
  const el = document.createElement("div");
  el.className = `level-up${allowsMotion() ? " animated" : ""}`;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "level-up-title");
  el.innerHTML = `
    <div class="level-up-inner">
      <pre class="level-up-art" aria-hidden="true">${asciiBanner("LEVEL UP")}</pre>
      <p class="level-up-title" id="level-up-title">nível ${previousLevel} → ${level}</p>
      <p class="level-up-sub">${Number(totalXp).toLocaleString("pt-BR")} xp no total</p>
      ${unlocked.length ? `<p class="level-up-unlocked">desbloqueado: ${unlocked.map(escapeHtml).join(" · ")}</p>` : ""}
      <button type="button" class="btn sm level-up-close">continuar</button>
    </div>
  `;

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, AUTO_CLOSE_MS);
  };
  function dismiss() {
    clearTimeout(timer);
    document.removeEventListener("keydown", onKey, true);
    el.classList.remove("open");
    setTimeout(() => el.remove(), 200);
    if (openEl === el) openEl = null;
    if (previousFocus && previousFocus.isConnected) previousFocus.focus?.();
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
    } else if (e.key === "Tab") {
      // foco preso no único botão do diálogo
      e.preventDefault();
      el.querySelector(".level-up-close").focus();
    }
  }
  el.dismiss = dismiss;

  el.addEventListener("click", dismiss);
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", schedule);
  document.addEventListener("keydown", onKey, true);

  document.body.appendChild(el);
  openEl = el;
  requestAnimationFrame(() => el.classList.add("open"));
  el.querySelector(".level-up-close").focus();
  schedule();
  return dismiss;
}
