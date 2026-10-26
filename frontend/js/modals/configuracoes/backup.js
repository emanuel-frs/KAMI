/**
 * Aba "backup e dados" das configurações: exportar (com ou sem senha,
 * SEG-03), importar, revisão do xp, apagar tudo e remover tudo do
 * computador (DIST-03, remover.js).
 * MAN-02: saiu de configuracoes-modal.js.
 */
import { exportData, exportProtegido, importData, importProtegido, resetData } from "../../api/sistema.js";
import { applyXpReview, previewXpReview } from "../../api/nucleo.js";
import { showToast } from "../../components/toast.js";
import { escapeHtml, localDateKey } from "../../components/format.js";
import { showErrorModal } from "../err-modal.js";
import { showConfirmModal } from "../confirm-modal.js";
import { icon } from "../../components/icons.js";
import { copiasSectionHtml, wireCopias } from "./copias.js";
import { removerSectionHtml, wireRemover } from "./remover.js";
import { estado } from "./estado.js";
import { t } from "../../i18n.js";

const RESET_WORD = "excluir";
const SENHA_BACKUP_MIN = 8; // = SENHA_MIN em app/backup_cifrado.py
const IMPORT_WORD = "importar";
// SEG-03: backup escolhido no import, já lido (pra saber se pede senha)
let importParsed = null;

export function buildBackupPanel() {
  return `
    <div class="cfg-panel" data-panel="backup">
      <div class="settings-section" style="padding-top:0;">
        <h4>${t("backup.exportar_dados")}</h4>
        <p class="settings-desc">${t("backup.baixa_um_arquivo_json_com")}</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="sm-export-protect" checked>
          <span>${t("backup.proteger_com_senha")}<small>${t("backup.o_arquivo_so_abre_com")}</small></span>
        </label>
        <div id="sm-export-protect-fields">
          <div class="field"><label for="sm-export-senha">${t("backup.senha_minimo", { n: SENHA_BACKUP_MIN })}</label><input type="password" id="sm-export-senha" autocomplete="new-password" maxlength="200"></div>
          <div class="field"><label for="sm-export-senha2">${t("backup.repita_a_senha")}</label><input type="password" id="sm-export-senha2" autocomplete="new-password" maxlength="200"></div>
          <p class="settings-note">${t("backup.sem_a_senha_o_arquivo")}</p>
        </div>
        <p class="settings-note cfg-export-aviso" id="sm-export-unprotected-note" hidden>${t("backup.sem_senha_qualquer_pessoa_com")}</p>
        <div class="form-actions">
          <button class="btn sm" id="sm-export-btn" data-action="export">${t("backup.baixar_backup_json")}</button>
        </div>
        <p class="settings-status" id="sm-export-status"></p>
      </div>
      ${copiasSectionHtml()}
      <div class="settings-section">
        <h4>${t("backup.revisar_xp")}</h4>
        <p class="settings-desc">${t("backup.corrige_o_xp_gravado_antes")}</p>
        <p class="settings-note">${t("backup.antes_de_aplicar_uma_copia")}</p>
        <div class="form-actions">
          <button class="btn sm" id="sm-xpreview-btn" data-action="xp-review-preview">${t("backup.simular_revisao")}</button>
        </div>
        <div class="xp-review-report" id="sm-xpreview-report" hidden></div>
      </div>
      <div class="settings-section settings-warning">
        <h4>${t("backup.importar_dados")}</h4>
        <p class="settings-desc">${t("backup.import_desc")}</p>
        <p class="settings-note">${t("backup.import_nota")}</p>
        <div class="field">
          <label for="sm-import-file">${t("backup.arquivo_de_backup_json")}</label>
          <input type="file" id="sm-import-file" accept="application/json,.json">
        </div>
        <div class="field" id="sm-import-senha-field" hidden>
          <label for="sm-import-senha">${icon("shield", { size: 12 })} ${t("backup.backup_protegido_senha")}</label>
          <input type="password" id="sm-import-senha" autocomplete="current-password" maxlength="200">
        </div>
        <div class="field">
          <label for="sm-import-confirm">${t("geral.digite_pra_habilitar", { palavra: `<strong>${IMPORT_WORD}</strong>` })}</label>
          <input type="text" id="sm-import-confirm" placeholder="${IMPORT_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm warn" id="sm-import-btn" data-action="import" disabled>${t("backup.importar_e_sobrescrever")}</button>
        </div>
        <p class="settings-status" id="sm-import-status"></p>
      </div>
      <div class="settings-section settings-danger">
        <h4>${t("backup.zona_de_perigo")}</h4>
        <p class="settings-desc">${t("backup.apaga_todos_os_seus_dados")}</p>
        <div class="field">
          <label for="sm-reset-confirm">${t("geral.digite_pra_habilitar", { palavra: `<strong>${RESET_WORD}</strong>` })}</label>
          <input type="text" id="sm-reset-confirm" placeholder="${RESET_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm danger" id="sm-reset-btn" data-action="reset" disabled>${t("backup.limpar_todos_os_dados")}</button>
        </div>
      </div>${removerSectionHtml()}
    </div>`;
}

