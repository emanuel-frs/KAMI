import { imageToAscii, fitAsciiText, ASCII_RAMPS } from "./ascii.js";

/**
 * Modal "avatar pessoal" (decisão 18 — modais são o padrão de
 * criação/edição do app; "editar o avatar" é citado explicitamente como
 * exemplo, então isso NÃO fica inline no widget de perfil). Reaproveita
 * o ascii-lab do protótipo (kami_telas_final.html): upload/drag&drop de
 * imagem, colunas ajustáveis, rampa de caracteres, inverter tons, preview
 * ao vivo — tudo local via <canvas>, nada sai da máquina.
 *
 * Singleton: o DOM do modal é construído uma vez (na primeira chamada de
 * openAvatarModal) e reaproveitado depois, em vez de recriar a cada abertura.
 */

let modalEl = null;
let onSaveCb = null;
let currentImg = null;
let lastAscii = "";

// tamanho da prévia na aba "ver" — .avatar-modal-view (base.css) tem
// min-height:320px e cresce livremente, então usamos um alvo bem maior
// que o antigo (260/10) pra realmente preencher o box em vez de deixar
// o avatar pequeno no meio de um espaço vazio (ver captura de tela).
// Mesmo objeto usado ao abrir o modal e logo após salvar, pra não ter
// dois tamanhos diferentes pro mesmo lugar.
const VER_TAB_FIT = { maxHeight: 480, maxFont: 26, paddingX: 40, paddingY: 40 };

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "avatar-modal";
  wrap.innerHTML = `
    <div class="modal wide">
      <div class="modal-head">
        avatar pessoal
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-tabs">
        <div class="modal-tab" data-tab="ver">ver</div>
        <div class="modal-tab" data-tab="editar">editar</div>
      </div>
      <div class="modal-body">
        <div class="modal-tab-panel" data-panel="ver">
          <div class="avatar-modal-view"><pre id="av-saved-preview"></pre></div>
        </div>
        <div class="modal-tab-panel" data-panel="editar">
          <div class="ascii-lab-grid">
            <div>
              <div class="al-drop" id="av-drop">
                <div class="field">
                  <label>foto (não é salva — só o resultado em texto)</label>
                  <input type="file" id="av-file" accept="image/*">
                </div>
                <div class="field">
                  <label>largura (colunas): <b id="av-cols-val" style="color:var(--text-bright);">70</b></label>
                  <input type="range" id="av-cols" min="30" max="120" value="70" style="accent-color:var(--accent); width:100%;">
                </div>
                <div class="field">
                  <label>rampa de caracteres</label>
                  <select id="av-ramp">
                    <option value="detalhada">detalhada</option>
                    <option value="simples">simples</option>
                    <option value="blocos" selected>blocos</option>
                    <option value="alto_contraste">alto contraste</option>
                  </select>
                </div>
                <label class="field" style="flex-direction:row; align-items:center; gap:8px;">
                  <input type="checkbox" id="av-invert" style="accent-color:var(--accent);"><span>inverter tons</span>
                </label>
                <p class="al-hint">arraste uma imagem sobre este painel ou use o campo acima. tudo roda local, via &lt;canvas&gt; — nada sai da máquina.</p>
                <button type="button" class="btn" style="margin-top:8px; width:100%;" data-action="save">✓ salvar como meu avatar</button>
              </div>
            </div>
            <div>
              <div class="card-head" style="border:1px solid var(--border-soft); border-bottom:none;">
                preview ao vivo <span id="av-dims" class="push" style="color:var(--text-faint);"></span>
              </div>
              <div class="ascii-output-wrap">
                <pre id="av-output" class="ascii-output">nenhuma imagem carregada ainda.

selecione um arquivo ou arraste
uma foto pra ver a conversão em
tempo real.</pre>
              </div>
            </div>
          </div>
          <canvas id="av-canvas" style="display:none;"></canvas>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function switchTab(wrap, tab) {
  wrap.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  wrap.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("on", p.dataset.panel === tab));
}

function wireModal(wrap) {
  const fileInput = wrap.querySelector("#av-file");
  const colsInput = wrap.querySelector("#av-cols");
  const colsVal = wrap.querySelector("#av-cols-val");
  const rampSelect = wrap.querySelector("#av-ramp");
  const invertChk = wrap.querySelector("#av-invert");
  const output = wrap.querySelector("#av-output");
  const dimsLabel = wrap.querySelector("#av-dims");
  const canvas = wrap.querySelector("#av-canvas");
  const dropZone = wrap.querySelector("#av-drop");
  const savedPreview = wrap.querySelector("#av-saved-preview");

  function render() {
    if (!currentImg) return;
    const { ascii, cols, rows } = imageToAscii(currentImg, {
      cols: parseInt(colsInput.value, 10),
      ramp: ASCII_RAMPS[rampSelect.value],
      invert: invertChk.checked,
      canvas,
    });
    lastAscii = ascii;
    output.textContent = ascii;
    dimsLabel.textContent = `· ${cols}×${rows} chars`;
    fitAsciiText(output, ascii, { container: output.parentElement, maxHeight: 340, maxFont: 9 });
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const img = new Image();
    img.onload = () => {
      currentImg = img;
      render();
    };
    img.src = URL.createObjectURL(file);
  }

  fileInput.addEventListener("change", (e) => loadFile(e.target.files[0]));
  colsInput.addEventListener("input", () => {
    colsVal.textContent = colsInput.value;
    render();
  });
  rampSelect.addEventListener("change", render);
  invertChk.addEventListener("change", render);

  new ResizeObserver(() => {
    if (lastAscii) fitAsciiText(output, lastAscii, { container: output.parentElement, maxHeight: 340, maxFont: 9 });
  }).observe(output.parentElement);

  ["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(file);
  });

  wrap.querySelector('[data-action="close"]').addEventListener("click", () => closeAvatarModal());
  wrap.querySelector('[data-action="save"]').addEventListener("click", async () => {
    if (!lastAscii) {
      alert("gere uma conversão antes de salvar (escolha uma imagem).");
      return;
    }
    try {
      await onSaveCb?.(lastAscii);
    } catch (err) {
      alert(`erro ao salvar avatar: ${err.message}`);
      return;
    }
    savedPreview.textContent = lastAscii;
    fitAsciiText(savedPreview, lastAscii, {
        container: savedPreview.parentElement,
        ...VER_TAB_FIT,
    });
    switchTab(wrap, "ver");
  });

  wrap.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", () => switchTab(wrap, t.dataset.tab)));

  // fecha clicando fora do modal (no backdrop), igual convenção do protótipo
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeAvatarModal();
  });
}

/**
 * Abre o modal de avatar.
 * @param {{ currentAscii?: string, onSave: (ascii: string) => Promise<void> }} opts
 *   onSave é chamado com o texto ASCII gerado quando o usuário clica em
 *   "salvar como meu avatar" — deve persistir via updateAvatar() da API
 *   e pode lançar erro (é tratado/mostrado aqui).
 */
export function openAvatarModal({ currentAscii, onSave } = {}) {
  try {
    modalEl = modalEl || buildModal();
    onSaveCb = onSave;

    // precisa ficar visível ANTES de medir o container em fitAsciiText —
    // .modal-backdrop só vira display:flex com .open, e um elemento
    // display:none tem clientWidth/clientHeight 0, o que fazia o cálculo
    // de fonte cair pro mínimo (avatar minúsculo na aba "ver").
    modalEl.classList.add("open");

    // troca de aba PRIMEIRO — o painel precisa estar display:block antes
    // de medir o conteúdo dele; senão, na primeiríssima abertura (antes
    // de qualquer switchTab ter marcado esse painel como .on) o cálculo
    // de fonte cai pro mínimo, igual o bug do modal inteiro escondido.
    switchTab(modalEl, currentAscii ? "ver" : "editar");

    const savedPreview = modalEl.querySelector("#av-saved-preview");
    if (currentAscii) {
      savedPreview.textContent = currentAscii;
      fitAsciiText(savedPreview, currentAscii, {
        container: savedPreview.parentElement,
        ...VER_TAB_FIT,
      });
    } else {
      savedPreview.textContent = 'nenhum avatar salvo ainda — vá em "editar" pra gerar um a partir de uma foto.';
      savedPreview.style.fontSize = "";
      savedPreview.style.lineHeight = "";
    }
  } catch (err) {
    // antes, qualquer erro aqui (ex: medição de canvas, DOM inesperado)
    // fazia o modal simplesmente não abrir, sem nenhum indício do motivo.
    console.error("erro ao abrir modal de avatar:", err);
  }
}

export function closeAvatarModal() {
  modalEl?.classList.remove("open");
}