import { imageToAscii, fitAsciiText, ASCII_RAMPS, loadImageFile } from "../components/ascii.js";
import { showErrorModal } from "./err-modal.js";
import { enhanceSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { noIdiomaAtual, t } from "../i18n.js";

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
let onCloseCb = null;
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
        ${t("avatar.avatar_pessoal")}
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="modal-tabs">
        <div class="modal-tab" data-tab="ver">${t("avatar.ver")}</div>
        <div class="modal-tab" data-tab="editar">${t("geral.editar")}</div>
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
                  <label for="av-file">${t("avatar.foto_nao_e_salva_so")}</label>
                  <input type="file" id="av-file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/*,.png,.jpg,.jpeg,.gif,.webp,.bmp">
                </div>
                <div class="field">
                  <label for="av-cols">${t("avatar.largura_colunas")} <b id="av-cols-val" style="color:var(--text-bright);">70</b></label>
                  <input type="range" id="av-cols" min="30" max="120" value="70" style="accent-color:var(--accent); width:100%;">
                </div>
                <div class="field">
                  <label for="av-ramp">${t("avatar.rampa_de_caracteres")}</label>
                  <select id="av-ramp">
                    <option value="detalhada">${t("avatar.detalhada")}</option>
                    <option value="simples">${t("avatar.simples")}</option>
                    <option value="blocos" selected>${t("avatar.blocos")}</option>
                    <option value="alto_contraste">${t("avatar.alto_contraste")}</option>
                  </select>
                </div>
                <label class="field" style="flex-direction:row; align-items:center; gap:8px;">
                  <input type="checkbox" id="av-invert" style="accent-color:var(--accent);"><span>${t("avatar.inverter_tons")}</span>
                </label>
                <p class="al-hint">${t("avatar.arraste_uma_imagem_sobre_este")}</p>
                <button type="button" class="btn" style="margin-top:8px; width:100%; display:flex; align-items:center; justify-content:center; gap:6px;" data-action="save">${icon("check", { size: 13 })} ${t("avatar.salvar_como_meu_avatar")}</button>
              </div>
            </div>
            <div>
              <div class="card-head" style="border:1px solid var(--border-soft); border-bottom:none;">
                ${t("avatar.preview_ao_vivo")} <span id="av-dims" class="push" style="color:var(--text-faint);"></span>
              </div>
              <div class="ascii-output-wrap">
                <pre id="av-output" class="ascii-output">${t("avatar.nenhuma_imagem_carregada_ainda_selecione")}</pre>
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
  enhanceSelect(wrap.querySelector("#av-ramp"));
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
    loadImageFile(file, {
      onLoad: (img) => {
        currentImg = img;
        render();
      },
      onInvalid: () => showErrorModal(t("avatar.nao_consegui_abrir_esse_arquivo"), t("geral.atencao")),
    });
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
      showErrorModal(t("avatar.gere_uma_conversao_antes_de"), t("geral.atencao"));
      return;
    }
    try {
      await onSaveCb?.(lastAscii);
    } catch (err) {
      showErrorModal(err.message, t("avatar.erro_ao_salvar_avatar"));
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
 * @param {{ currentAscii?: string, onSave: (ascii: string) => Promise<void>, onClose?: () => void }} opts
 *   onSave é chamado com o texto ASCII gerado quando o usuário clica em
 *   "salvar como meu avatar" — deve persistir via updateAvatar() da API
 *   e pode lançar erro (é tratado/mostrado aqui).
 *   onClose (opcional) é chamado uma vez, sempre que o modal fecha (X,
 *   clique fora ou Esc) — usado por quem abre este modal por cima de
 *   outro (ex: settings-modal.js fechando/reabrindo a si mesmo, ver
 *   comentário no topo do arquivo) pra saber a hora de voltar.
 */
export function openAvatarModal({ currentAscii, onSave, onClose } = {}) {
  try {
    modalEl = noIdiomaAtual(modalEl, buildModal);
    onSaveCb = onSave;
    onCloseCb = onClose ?? null;

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
      savedPreview.textContent = t("avatar.nenhum_avatar_salvo_ainda_va");
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
  // dispara uma única vez por abertura — evita chamar de novo numa
  // futura abertura sem onClose (ex: atalho do widget de perfil, que
  // não passa essa opção).
  const cb = onCloseCb;
  onCloseCb = null;
  cb?.();
}