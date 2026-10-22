/**
 * Aba "backup e dados" das configurações: exportar (com ou sem senha,
 * SEG-03), importar, revisão do xp e apagar tudo.
 * MAN-02: saiu de configuracoes-modal.js.
 */
import { exportData, exportProtegido, importData, importProtegido, resetData } from "../../api/sistema.js";
import { applyXpReview, previewXpReview } from "../../api/nucleo.js";
import { showToast } from "../../components/toast.js";
import { escapeHtml, localDateKey } from "../../components/format.js";
import { showErrorModal } from "../err-modal.js";
import { showConfirmModal } from "../confirm-modal.js";
import { icon } from "../../components/icons.js";
import { estado } from "./estado.js";

const RESET_WORD = "excluir";
const SENHA_BACKUP_MIN = 8; // = SENHA_MIN em app/backup_cifrado.py
const IMPORT_WORD = "importar";
// SEG-03: backup escolhido no import, já lido (pra saber se pede senha)
let importParsed = null;

export function buildBackupPanel() {
  return `
    <div class="cfg-panel" data-panel="backup">
      <div class="settings-section" style="padding-top:0;">
        <h4>exportar dados</h4>
        <p class="settings-desc">baixa um arquivo .json com todos os seus dados (perfil, núcleo, finanças, aprendizado, organização, metas) — útil como backup antes de trocar de máquina ou reinstalar.</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="sm-export-protect" checked>
          <span>proteger com senha<small>o arquivo só abre com a senha, e leva junto as senhas salvas (e-mail, github, busca) — funciona em outro computador</small></span>
        </label>
        <div id="sm-export-protect-fields">
          <div class="field"><label for="sm-export-senha">senha (mínimo ${SENHA_BACKUP_MIN} caracteres)</label><input type="password" id="sm-export-senha" autocomplete="new-password" maxlength="200"></div>
          <div class="field"><label for="sm-export-senha2">repita a senha</label><input type="password" id="sm-export-senha2" autocomplete="new-password" maxlength="200"></div>
          <p class="settings-note">sem a senha o arquivo não abre — nem o kami consegue recuperar. guarde a senha num lugar seguro.</p>
        </div>
        <p class="settings-note cfg-export-aviso" id="sm-export-unprotected-note" hidden>sem senha, qualquer pessoa com o arquivo lê todos os seus dados (finanças, e-mails, anotações) — e as senhas salvas não funcionam em outro computador.</p>
        <div class="form-actions">
          <button class="btn sm" id="sm-export-btn" data-action="export">baixar backup (.json)</button>
        </div>
        <p class="settings-status" id="sm-export-status"></p>
      </div>
      <div class="settings-section">
        <h4>revisar xp</h4>
        <p class="settings-desc">corrige o xp gravado antes das regras atuais: registros que sobraram de ações desfeitas (pagamento desmarcado, item apagado, marco reaberto), repetições no mesmo dia do que hoje só rende xp 1x por dia e ações manuais acima de 50 xp. primeiro mostra o que mudaria — nada é gravado até você confirmar.</p>
        <p class="settings-note">antes de aplicar, uma cópia completa do banco é guardada na pasta de dados do kami.</p>
        <div class="form-actions">
          <button class="btn sm" id="sm-xpreview-btn" data-action="xp-review-preview">simular revisão</button>
        </div>
        <div class="xp-review-report" id="sm-xpreview-report" hidden></div>
      </div>
      <div class="settings-section settings-warning">
        <h4>importar dados</h4>
        <p class="settings-desc">restaura um backup .json exportado anteriormente. isso <strong>sobrescreve</strong> todas as suas configurações e dados atuais (perfil, núcleo, finanças, aprendizado, organização, metas) — não tem como desfazer depois.</p>
        <p class="settings-note">backup <strong>com senha</strong> traz também as senhas salvas (e-mail, github, busca), em qualquer computador. backup <strong>sem senha</strong> de outra máquina restaura o resto, mas essas senhas precisam ser cadastradas de novo em configurações › chaves.</p>
        <div class="field">
          <label for="sm-import-file">arquivo de backup (.json)</label>
          <input type="file" id="sm-import-file" accept="application/json,.json">
        </div>
        <div class="field" id="sm-import-senha-field" hidden>
          <label for="sm-import-senha">${icon("shield", { size: 12 })} backup protegido — senha</label>
          <input type="password" id="sm-import-senha" autocomplete="current-password" maxlength="200">
        </div>
        <div class="field">
          <label for="sm-import-confirm">digite <strong>${IMPORT_WORD}</strong> pra habilitar o botão abaixo</label>
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
          <label for="sm-reset-confirm">digite <strong>${RESET_WORD}</strong> pra habilitar o botão abaixo</label>
          <input type="text" id="sm-reset-confirm" placeholder="${RESET_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm danger" id="sm-reset-btn" data-action="reset" disabled>limpar todos os dados</button>
        </div>
      </div>
    </div>`;
}