// ── aba backup e dados ───────────────────────────────────────────────
export function wireBackupTab(wrap) {
  wireCopias(wrap); // CONF-08
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
  wireRemover(wrap, { exportar: () => handleExport(wrap) }); // DIST-03
}

async function handleExport(wrap) {
  if (estado.busy) return;
  const btn = wrap.querySelector("#sm-export-btn");
  const statusEl = wrap.querySelector("#sm-export-status");
  const originalLabel = btn.textContent;
  estado.busy = true;
  btn.disabled = true;
  btn.textContent = t("backup.gerando");
  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  const protegido = wrap.querySelector("#sm-export-protect").checked;
  const senhaInput = wrap.querySelector("#sm-export-senha");
  const senha2Input = wrap.querySelector("#sm-export-senha2");
  const senhaErro = protegido && (
    senhaInput.value.length < SENHA_BACKUP_MIN ? t("backup.senha_curta", { n: SENHA_BACKUP_MIN })
      : senhaInput.value !== senha2Input.value ? t("backup.as_duas_senhas_nao_sao")
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

    statusEl.innerHTML = `${icon("check", { size: 12 })} ${escapeHtml(t("backup.salvo_como", { arquivo: filename }))}` +
      (fora ? escapeHtml(t("backup.senhas_fora", { n: fora })) : "");
    statusEl.classList.add("settings-status--visible");

    // confirmação visível mesmo se o usuário já tiver trocado de aba/fechado
    // o modal antes de reparar no status inline acima — ponto levantado na
    // auditoria (download acontece em silêncio, sem feedback destacado).
    // Sem integração de diálogo "salvar como" nativo do Tauri no projeto
    // (só existe o plugin de abrir URL externa, ver open-external.js), então
    // o toast simples resolve — o navegador/webview decide onde salvar.
    showToast({
      title: t("backup.backup_salvo"),
      message: t("backup.confira_downloads", { arquivo: filename }),
      iconName: "check",
    });
  } catch (err) {
    showErrorModal(err.message, t("backup.erro_ao_exportar_dados"));
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
    return `<p class="settings-desc">${t("backup.nada_a_corrigir_seu_xp")}</p>`;
  }

  const lines = [];
  lines.push(
    `<p class="settings-desc">${t("backup.revisao_resumo", { removidos: report.removidos.length, vinculados: report.vinculados, limitados: report.limitados.length })}</p>`
  );
  if (changedAttrs.length) {
    lines.push(
      `<ul class="xp-review-list">${changedAttrs
        .map((a) => `<li><span>${escapeHtml(a.nome)}</span><span>${a.xp_antes} → ${a.xp_depois} ${t("backup.xp")}</span></li>`)
        .join("")}</ul>`
    );
  }
  if (report.conquistas_rebloqueadas.length) {
    lines.push(`<p class="settings-note">${t("backup.rebloqueadas", { lista: report.conquistas_rebloqueadas.map(escapeHtml).join(", ") })}</p>`);
  }
  if (report.conquistas_desbloqueadas.length) {
    lines.push(`<p class="settings-note">${t("backup.desbloqueadas", { lista: report.conquistas_desbloqueadas.map(escapeHtml).join(", ") })}</p>`);
  }
  if (report.removidos.length) {
    const shown = report.removidos.slice(0, XP_REVIEW_LIST_LIMIT);
    const rest = report.removidos.length - shown.length;
    lines.push(
      `<ul class="xp-review-list xp-review-list--removed">${shown
        .map((r) => `<li><span>${escapeHtml(r.description)}</span><span>−${r.xp} xp · ${escapeHtml(r.motivo)}</span></li>`)
        .join("")}${rest > 0 ? `<li class="xp-review-more">+${rest} ${t("backup.outro_s")}</li>` : ""}</ul>`
    );
  }
  lines.push(`
    <div class="form-actions">
      <button class="btn sm warn" id="sm-xpreview-apply" data-action="xp-review-apply">${t("backup.aplicar_revisao")}</button>
    </div>`);
  return lines.join("");
}

