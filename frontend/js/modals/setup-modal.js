import { updateProfile, updateAvatar } from "../api/perfil.js";
import { imageToAscii, fitAsciiText, ASCII_RAMPS } from "../components/ascii.js";
import { icon } from "../components/icons.js";
import { store } from "../state/store.js";

/**
 * Modal de setup de perfil (primeira execução).
 *
 * Aparece antes do tour de onboarding quando o sistema detecta que o
 * usuário nunca configurou o perfil (display_name === "usuário" &&
 * avatar_ascii === null). Permite definir nome, cor de destaque e avatar
 * antes de entrar no app — sem bloquear: o botão "pular" encerra o modal
 * sem salvar nada.
 *
 * Fluxo de 3 passos lineares (sem tabs, sem voltar ao passo 1 por enquanto):
 *   1. Nome de exibição
 *   2. Cor de destaque
 *   3. Avatar (opcional)
 *
 * Ao concluir (ou pular), chama o callback onDone que app.js usa para
 * decidir se abre o tour de onboarding logo em seguida.
 *
 * Singleton: o DOM é construído uma vez e reutilizado.
 */

let modalEl = null;
let currentStep = 0;
let onDoneCb = null;

// estado temporário coletado pelos passos
const draft = {
  display_name: "",
  accent_color: "#8fbf8f",
  avatar_ascii: null,
};

// paleta de cores de destaque (valor + label legível)
const ACCENT_COLORS = [
  { value: "#8fbf8f", label: "verde"        },
  { value: "#7aafcf", label: "azul"         },
  { value: "#b3a06a", label: "âmbar"        },
  { value: "#c47f7f", label: "vermelho"     },
  { value: "#a07acf", label: "lilás"        },
  { value: "#7acfb3", label: "turquesa"     },
  { value: "#cfaf7a", label: "dourado"      },
  { value: "#cfcfcf", label: "cinza claro"  },
];

// ─── Passos ──────────────────────────────────────────────────────────────────

const STEPS = [
  {
    id: "nome",
    title: "como quer ser chamado(a)?",
    build: buildStepNome,
    save: saveStepNome,
  },
  {
    id: "cor",
    title: "escolha uma cor de destaque",
    build: buildStepCor,
    save: saveStepCor,
  },
  {
    id: "avatar",
    title: "avatar pessoal (opcional)",
    build: buildStepAvatar,
    save: () => {}, // salvo inline ao converter
  },
];

// ─── Passo 1 — Nome ──────────────────────────────────────────────────────────

function buildStepNome(container) {
  container.innerHTML = `
    <div class="sp-step sp-step--nome">
      <p class="sp-hint">
        este nome aparece na barra lateral e em todo o app. pode mudar depois
        nas configurações de perfil.
      </p>
      <div class="field">
        <label for="sp-input-nome">nome de exibição</label>
        <input
          id="sp-input-nome"
          type="text"
          class="sp-name-input"
          placeholder="seu nome ou apelido"
          maxlength="40"
          autocomplete="off"
          spellcheck="false"
          value="${escapeAttr(draft.display_name)}"
        >
      </div>
    </div>`;

  const input = container.querySelector("#sp-input-nome");
  input.focus();
  input.addEventListener("input", () => {
    draft.display_name = input.value.trim();
    syncNextBtn();
  });
  // Enter avança
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && draft.display_name.length >= 1) advance();
  });
}

function saveStepNome() {
  // salvo em bloco no final — aqui só sincroniza o draft
}

// ─── Passo 2 — Cor ───────────────────────────────────────────────────────────

function buildStepCor(container) {
  const swatches = ACCENT_COLORS.map((c) => {
    const sel = c.value === draft.accent_color ? " sp-swatch--sel" : "";
    return `<button
      type="button"
      class="sp-swatch${sel}"
      data-color="${c.value}"
      title="${c.label}"
      style="background:${c.value};"
      aria-label="${c.label}"
    ></button>`;
  }).join("");

  container.innerHTML = `
    <div class="sp-step sp-step--cor">
      <p class="sp-hint">
        a cor afeta barras de progresso, links ativos e elementos de
        destaque em todo o app. pode trocar depois no perfil.
      </p>
      <div class="sp-swatches">${swatches}</div>
      <div class="sp-color-preview">
        <span class="sp-preview-bar" id="sp-preview-bar" style="background:${draft.accent_color};"></span>
        <span class="sp-preview-label" id="sp-preview-label">${labelFor(draft.accent_color)}</span>
      </div>
    </div>`;

  container.querySelectorAll(".sp-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      draft.accent_color = btn.dataset.color;
      container.querySelectorAll(".sp-swatch").forEach((b) =>
        b.classList.toggle("sp-swatch--sel", b === btn)
      );
      container.querySelector("#sp-preview-bar").style.background = draft.accent_color;
      container.querySelector("#sp-preview-label").textContent = labelFor(draft.accent_color);
      // preview ao vivo no CSS
      document.documentElement.style.setProperty("--accent", draft.accent_color);
    });
  });
}