// ── aba backup e dados ───────────────────────────────────────────────
export function wireBackupTab(wrap) {
  const importFile = wrap.querySelector("#sm-import-file");
  const importConfirmInput = wrap.querySelector("#sm-import-confirm");
  const importBtn = wrap.querySelector("#sm-import-btn");
  const importSenhaField = wrap.querySelector("#sm-import-senha-field");
  const importSenha = wrap.querySelector("#sm-import-senha");
  const updateImportBtn = () => {
    const wordOk = importConfirmInput.value.trim().toLowerCase() === IMPORT_WORD;
    const fileOk = importFile.files.length > 0;
    const senhaOk = importSenhaField.hidden || importSenha.value.length > 0;
    importBtn.disabled = !(wordOk && fileOk && senhaOk);
  };
  // SEG-03: lê o arquivo ao escolher, pra saber já se ele pede senha
  importFile.addEventListener("change", async () => {
    importParsed = null;
    importSenhaField.hidden = true;
    importSenha.value = "";
    const file = importFile.files[0];
    if (file) {
      try {
        importParsed = await readFileAsJson(file);
        importSenhaField.hidden = !importParsed?.kami_backup_cifrado;
      } catch {
        importParsed = null; // o handleImport mostra o erro de leitura
      }
    }
    updateImportBtn();
  });
  importConfirmInput.addEventListener("input", updateImportBtn);
  importSenha.addEventListener("input", updateImportBtn);

  const protect = wrap.querySelector("#sm-export-protect");
  protect.addEventListener("change", () => {
    wrap.querySelector("#sm-export-protect-fields").hidden = !protect.checked;
    wrap.querySelector("#sm-export-unprotected-note").hidden = protect.checked;
  });

  const confirmInput = wrap.querySelector("#sm-reset-confirm");
  const resetBtn = wrap.querySelector("#sm-reset-btn");
  confirmInput.addEventListener("input", () => {
    resetBtn.disabled = confirmInput.value.trim().toLowerCase() !== RESET_WORD;
  });

  wrap.querySelector("#sm-export-btn").addEventListener("click", () => handleExport(wrap));
  wrap.querySelector("#sm-xpreview-btn").addEventListener("click", () => handleXpReviewPreview(wrap));
  importBtn.addEventListener("click", () => handleImport(wrap));
  resetBtn.addEventListener("click", () => handleReset(wrap));
}

