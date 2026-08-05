/**
 * Modal de configurações — aberto pelo ícone de engrenagem no rodapé
 * da sidebar (fora de qualquer tela, ver ALINHAMENTO.md 2.1 do
 * alinhamento de UX). Mesmo padrão singleton dos outros modais (ver
 * err-modal.js).
 *
 * Três seções:
 *   - exportar dados: baixa um .json com o dump completo do banco
 *     (GET /api/system/export)
 *   - importar dados: sobrescreve TODAS as configurações e dados
 *     atuais com o conteúdo de um .json exportado antes (POST
 *     /api/system/import) — mesmo padrão de CONFIRMAÇÃO do reset
 *     (digitar uma palavra pra habilitar o botão + modal de
 *     confirmação explícito antes de executar), mas com um visual
 *     diferente (.settings-warning, âmbar) em vez do vermelho da
 *     zona de perigo: é uma sobrescrita, não um apagar-tudo
 *     definitivo. O modal de confirmação final (a última etapa antes
 *     de executar) segue vermelho igual ao do reset — é ali que o
 *     alerta "isso não tem volta" realmente importa.
 *   - zona de perigo: reset completo (POST /api/system/reset),
 *     exige digitar a palavra "excluir" pra habilitar o botão — o
 *     backend também exige essa palavra no corpo da requisição, então
 *     a validação do frontend é conveniência de UX, não a única
 *     barreira contra um reset acidental.
 */
import { exportData, importData, resetData } from "../api/system.js";
import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";

const RESET_WORD = "excluir";
const IMPORT_WORD = "importar";

let modalEl = null;
let busy = false;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "settings-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">configurações <span class="close" data-action="close">×</span></div>
      <div class="modal-body">
        <div class="settings-section">
          <h4>exportar dados</h4>
          <p class="settings-desc">baixa um arquivo .json com todos os seus dados (perfil, núcleo, finanças, aprendizado, organização, metas) — útil como backup antes de trocar de máquina ou reinstalar.</p>
          <div class="form-actions">
            <button class="btn sm" id="sm-export-btn" data-action="export">baixar backup (.json)</button>
          </div>
          <p class="settings-status" id="sm-export-status"></p>
        </div>
        <div class="settings-section settings-warning">
          <h4>importar dados</h4>
          <p class="settings-desc">restaura um backup .json exportado anteriormente. isso <strong>sobrescreve</strong> todas as suas configurações e dados atuais (perfil, núcleo, finanças, aprendizado, organização, metas) — não tem como desfazer depois.</p>
          <div class="field">
            <label>arquivo de backup (.json)</label>
            <input type="file" id="sm-import-file" accept="application/json,.json">
          </div>
          <div class="field">
            <label>digite <strong>${IMPORT_WORD}</strong> pra habilitar o botão abaixo</label>
            <input type="text" id="sm-import-confirm" placeholder="${IMPORT_WORD}" autocomplete="off">
          </div>
          <div class="form-actions">
            <button class="btn sm warn" id="sm-import-btn" data-action="import" disabled>importar e sobrescrever</button>
          </div>
          <p class="settings-status" id="sm-import-status"></p>
        </div>
        <div class="settings-section settings-danger">
          <h4>zona de perigo</h4>
          <p class="settings-desc">apaga TODOS os seus dados e devolve o Kami ao estado de instalação nova. não tem como desfazer — exporte um backup antes, se quiser guardar algo.</p>
          <div class="field">
            <label>digite <strong>${RESET_WORD}</strong> pra habilitar o botão abaixo</label>
            <input type="text" id="sm-reset-confirm" placeholder="${RESET_WORD}" autocomplete="off">
          </div>
          <div class="form-actions">
            <button class="btn sm danger" id="sm-reset-btn" data-action="reset" disabled>limpar todos os dados</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) =>
    el.addEventListener("click", () => { if (!busy) closeSettingsModal(); })
  );
  wrap.addEventListener("click", (e) => { if (e.target === wrap && !busy) closeSettingsModal(); });

  const importFile = wrap.querySelector("#sm-import-file");
  const importConfirmInput = wrap.querySelector("#sm-import-confirm");
  const importBtn = wrap.querySelector("#sm-import-btn");
  const updateImportBtn = () => {
    const wordOk = importConfirmInput.value.trim().toLowerCase() === IMPORT_WORD;
    const fileOk = importFile.files.length > 0;
    importBtn.disabled = !(wordOk && fileOk);
  };
  importFile.addEventListener("change", updateImportBtn);
  importConfirmInput.addEventListener("input", updateImportBtn);

  const confirmInput = wrap.querySelector("#sm-reset-confirm");
  const resetBtn = wrap.querySelector("#sm-reset-btn");
  confirmInput.addEventListener("input", () => {
    resetBtn.disabled = confirmInput.value.trim().toLowerCase() !== RESET_WORD;
  });

  wrap.querySelector("#sm-export-btn").addEventListener("click", () => handleExport(wrap));
  importBtn.addEventListener("click", () => handleImport(wrap));
  resetBtn.addEventListener("click", () => handleReset(wrap));
}