function saveStepCor() {}

function labelFor(color) {
  return ACCENT_COLORS.find((c) => c.value === color)?.label ?? color;
}

// ─── Passo 3 — Avatar ────────────────────────────────────────────────────────

let _currentImg = null;

function buildStepAvatar(container) {
  container.innerHTML = `
    <div class="sp-step sp-step--avatar">
      <p class="sp-hint">
        gere seu avatar em ASCII a partir de uma foto — tudo roda local
        via &lt;canvas&gt;, a imagem original nunca é salva. se preferir,
        pule: dá pra configurar depois no perfil.
      </p>
      <div class="sp-avatar-grid">
        <div class="sp-avatar-controls">
          <div class="field">
            <label>foto (não é salva)</label>
            <input type="file" id="sp-av-file" accept="image/*">
          </div>
          <div class="field" id="sp-av-col-field" style="display:none">
            <label>largura (colunas): <b id="sp-av-cols-val" style="color:var(--text-bright);">70</b></label>
            <input type="range" id="sp-av-cols" min="30" max="120" value="70"
              style="accent-color:var(--accent); width:100%;">
          </div>
          <p class="al-hint" id="sp-av-drop-hint">
            arraste uma imagem sobre este painel ou use o campo acima.
          </p>
        </div>
        <div class="sp-avatar-preview-wrap">
          <div class="card-head" style="border:1px solid var(--border-soft); border-bottom:none; font-size:10px;">
            preview
          </div>
          <div class="sp-avatar-preview" id="sp-av-preview">
            <span class="sp-av-placeholder">nenhuma imagem carregada</span>
          </div>
        </div>
      </div>
    </div>`;

  const fileInput = container.querySelector("#sp-av-file");
  const colsRange = container.querySelector("#sp-av-cols");
  const colsVal   = container.querySelector("#sp-av-cols-val");
  const colField  = container.querySelector("#sp-av-col-field");
  const preview   = container.querySelector("#sp-av-preview");

  function renderAscii() {
    if (!_currentImg) return;
    const cols = parseInt(colsRange.value, 10);
    colsVal.textContent = cols;
    const { ascii } = imageToAscii(_currentImg, { cols, ramp: ASCII_RAMPS["blocos"] });
    draft.avatar_ascii = ascii;

    if (!preview.querySelector("pre")) {
      preview.innerHTML = "";
      const pre = document.createElement("pre");
      pre.className = "sp-av-pre";
      preview.appendChild(pre);
    }
    const pre = preview.querySelector("pre");
    pre.textContent = ascii;
    try {
      fitAsciiText(pre, ascii, {
        container: preview,
        maxHeight: 220,
        maxFont: 14,
        minFont: 1,
        paddingX: 16,
        paddingY: 8,
      });
    } catch (_) {}
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        _currentImg = img;
        colField.style.display = "";
        renderAscii();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
  colsRange.addEventListener("input", renderAscii);

  // drag-and-drop na área de controles
  const ctrlArea = container.querySelector(".sp-avatar-controls");
  ctrlArea.addEventListener("dragover", (e) => { e.preventDefault(); ctrlArea.classList.add("sp-drag-over"); });
  ctrlArea.addEventListener("dragleave", () => ctrlArea.classList.remove("sp-drag-over"));
  ctrlArea.addEventListener("drop", (e) => {
    e.preventDefault();
    ctrlArea.classList.remove("sp-drag-over");
    loadFile(e.dataTransfer.files[0]);
  });
}

// ─── DOM do modal ─────────────────────────────────────────────────────────────

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "setup-modal";
  wrap.innerHTML = `
    <div class="modal sp-modal" role="dialog" aria-modal="true" aria-labelledby="sp-title">
      <div class="modal-head">
        <span class="sp-header-label">configuração inicial</span>
        <span class="sp-step-counter" id="sp-step-counter"></span>
      </div>
      <div class="modal-body sp-body">
        <h2 class="sp-title" id="sp-title"></h2>
        <div class="sp-content" id="sp-content"></div>
      </div>
      <div class="sp-footer">
        <button type="button" class="btn sp-btn-skip" id="sp-btn-skip">pular</button>
        <div class="sp-footer-right">
          <button type="button" class="btn sp-btn-prev" id="sp-btn-prev" style="display:none;">
            ← anterior
          </button>
          <button type="button" class="btn primary sp-btn-next" id="sp-btn-next" disabled>
            próximo →
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function renderStep(step) {
  const s = STEPS[step];
  const total = STEPS.length;

  modalEl.querySelector("#sp-step-counter").textContent = `${step + 1} / ${total}`;
  modalEl.querySelector("#sp-title").textContent = s.title;

  const content = modalEl.querySelector("#sp-content");
  s.build(content);

  const isLast = step === total - 1;

  const prevBtn = modalEl.querySelector("#sp-btn-prev");
  prevBtn.style.display = step === 0 ? "none" : "";

  const nextBtn = modalEl.querySelector("#sp-btn-next");
  nextBtn.textContent = isLast ? `${icon("check", { size: 12 })} concluir` : "próximo →";
  nextBtn.innerHTML  = isLast ? `${icon("check", { size: 12 })} concluir` : "próximo →";
  nextBtn.dataset.last = isLast ? "1" : "";

  syncNextBtn();
}

function syncNextBtn() {
  const nextBtn = modalEl?.querySelector("#sp-btn-next");
  if (!nextBtn) return;
  const step = STEPS[currentStep];
  // passo "nome" exige ao menos 1 caractere; os demais sempre habilitados
  if (step.id === "nome") {
    nextBtn.disabled = draft.display_name.length < 1;
  } else {
    nextBtn.disabled = false;
  }
}

function wireModal(wrap) {
  wrap.querySelector("#sp-btn-prev").addEventListener("click", () => {
    if (currentStep > 0) { currentStep--; renderStep(currentStep); }
  });

  wrap.querySelector("#sp-btn-next").addEventListener("click", () => {
    if (currentStep < STEPS.length - 1) {
      STEPS[currentStep].save();
      currentStep++;
      renderStep(currentStep);
    } else {
      finish();
    }
  });

  wrap.querySelector("#sp-btn-skip").addEventListener("click", () => {
    closeSetupModal();
  });
}

// ─── Persistência ─────────────────────────────────────────────────────────────

async function finish() {
  const nextBtn = modalEl.querySelector("#sp-btn-next");
  nextBtn.disabled = true;
  nextBtn.innerHTML = "salvando…";

  try {
    const updates = {};
    if (draft.display_name) updates.display_name = draft.display_name;
    if (draft.accent_color !== "#8fbf8f") updates.accent_color = draft.accent_color;
    if (Object.keys(updates).length > 0) {
      const updated = await updateProfile(updates);
      store.set("profile", { ...store.get("profile"), ...updated });
      // nome na sidebar
      const usernameEl = document.getElementById("sidebar-username");
      if (usernameEl && updated.display_name) usernameEl.textContent = updated.display_name;
      // cor no CSS
      document.documentElement.style.setProperty("--accent", updated.accent_color);
    }

    if (draft.avatar_ascii) {
      const profileWithAvatar = await updateAvatar(draft.avatar_ascii);
      store.set("profile", { ...store.get("profile"), ...profileWithAvatar });
      _applySidebarAvatar(draft.avatar_ascii); // atualiza sidebar sem reinício
    }
  } catch (err) {
    console.error("erro ao salvar setup:", err);
    // não bloqueia — o usuário pode reconfigurar depois no perfil
  }

  closeSetupModal();
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Abre o modal de setup de primeira vez.
 * @param {Function} onDone — chamado ao fechar (concluir ou pular).
 */
export function openSetupModal(onDoneCallback) {
  onDoneCb = onDoneCallback ?? null;
  modalEl = modalEl || buildModal();
  _currentImg = null;
  draft.display_name = "";
  draft.accent_color = "#8fbf8f";
  draft.avatar_ascii = null;
  currentStep = 0;
  renderStep(0);
  modalEl.classList.add("open");
}

function closeSetupModal() {
  if (!modalEl) return;
  modalEl.classList.remove("open");
  const cb = onDoneCb;
  onDoneCb = null;
  cb?.();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Atualiza o avatar na sidebar imediatamente após salvar,
 * sem precisar reiniciar o app. Espelha loadProfile() de app.js.
 */
function _applySidebarAvatar(ascii) {
  const el = document.getElementById("sidebar-avatar");
  if (!el) return;
  el.textContent = ascii;
  try {
    fitAsciiText(el, ascii, {
      container: el.parentElement,
      maxHeight: 25,
      maxFont: 3,
      minFont: 1,
      paddingX: 8,
      paddingY: 4,
    });
  } catch (_) {}
}

function escapeAttr(str) {
  return (str ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}