async function handleXpReviewPreview(wrap) {
  if (estado.busy) return;
  const btn = wrap.querySelector("#sm-xpreview-btn");
  const reportEl = wrap.querySelector("#sm-xpreview-report");
  estado.busy = true;
  btn.disabled = true;
  btn.textContent = t("backup.simulando");
  try {
    const report = await previewXpReview();
    reportEl.innerHTML = renderXpReviewReport(report);
    reportEl.hidden = false;
    reportEl.querySelector("#sm-xpreview-apply")?.addEventListener("click", () => handleXpReviewApply(wrap));
  } catch (err) {
    showErrorModal(err.message, t("backup.erro_ao_simular_a_revisao"));
  } finally {
    estado.busy = false;
    btn.disabled = false;
    btn.textContent = t("backup.simular_revisao");
  }
}

async function handleXpReviewApply(wrap) {
  if (estado.busy) return;
  const reallySure = await showConfirmModal(
    t("backup.isso_remove_os_registros_listados"),
    { title: t("backup.aplicar_revisao_de_xp"), confirmText: t("backup.sim_revisar") }
  );
  if (!reallySure) return;

  const applyBtn = wrap.querySelector("#sm-xpreview-apply");
  estado.busy = true;
  applyBtn.disabled = true;
  applyBtn.textContent = t("backup.aplicando");
  try {
    const report = await applyXpReview();
    showToast({
      title: t("backup.xp_revisado"),
      message: t("backup.copia_anterior", { arquivo: report.backup }),
      iconName: "check",
      duration: 12000,
    });
    // mesmo motivo de handleImport: xp/níveis/conquistas mudam em todas as
    // telas de uma vez — recarregar é mais seguro que atualizar cada widget
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    showErrorModal(err.message, t("backup.erro_ao_aplicar_a_revisao"));
    estado.busy = false;
    applyBtn.disabled = false;
    applyBtn.textContent = t("backup.aplicar_revisao");
  }
}

function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error(t("backup.json_invalido")));
      }
    };
    reader.onerror = () => reject(new Error(t("backup.ler_arquivo")));
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
    showErrorModal(err.message, t("backup.erro_ao_importar_dados"));
    return;
  }
  const protegido = Boolean(parsed?.kami_backup_cifrado);
  const senhaInput = wrap.querySelector("#sm-import-senha");
  if (!protegido && (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object")) {
    showErrorModal(t("backup.o_arquivo_selecionado_nao_parece"), t("backup.erro_ao_importar_dados"));
    return;
  }

  const reallySure = await showConfirmModal(
    t("backup.isso_sobrescreve_todas_as_suas"),
    { title: t("backup.confirmar_importacao"), confirmText: t("backup.sim_sobrescrever_tudo"), danger: true }
  );
  if (!reallySure) return;

  estado.busy = true;
  fileInput.disabled = true;
  confirmInput.disabled = true;
  senhaInput.disabled = true;
  importBtn.disabled = true;
  importBtn.textContent = t("backup.importando");

  try {
    if (protegido) await importProtegido(confirmation, parsed, senhaInput.value);
    else await importData(confirmation, parsed.tables);
    // recarrega o app inteiro em vez de tentar resetar o estado em
    // memória de cada tela na mão (store.js, widgets já montados
    // etc.) — garante que tudo volte a buscar do backend já com os
    // dados importados.
    window.location.reload();
  } catch (err) {
    showErrorModal(err.message, t("backup.erro_ao_importar_dados"));
    estado.busy = false;
    fileInput.disabled = false;
    confirmInput.disabled = false;
    senhaInput.disabled = false;
    importBtn.disabled = false;
    importBtn.textContent = t("backup.importar_e_sobrescrever");
  }
}

async function handleReset(wrap) {
  if (estado.busy) return;
  const confirmInput = wrap.querySelector("#sm-reset-confirm");
  const resetBtn = wrap.querySelector("#sm-reset-btn");
  const confirmation = confirmInput.value.trim().toLowerCase();
  if (confirmation !== RESET_WORD) return; // botão já deveria estar disabled, defesa extra

  const reallySure = await showConfirmModal(
    t("backup.isso_apaga_todos_os_seus"),
    { title: t("backup.confirmar_reset_completo"), confirmText: t("backup.sim_apagar_tudo"), danger: true }
  );
  if (!reallySure) return;

  estado.busy = true;
  confirmInput.disabled = true;
  resetBtn.disabled = true;
  resetBtn.textContent = t("backup.limpando");

  try {
    await resetData(confirmation);
    // recarrega o app inteiro em vez de tentar resetar o estado em
    // memória de cada tela na mão (store.js, widgets já montados
    // etc.) — garante que tudo volte a buscar do backend já limpo.
    window.location.reload();
  } catch (err) {
    showErrorModal(err.message, t("backup.erro_ao_limpar_dados"));
    estado.busy = false;
    confirmInput.disabled = false;
    resetBtn.disabled = false;
    resetBtn.textContent = t("backup.limpar_todos_os_dados");
  }
}