async function handleExport(wrap) {
  if (busy) return;
  const btn = wrap.querySelector("#sm-export-btn");
  const statusEl = wrap.querySelector("#sm-export-status");
  const originalLabel = btn.textContent;
  busy = true;
  btn.disabled = true;
  btn.textContent = "gerando...";
  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  try {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    const filename = `kami-backup-${today}.json`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusEl.textContent = `✓ salvo como ${filename} (confira sua pasta de downloads)`;
    statusEl.classList.add("settings-status--visible");
  } catch (err) {
    showErrorModal(err.message, "erro ao exportar dados");
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error("o arquivo selecionado não é um .json válido"));
      }
    };
    reader.onerror = () => reject(new Error("não foi possível ler o arquivo selecionado"));
    reader.readAsText(file);
  });
}

async function handleImport(wrap) {
  if (busy) return;
  const fileInput = wrap.querySelector("#sm-import-file");
  const confirmInput = wrap.querySelector("#sm-import-confirm");
  const importBtn = wrap.querySelector("#sm-import-btn");
  const statusEl = wrap.querySelector("#sm-import-status");
  const file = fileInput.files[0];
  const confirmation = confirmInput.value.trim().toLowerCase();
  if (!file || confirmation !== IMPORT_WORD) return; // botão já deveria estar disabled, defesa extra

  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  let parsed;
  try {
    parsed = await readFileAsJson(file);
  } catch (err) {
    showErrorModal(err.message, "erro ao importar dados");
    return;
  }
  if (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object") {
    showErrorModal("o arquivo selecionado não parece ser um backup válido do Kami (formato inesperado).", "erro ao importar dados");
    return;
  }

  const reallySure = await showConfirmModal(
    "isso sobrescreve TODAS as suas configurações e dados atuais (perfil, núcleo, finanças, aprendizado, organização, metas) com o conteúdo desse arquivo, e não tem como desfazer. tem certeza?",
    { title: "confirmar importação", confirmText: "sim, sobrescrever tudo", danger: true }
  );
  if (!reallySure) return;

  busy = true;
  fileInput.disabled = true;
  confirmInput.disabled = true;
  importBtn.disabled = true;
  importBtn.textContent = "importando...";

  try {
    await importData(confirmation, parsed.tables);
    // recarrega o app inteiro em vez de tentar resetar o estado em
    // memória de cada tela na mão (store.js, widgets já montados
    // etc.) — garante que tudo volte a buscar do backend já com os
    // dados importados.
    window.location.reload();
  } catch (err) {
    showErrorModal(err.message, "erro ao importar dados");
    busy = false;
    fileInput.disabled = false;
    confirmInput.disabled = false;
    importBtn.disabled = false;
    importBtn.textContent = "importar e sobrescrever";
  }
}

async function handleReset(wrap) {
  if (busy) return;
  const confirmInput = wrap.querySelector("#sm-reset-confirm");
  const resetBtn = wrap.querySelector("#sm-reset-btn");
  const confirmation = confirmInput.value.trim().toLowerCase();
  if (confirmation !== RESET_WORD) return; // botão já deveria estar disabled, defesa extra

  const reallySure = await showConfirmModal(
    "isso apaga TODOS os seus dados (perfil, núcleo, finanças, aprendizado, organização, metas) e não tem como desfazer. tem certeza?",
    { title: "confirmar reset completo", confirmText: "sim, apagar tudo", danger: true }
  );
  if (!reallySure) return;

  busy = true;
  confirmInput.disabled = true;
  resetBtn.disabled = true;
  resetBtn.textContent = "limpando...";

  try {
    await resetData(confirmation);
    // recarrega o app inteiro em vez de tentar resetar o estado em
    // memória de cada tela na mão (store.js, widgets já montados
    // etc.) — garante que tudo volte a buscar do backend já limpo.
    window.location.reload();
  } catch (err) {
    showErrorModal(err.message, "erro ao limpar dados");
    busy = false;
    confirmInput.disabled = false;
    resetBtn.disabled = false;
    resetBtn.textContent = "limpar todos os dados";
  }
}

export function openSettingsModal() {
  modalEl = modalEl || buildModal();

  const confirmInput = modalEl.querySelector("#sm-reset-confirm");
  const resetBtn = modalEl.querySelector("#sm-reset-btn");
  const exportStatusEl = modalEl.querySelector("#sm-export-status");
  confirmInput.value = "";
  resetBtn.disabled = true;
  exportStatusEl.textContent = "";
  exportStatusEl.classList.remove("settings-status--visible");

  const importFile = modalEl.querySelector("#sm-import-file");
  const importConfirmInput = modalEl.querySelector("#sm-import-confirm");
  const importBtn = modalEl.querySelector("#sm-import-btn");
  const importStatusEl = modalEl.querySelector("#sm-import-status");
  importFile.value = "";
  importConfirmInput.value = "";
  importBtn.disabled = true;
  importStatusEl.textContent = "";
  importStatusEl.classList.remove("settings-status--visible");

  modalEl.classList.add("open");
}

export function closeSettingsModal() {
  modalEl?.classList.remove("open");
}