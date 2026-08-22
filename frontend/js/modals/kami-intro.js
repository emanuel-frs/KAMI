import { updateProfile, updateAvatar } from "../api/perfil.js";
import { imageToAscii, fitAsciiText, ASCII_RAMPS } from "../components/ascii.js";
import { store } from "../state/store.js";
import { ACCENT_OPTIONS, accentLabel } from "../components/accent-colors.js";
import { icon } from "../components/icons.js";

/**
 * Diálogo de boas-vindas + criação de personagem (plano-onboarding-kami.md,
 * etapas 2 e 3).
 *
 * Substitui o antigo modal de setup (formulário de 3 passos num modal
 * central) por uma caixa de diálogo única, no rodapé da tela, estilo RPG:
 * texto que se escreve sozinho, e os mesmos 3 passos de sempre (nome, cor,
 * avatar) aparecem como perguntas feitas pelo próprio Kami, na mesma
 * conversa — não uma tela nova de formulário. A lógica de coleta/persistência
 * (nome, accent_color, avatar_ascii via updateProfile/updateAvatar) é a
 * mesma do setup antigo; só a apresentação mudou.
 *
 * Fluxo de "beats" (ver BEATS abaixo):
 *   0-4  say        — apresentação do Kami (quem é, como funciona, privacidade)
 *   5    ask-name    — pergunta o nome (etapa 3, passo 1)
 *   6    say         — reage ao nome
 *   7    ask-color    — pergunta a cor de destaque (etapa 3, passo 2)
 *   8    say         — reage à cor
 *   9    ask-avatar   — oferece gerar avatar (etapa 3, passo 3, opcional)
 *   10   say (final) — fecha a conversa e entrega o controle pro app.js
 *                       (que abre o tour geral em seguida)
 *
 * "pular" sempre visível:
 *   - durante a apresentação (beats 0-4): pula direto pra criação de
 *     personagem (beat 5) — não pula a criação em si.
 *   - durante a criação (beats 5-10): encerra a conversa e salva o que já
 *     foi respondido até ali (nome/cor confirmados, avatar já gerado) —
 *     ver nota de decisão no final do arquivo.
 */

let overlayEl = null;
let onDoneCb = null;
let beatIndex = 0;
let typing = null; // controller do typewriter em andamento, se houver
let canTapAdvance = false;
let currentImg = null;

const draft = {
  display_name: "",
  accent_color: "#8fbf8f",
  avatar_ascii: null,
};

const NAME_BEAT = 5;

// ─── roteiro ───────────────────────────────────────────────────────────────
// text: string fixa ou função (draft) -> string, pra reagir ao que já foi
// respondido (nome, cor). type controla o que aparece abaixo do texto.
const BEATS = [
  { type: "say", text: () => "oi. eu sou o kami." },
  {
    type: "say",
    text: () =>
      "a partir de agora sou eu que vou te ajudar a organizar sua vida — carreira, finanças, aprendizado, metas, tudo num lugar só.",
  },
  {
    type: "say",
    text: () =>
      "funciono como um jogo: toda ação que você registra vira xp num atributo, sobe de nível, desbloqueia conquistas. organizar deixa de ser chato.",
  },
  {
    type: "say",
    text: () =>
      "e pode ficar tranquilo(a): tudo roda aqui, na sua máquina. nada sai daqui, sem servidor, sem conta pra criar.",
  },
  { type: "say", text: () => "aliás, falando nisso — eu nem sei seu nome ainda." },
  { type: "ask-name", text: () => "como posso te chamar?" },
  { type: "say", text: () => `prazer, ${draft.display_name || "então"}.` },
  { type: "ask-color", text: () => "agora... qual cor combina com você?" },
  { type: "say", text: () => `gostei, ${accentLabel(draft.accent_color)}.` },
  {
    type: "ask-avatar",
    text: () =>
      "por último — quer gerar um avatar em ascii a partir de uma foto? é rápido, e dá pra pular se preferir.",
  },
  {
    type: "say-end",
    text: () => `prontinho, ${draft.display_name || "então"}. bora dar uma volta pelo sistema?`,
  },
];