async function handleExport(wrap) {
  if (estado.busy) return;
  const btn = wrap.querySelector("#sm-export-btn");
  const statusEl = wrap.querySelector("#sm-export-status");
  const originalLabel = btn.textContent;
  estado.busy = true;
  btn.disabled = true;
  btn.textContent = "gerando...";
  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  const protegido = wrap.querySelector("#sm-export-protect").checked;
  const senhaInput = wrap.querySelector("#sm-export-senha");
  const senha2Input = wrap.querySelector("#sm-export-senha2");
  const senhaErro = protegido && (
    senhaInput.value.length < SENHA_BACKUP_MIN ? `a senha precisa de pelo menos ${SENHA_BACKUP_MIN} caracteres`
      : senhaInput.value !== senha2Input.value ? "as duas senhas não são iguais"
        : ""
  );
  if (senhaErro) {
    statusEl.textContent = senhaErro;
    statusEl.classList.add("settings-status--visible");
    estado.busy = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
    (senhaInput.value.length < SENHA_BACKUP_MIN ? senhaInput : senha2Input).focus();
    return;
  }

  try {
    let data;
    let fora = 0;
    if (protegido) {
      const res = await exportProtegido(senhaInput.value);
      data = res.arquivo;
      fora = res.segredos_fora;
      senhaInput.value = "";
      senha2Input.value = "";
    } else {
      data = await exportData();
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = localDateKey();
    const filename = protegido ? `kami-backup-${today}-protegido.json` : `kami-backup-${today}.json`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusEl.innerHTML = `${icon("check", { size: 12 })} salvo como ${filename} (confira sua pasta de downloads)` +
      (fora ? ` — ${fora === 1 ? "1 senha salva não pôde ser lida e ficou" : `${fora} senhas salvas não puderam ser lidas e ficaram`} de fora (veja configurações › segurança)` : "");
    statusEl.classList.add("settings-status--visible");

    // confirmação visível mesmo se o usuário já tiver trocado de aba/fechado
    // o modal antes de reparar no status inline acima — ponto levantado na
    // auditoria (download acontece em silêncio, sem feedback destacado).
    // Sem integração de diálogo "salvar como" nativo do Tauri no projeto
    // (só existe o plugin de abrir URL externa, ver open-external.js), então
    // o toast simples resolve — o navegador/webview decide onde salvar.
    showToast({
      title: "backup salvo",
      message: `${filename} — confira sua pasta de downloads`,
      iconName: "check",
    });
  } catch (err) {
    showErrorModal(err.message, "erro ao exportar dados");
  } finally {
    estado.busy = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

const XP_REVIEW_LIST_LIMIT = 12;

function renderXpReviewReport(report) {
  const changedAttrs = report.atributos.filter((a) => a.xp_antes !== a.xp_depois);
  const nothing =
    !report.removidos.length && !report.limitados.length && !changedAttrs.length && !report.vinculados &&
    !report.conquistas_rebloqueadas.length && !report.conquistas_desbloqueadas.length;
  if (nothing) {
    return '<p class="settings-desc">nada a corrigir — seu xp já está consistente.</p>';
  }

  const lines = [];
  lines.push(
    `<p class="settings-desc">${report.removidos.length} registro(s) removido(s) · ${report.vinculados} vinculado(s) ao item de origem · ${report.limitados.length} ação(ões) manual(is) limitada(s) a 50 xp</p>`
  );
  if (changedAttrs.length) {
    lines.push(
      `<ul class="xp-review-list">${changedAttrs
        .map((a) => `<li><span>${escapeHtml(a.nome)}</span><span>${a.xp_antes} → ${a.xp_depois} xp</span></li>`)
        .join("")}</ul>`
    );
  }
  if (report.conquistas_rebloqueadas.length) {
    lines.push(`<p class="settings-note">voltam a ficar bloqueadas: ${report.conquistas_rebloqueadas.map(escapeHtml).join(", ")}</p>`);
  }
  if (report.conquistas_desbloqueadas.length) {
    lines.push(`<p class="settings-note">serão desbloqueadas: ${report.conquistas_desbloqueadas.map(escapeHtml).join(", ")}</p>`);
  }
  if (report.removidos.length) {
    const shown = report.removidos.slice(0, XP_REVIEW_LIST_LIMIT);
    const rest = report.removidos.length - shown.length;
    lines.push(
      `<ul class="xp-review-list xp-review-list--removed">${shown
        .map((r) => `<li><span>${escapeHtml(r.description)}</span><span>−${r.xp} xp · ${escapeHtml(r.motivo)}</span></li>`)
        .join("")}${rest > 0 ? `<li class="xp-review-more">+${rest} outro(s)</li>` : ""}</ul>`
    );
  }
  lines.push(`
    <div class="form-actions">
      <button class="btn sm warn" id="sm-xpreview-apply" data-action="xp-review-apply">aplicar revisão</button>
    </div>`);
  return lines.join("");
}

async function handleXpReviewPreview(wrap) {
  if (estado.busy) return;
  const btn = wrap.querySelector("#sm-xpreview-btn");
  const reportEl = wrap.querySelector("#sm-xpreview-report");
  estado.busy = true;
  btn.disabled = true;
  btn.textContent = "simulando...";
  try {
    const report = await previewXpReview();
    reportEl.innerHTML = renderXpReviewReport(report);
    reportEl.hidden = false;
    reportEl.querySelector("#sm-xpreview-apply")?.addEventListener("click", () => handleXpReviewApply(wrap));
  } catch (err) {
    showErrorModal(err.message, "erro ao simular a revisão de xp");
  } finally {
    estado.busy = false;
    btn.disabled = false;
    btn.textContent = "simular revisão";
  }
}

async function handleXpReviewApply(wrap) {
  if (estado.busy) return;
  const reallySure = await showConfirmModal(
    "isso remove os registros listados e recalcula o xp de cada atributo a partir do log. uma cópia do banco é guardada antes, na pasta de dados do kami. continuar?",
    { title: "aplicar revisão de xp", confirmText: "sim, revisar" }
  );
  if (!reallySure) return;

  const applyBtn = wrap.querySelector("#sm-xpreview-apply");
  estado.busy = true;
  applyBtn.disabled = true;
  applyBtn.textContent = "aplicando...";
  try {
    const report = await applyXpReview();
    showToast({
      title: "xp revisado",
      message: `cópia do banco anterior: ${report.backup}`,
      iconName: "check",
      duration: 12000,
    });
    // mesmo motivo de handleImport: xp/níveis/conquistas mudam em todas as
    // telas de uma vez — recarregar é mais seguro que atualizar cada widget
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    showErrorModal(err.message, "erro ao aplicar a revisão de xp");
    estado.busy = false;
    applyBtn.disabled = false;
    applyBtn.textContent = "aplicar revisão";
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
  if (estado.busy) return;
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
    parsed = importParsed ?? (await readFileAsJson(file));
  } catch (err) {
    showErrorModal(err.message, "erro ao importar dados");
    return;
  }
  const protegido = Boolean(parsed?.kami_backup_cifrado);
  const senhaInput = wrap.querySelector("#sm-import-senha");
  if (!protegido && (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object")) {
    showErrorModal("o arquivo selecionado não parece ser um backup válido do Kami (formato inesperado).", "erro ao importar dados");
    return;
  }

  const reallySure = await showConfirmModal(
    "isso sobrescreve TODAS as suas configurações e dados atuais (perfil, núcleo, finanças, aprendizado, organização, metas) com o conteúdo desse arquivo, e não tem como desfazer. tem certeza?",
    { title: "confirmar importação", confirmText: "sim, sobrescrever tudo", danger: true }
  );
  if (!reallySure) return;

  estado.busy = true;
  fileInput.disabled = true;
  confirmInput.disabled = true;
  senhaInput.disabled = true;
  importBtn.disabled = true;
  importBtn.textContent = "importando...";

  try {
    if (protegido) await importProtegido(confirmation, parsed, senhaInput.value);
    else await importData(confirmation, parsed.tables);
    // recarrega o app inteiro em vez de tentar resetar o estado em
    // memória de cada tela na mão (store.js, widgets já montados
    // etc.) — garante que tudo volte a buscar do backend já com os
    // dados importados.
    window.location.reload();
  } catch (err) {
    showErrorModal(err.message, "erro ao importar dados");
    estado.busy = false;
    fileInput.disabled = false;
    confirmInput.disabled = false;
    senhaInput.disabled = false;
    importBtn.disabled = false;
    importBtn.textContent = "importar e sobrescrever";
  }
}

async function handleReset(wrap) {
  if (estado.busy) return;
  const confirmInput = wrap.querySelector("#sm-reset-confirm");
  const resetBtn = wrap.querySelector("#sm-reset-btn");
  const confirmation = confirmInput.value.trim().toLowerCase();
  if (confirmation !== RESET_WORD) return; // botão já deveria estar disabled, defesa extra

  const reallySure = await showConfirmModal(
    "isso apaga TODOS os seus dados (perfil, núcleo, finanças, aprendizado, organização, metas) e não tem como desfazer. tem certeza?",
    { title: "confirmar reset completo", confirmText: "sim, apagar tudo", danger: true }
  );
  if (!reallySure) return;

  estado.busy = true;
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
    estado.busy = false;
    confirmInput.disabled = false;
    resetBtn.disabled = false;
    resetBtn.textContent = "limpar todos os dados";
  }
}