// ─── DOM ─────────────────────────────────────────────────────────────────

function buildOverlay() {
  const wrap = document.createElement("div");
  wrap.className = "ki-backdrop";
  wrap.id = "kami-intro";
  wrap.innerHTML = `
    <div class="ki-stage">
      <div class="ki-box" role="dialog" aria-modal="true" aria-label="kami">
        <div class="ki-box-head">
          <span class="ki-speaker">kami<span class="ki-cursor"></span></span>
          <button type="button" class="ki-btn-skip" id="ki-btn-skip">pular</button>
        </div>
        <div class="ki-box-body">
          <p class="ki-question" id="ki-question"></p>
          <div class="ki-controls" id="ki-controls"></div>
          <div class="ki-footer-row">
            <button type="button" class="ki-btn-back" id="ki-btn-back" style="display:none">${icon("arrow-left", { size: 11 })} voltar</button>
            <span class="ki-advance-hint" id="ki-advance-hint" style="visibility:hidden">toque para continuar ${icon("chevron-right", { size: 11 })}</span>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wireStaticEvents(wrap);
  return wrap;
}

function wireStaticEvents(wrap) {
  wrap.querySelector("#ki-btn-skip").addEventListener("click", (e) => {
    e.stopPropagation();
    handleSkip();
  });
  wrap.querySelector("#ki-btn-back").addEventListener("click", (e) => {
    e.stopPropagation();
    handleBack();
  });
  // "toque em qualquer lugar" pra avançar — os controles interativos
  // (input, swatches, botões de avatar) chamam stopPropagation nos
  // próprios handlers pra não disparar isso também.
  wrap.addEventListener("click", () => handleTapAdvance());
}

// ─── typewriter ──────────────────────────────────────────────────────────

function typeText(el, text, onComplete) {
  if (typing) typing.cancel();
  el.textContent = "";
  let i = 0;
  const speed = 20;
  const intervalId = setInterval(() => {
    i++;
    el.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(intervalId);
      typing = null;
      onComplete?.();
    }
  }, speed);
  typing = {
    cancel() {
      clearInterval(intervalId);
      typing = null;
    },
    complete() {
      clearInterval(intervalId);
      el.textContent = text;
      typing = null;
      onComplete?.();
    },
  };
}

// ─── render de cada beat ───────────────────────────────────────────────────

function renderBeat(index) {
  beatIndex = index;
  const beat = BEATS[index];
  const questionEl = overlayEl.querySelector("#ki-question");
  const controlsEl = overlayEl.querySelector("#ki-controls");
  const backBtn = overlayEl.querySelector("#ki-btn-back");
  const hintEl = overlayEl.querySelector("#ki-advance-hint");

  canTapAdvance = false;
  hintEl.style.visibility = "hidden";
  backBtn.style.display = index === 7 || index === 9 ? "" : "none";
  controlsEl.innerHTML = "";
  controlsEl.style.display = "none";

  const text = beat.text(draft);

  typeText(questionEl, text, () => {
    onBeatTextRevealed(beat, controlsEl, hintEl);
  });
}

function onBeatTextRevealed(beat, controlsEl, hintEl) {
  if (beat.type === "say") {
    canTapAdvance = true;
    hintEl.style.visibility = "visible";
    return;
  }
  if (beat.type === "say-end") {
    canTapAdvance = true;
    hintEl.style.visibility = "visible";
    hintEl.innerHTML = `toque para começar ${icon("chevron-right", { size: 11 })}`;
    return;
  }
  controlsEl.style.display = "block";
  if (beat.type === "ask-name") buildNameControls(controlsEl);
  else if (beat.type === "ask-color") buildColorControls(controlsEl, hintEl);
  else if (beat.type === "ask-avatar") buildAvatarControls(controlsEl);
}

// ── passo nome ──────────────────────────────────────────────────────────
function buildNameControls(container) {
  container.innerHTML = `
    <div class="ki-inline-field">
      <input
        id="ki-input-nome"
        type="text"
        placeholder="seu nome ou apelido"
        maxlength="40"
        autocomplete="off"
        spellcheck="false"
      >
      <button type="button" class="btn primary sm" id="ki-btn-nome-ok" disabled>confirmar ${icon("arrow-right", { size: 11 })}</button>
    </div>`;

  const input = container.querySelector("#ki-input-nome");
  const okBtn = container.querySelector("#ki-btn-nome-ok");
  input.value = draft.display_name;
  okBtn.disabled = draft.display_name.trim().length < 1;
  input.focus();

  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("input", () => {
    okBtn.disabled = input.value.trim().length < 1;
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && input.value.trim().length >= 1) confirmName(input.value);
  });
  okBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    confirmName(input.value);
  });
}

function confirmName(value) {
  draft.display_name = value.trim();
  goTo(NAME_BEAT + 1);
}

// ── passo cor ────────────────────────────────────────────────────────────
function buildColorControls(container, hintEl) {
  const swatches = ACCENT_OPTIONS.map((c) => {
    const sel = c.value === draft.accent_color ? " ki-swatch--sel" : "";
    return `<button type="button" class="ki-swatch${sel}" data-color="${c.value}" data-tooltip="${c.label}" style="background:${c.value};" aria-label="${c.label}"></button>`;
  }).join("");

  container.innerHTML = `<div class="ki-swatches">${swatches}</div>`;

  container.querySelectorAll(".ki-swatch").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      draft.accent_color = btn.dataset.color;
      container.querySelectorAll(".ki-swatch").forEach((b) =>
        b.classList.toggle("ki-swatch--sel", b === btn)
      );
      document.documentElement.style.setProperty("--accent", draft.accent_color);
      canTapAdvance = true;
      hintEl.innerHTML = `toque para continuar ${icon("chevron-right", { size: 11 })}`;
      hintEl.style.visibility = "visible";
    });
  });
}

// ── passo avatar ─────────────────────────────────────────────────────────
function buildAvatarControls(container) {
  container.innerHTML = `
    <div class="ki-avatar-grid">
      <div class="ki-avatar-controls">
        <input type="file" id="ki-av-file" accept="image/*">
        <div class="ki-av-col-field" id="ki-av-col-field" style="display:none">
          <label>largura: <b id="ki-av-cols-val">70</b></label>
          <input type="range" id="ki-av-cols" min="30" max="120" value="70">
        </div>
        <p class="ki-av-hint">arraste uma imagem ou use o campo acima. a foto original nunca é salva.</p>
      </div>
      <div class="ki-avatar-preview" id="ki-av-preview">
        <span class="ki-av-placeholder">nenhuma imagem carregada</span>
      </div>
    </div>
    <div class="ki-avatar-actions">
      <button type="button" class="ki-btn-ghost" id="ki-btn-av-skip">pular esse passo</button>
      <button type="button" class="btn primary sm" id="ki-btn-av-ok" disabled>usar esse avatar ${icon("arrow-right", { size: 11 })}</button>
    </div>`;

  const fileInput = container.querySelector("#ki-av-file");
  const colsRange = container.querySelector("#ki-av-cols");
  const colsVal = container.querySelector("#ki-av-cols-val");
  const colField = container.querySelector("#ki-av-col-field");
  const preview = container.querySelector("#ki-av-preview");
  const okBtn = container.querySelector("#ki-btn-av-ok");
  const skipBtn = container.querySelector("#ki-btn-av-skip");

  function renderAscii() {
    if (!currentImg) return;
    const cols = parseInt(colsRange.value, 10);
    colsVal.textContent = cols;
    const { ascii } = imageToAscii(currentImg, { cols, ramp: ASCII_RAMPS.blocos });
    draft.avatar_ascii = ascii;
    okBtn.disabled = false;

    if (!preview.querySelector("pre")) {
      preview.innerHTML = "";
      const pre = document.createElement("pre");
      pre.className = "ki-av-pre";
      preview.appendChild(pre);
    }
    const pre = preview.querySelector("pre");
    pre.textContent = ascii;
    try {
      fitAsciiText(pre, ascii, { container: preview, maxHeight: 150, maxFont: 12, minFont: 1, paddingX: 12, paddingY: 8 });
    } catch (_) {}
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        currentImg = img;
        colField.style.display = "";
        renderAscii();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  [fileInput, colsRange, okBtn, skipBtn].forEach((el) =>
    el.addEventListener("click", (e) => e.stopPropagation())
  );
  fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
  colsRange.addEventListener("input", (e) => {
    e.stopPropagation();
    renderAscii();
  });

  const ctrlArea = container.querySelector(".ki-avatar-controls");
  ctrlArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    ctrlArea.classList.add("ki-drag-over");
  });
  ctrlArea.addEventListener("dragleave", () => ctrlArea.classList.remove("ki-drag-over"));
  ctrlArea.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctrlArea.classList.remove("ki-drag-over");
    loadFile(e.dataTransfer.files[0]);
  });

  okBtn.addEventListener("click", () => goTo(beatIndex + 1));
  skipBtn.addEventListener("click", () => {
    draft.avatar_ascii = null;
    goTo(beatIndex + 1);
  });
}

// ─── navegação ─────────────────────────────────────────────────────────────

function handleTapAdvance() {
  if (typing) {
    typing.complete();
    return;
  }
  if (!canTapAdvance) return;
  if (beatIndex === BEATS.length - 1) {
    finish();
    return;
  }
  goTo(beatIndex + 1);
}

function handleBack() {
  if (beatIndex === 7) goTo(NAME_BEAT);
  else if (beatIndex === 9) goTo(7);
}

function handleSkip() {
  if (beatIndex < NAME_BEAT) {
    goTo(NAME_BEAT);
    return;
  }
  // já em criação de personagem — encerra e salva o que já foi respondido
  // até aqui (ver nota de decisão no topo do arquivo).
  finish();
}

function goTo(index) {
  renderBeat(index);
}

// ─── persistência + encerramento ────────────────────────────────────────────

async function finish() {
  if (typing) typing.cancel();
  overlayEl.classList.add("ki-saving");

  try {
    const updates = {};
    if (draft.display_name) updates.display_name = draft.display_name;
    if (draft.accent_color !== "#8fbf8f") updates.accent_color = draft.accent_color;
    if (Object.keys(updates).length > 0) {
      const updated = await updateProfile(updates);
      store.set("profile", { ...store.get("profile"), ...updated });
      const usernameEl = document.getElementById("sidebar-username");
      if (usernameEl && updated.display_name) usernameEl.textContent = updated.display_name;
      document.documentElement.style.setProperty("--accent", updated.accent_color);
    }
    if (draft.avatar_ascii) {
      const profileWithAvatar = await updateAvatar(draft.avatar_ascii);
      store.set("profile", { ...store.get("profile"), ...profileWithAvatar });
      applySidebarAvatar(draft.avatar_ascii);
    }
  } catch (err) {
    console.error("erro ao salvar apresentação/criação de personagem:", err);
  }

  closeOverlay();
}

function applySidebarAvatar(ascii) {
  const el = document.getElementById("sidebar-avatar");
  if (!el) return;
  el.textContent = ascii;
  try {
    fitAsciiText(el, ascii, { container: el.parentElement, maxHeight: 25, maxFont: 3, minFont: 1, paddingX: 8, paddingY: 4 });
  } catch (_) {}
}

function closeOverlay() {
  overlayEl.classList.remove("open");
  const cb = onDoneCb;
  onDoneCb = null;
  setTimeout(() => {
    overlayEl?.classList.remove("ki-saving");
  }, 300);
  cb?.();
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Abre o diálogo de boas-vindas + criação de personagem (primeira
 * execução). @param {Function} onDone — chamado ao terminar (concluído ou
 * pulado); app.js usa isso pra encadear o tour geral em seguida.
 */
export function openKamiIntro(onDone) {
  onDoneCb = onDone ?? null;
  overlayEl = overlayEl || buildOverlay();
  currentImg = null;
  draft.display_name = "";
  draft.accent_color = "#8fbf8f";
  draft.avatar_ascii = null;
  overlayEl.classList.add("open");
  renderBeat(0);
}
