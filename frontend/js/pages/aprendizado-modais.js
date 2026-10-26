/**
 * Aprendizado — modais: confirmação, nova trilha (do zero ou por JSON),
 * módulo (ver/editar) e novo módulo.
 * MAN-02: saiu de pages/aprendizado.js, que continua montando a tela
 * (lista de trilhas, atalhos, montar/desmontar); o estado compartilhado
 * mora em aprendizado-estado.js.
 */
import { createTrack, createMilestone, updateMilestone, deleteMilestone } from "../api/aprendizado.js";
import { escapeHtml } from "../components/format.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "../modals/err-modal.js";
import { announce } from "../components/a11y.js";
import { estado } from "./aprendizado-estado.js";
import { refreshTracks } from "./aprendizado.js";
import { renderMilestones, refreshMilestones } from "./aprendizado-roadmap.js";
import { t } from "../i18n.js";

let confirmModalEl = null;
let confirmModalCallback = null;

function buildConfirmModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "confirm-modal";
  wrap.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-head">
        <span id="confirm-modal-title">${t("geral.confirmar")}</span>
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="modal-body">
        <div id="confirm-modal-text" style="font-size:12px;color:var(--text-dim);line-height:1.5;margin-bottom:16px;"></div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn" data-action="confirm-yes" style="color:var(--red);border-color:var(--red);">${t("aprendizado_modais.excluir")}</button>
          <button type="button" class="btn sm" data-action="cancel">${t("geral.cancelar")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireConfirmModal(wrap);
  return wrap;
}

function wireConfirmModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", closeConfirmModal);
  wrap.querySelector('[data-action="cancel"]').addEventListener("click", closeConfirmModal);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeConfirmModal();
  });
  wrap.querySelector('[data-action="confirm-yes"]').addEventListener("click", () => {
    const cb = confirmModalCallback;
    closeConfirmModal();
    if (cb) cb();
  });
}

export function openConfirmModal(text, onConfirm) {
  if (!confirmModalEl) confirmModalEl = buildConfirmModal();
  const wrap = confirmModalEl;
  wrap.querySelector("#confirm-modal-text").textContent = text;
  confirmModalCallback = onConfirm;
  wrap.classList.add("open");
}

export function closeConfirmModal() {
  if (confirmModalEl) confirmModalEl.classList.remove("open");
  confirmModalCallback = null;
}

// ─── modais ────────────────────────────────────────────────────────────────
let trackModalEl = null;

function buildTrackModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "track-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span id="track-modal-title">${t("aprendizado_modais.nova_trilha")}</span>
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label for="track-name-input">${t("aprendizado_modais.nome_da_trilha")}</label>
          <input type="text" id="track-name-input" placeholder="${t("aprendizado_modais.ex_programacao")}">
        </div>
        <div class="field">
          <label for="track-description-input">${t("aprendizado_modais.descricao")}</label>
          <textarea id="track-description-input" placeholder="${t("aprendizado_modais.ex_aprenda_programacao_do_zero")}"></textarea>
        </div>
        <div style="display:flex; gap:8px; margin-top:4px; align-items:center;">
          <button type="button" class="btn primary" data-action="save" id="track-save-btn">${t("aprendizado_modais.criar")}</button>
          <button type="button" class="btn sm" data-action="cancel">${t("geral.cancelar")}</button>
          <button type="button" class="btn sm" data-action="toggle-import" style="margin-left:auto;" data-tooltip="${t("aprendizado_modais.importar_via_json")}">${t("aprendizado_modais.importar_json")}</button>
        </div>
        <div class="track-error" style="display:none; color:var(--red); font-size:10.5px; margin-top:8px;"></div>

        <div id="track-import-section" style="display:none; margin-top:16px; border-top:1px dashed var(--border-soft); padding-top:12px;">
          <div class="field">
            <label for="track-import-json">${t("aprendizado_modais.json_da_trilha")}</label>
            <textarea id="track-import-json" rows="8" placeholder='{"name":"Rust","general_goal":"...","modules":[{"title":"sintaxe","description":"..."}]}'></textarea>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn primary sm" data-action="import-json">${t("aprendizado_modais.criar_via_json")}</button>
            <button type="button" class="btn sm" data-action="cancel-import">${t("geral.cancelar")}</button>
          </div>
          <div class="track-import-error" style="display:none; color:var(--red); font-size:10.5px; margin-top:8px;"></div>
          <div class="track-import-progress" style="display:none; color:var(--text-faint); font-size:10.5px; margin-top:8px;"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireTrackModal(wrap);
  return wrap;
}

function wireTrackModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", closeTrackModal);
  wrap.querySelector('[data-action="cancel"]').addEventListener("click", closeTrackModal);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeTrackModal();
  });

  wrap.querySelector('[data-action="save"]').addEventListener("click", async () => {
    const input = wrap.querySelector("#track-name-input");
    const name = input.value.trim();
    const errorEl = wrap.querySelector(".track-error");
    errorEl.style.display = "none";

    if (!name) {
      errorEl.textContent = t("aprendizado_modais.digite_um_nome_para_a");
      errorEl.style.display = "block";
      return;
    }
    try {
      await createTrack({ name, general_goal: wrap.querySelector("#track-description-input").value.trim() || null });
    } catch (err) {
      errorEl.textContent = t("aprendizado.erro_criar_trilha", { erro: err.message });
      errorEl.style.display = "block";
      return;
    }
    closeTrackModal();
    await refreshTracks();
  });

  wrap.querySelector('[data-action="toggle-import"]').addEventListener("click", () => {
    const section = wrap.querySelector("#track-import-section");
    section.style.display = section.style.display === "none" ? "block" : "none";
  });

  wrap.querySelector('[data-action="cancel-import"]').addEventListener("click", () => {
    wrap.querySelector("#track-import-section").style.display = "none";
    wrap.querySelector("#track-import-json").value = "";
    wrap.querySelector(".track-import-error").style.display = "none";
  });

  wrap.querySelector('[data-action="import-json"]').addEventListener("click", async () => {
    const raw = wrap.querySelector("#track-import-json").value.trim();
    const errorEl = wrap.querySelector(".track-import-error");
    const progressEl = wrap.querySelector(".track-import-progress");
    errorEl.style.display = "none";
    progressEl.style.display = "none";

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      errorEl.textContent = t("aprendizado_modais.json_invalido_verifique_a_sintaxe");
      errorEl.style.display = "block";
      return;
    }

    if (!data.name || typeof data.name !== "string") {
      errorEl.textContent = t("aprendizado_modais.campo_name_e_obrigatorio_e");
      errorEl.style.display = "block";
      return;
    }
    const modules = Array.isArray(data.modules) ? data.modules : [];
    if (modules.some(m => !m.title || typeof m.title !== "string")) {
      errorEl.textContent = t("aprendizado_modais.todo_modulo_em_modules_precisa");
      errorEl.style.display = "block";
      return;
    }

    try {
      const track = await createTrack({
        name: data.name,
        general_goal: data.general_goal || null,
      });

      for (let i = 0; i < modules.length; i++) {
        progressEl.style.display = "block";
        progressEl.textContent = t("aprendizado.criando_modulo", { i: i + 1, total: modules.length });
        await createMilestone(track.id, {
          title: modules[i].title,
          description: modules[i].description || null,
        });
      }

      progressEl.style.display = "none";
      wrap.querySelector("#track-import-json").value = "";
      wrap.querySelector("#track-import-section").style.display = "none";
      closeTrackModal();
      await refreshTracks();
    } catch (err) {
      progressEl.style.display = "none";
      errorEl.textContent = t("aprendizado.erro_importar", { erro: err.message });
      errorEl.style.display = "block";
    }
  });
}

export function openTrackModal() {
  if (!trackModalEl) trackModalEl = buildTrackModal();
  const wrap = trackModalEl;
  wrap.querySelector("#track-name-input").value = "";
  wrap.querySelector("#track-description-input").value = "";
  wrap.querySelector("#track-modal-title").textContent = t("aprendizado_modais.nova_trilha");
  wrap.querySelector("#track-save-btn").textContent = t("aprendizado_modais.criar");
  wrap.querySelector(".track-error").style.display = "none";
  wrap.querySelector("#track-import-section").style.display = "none";
  wrap.querySelector("#track-import-json").value = "";
  wrap.querySelector(".track-import-error").style.display = "none";
  wrap.classList.add("open");
}

export function closeTrackModal() {
  if (trackModalEl) trackModalEl.classList.remove("open");
}

// ─── Modal de módulo (visualização + edição) ────────────────────────────
let milestoneModalEl = null;
let milestoneModalMode = "view";

function buildMilestoneModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "milestone-modal";
  wrap.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="modal-head">
        <span id="ms-modal-title">${t("aprendizado_modais.modulo")}</span>
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="modal-body" id="ms-modal-body">
        <!-- dynamic content -->
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireMilestoneModal(wrap);
  return wrap;
}

function wireMilestoneModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", closeMilestoneModal);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeMilestoneModal();
  });
}

export function openMilestoneModal(milestoneId, mode = "view") {
  if (!milestoneModalEl) milestoneModalEl = buildMilestoneModal();
  const wrap = milestoneModalEl;
  const ms = estado.milestones.find(m => m.id === milestoneId);
  if (!ms) return;
  estado.currentMilestoneId = milestoneId;
  milestoneModalMode = mode;

  const body = wrap.querySelector("#ms-modal-body");
  if (mode === "view") {
    body.innerHTML = `
      <div class="field">
        <label>${t("aprendizado_modais.nome")}</label>
        <div class="val" style="font-weight:500;font-size:13px;">${escapeHtml(ms.title)}</div>
      </div>
      <div class="field">
        <label>${t("aprendizado_modais.descricao")}</label>
        <div class="val">${ms.description ? escapeHtml(ms.description) : `<span style="color:var(--text-faint)">${t("aprendizado_modais.vazio")}</span>`}</div>
      </div>
      <div class="field">
        <label for="ms-notes-textarea">${t("aprendizado_modais.notas")}</label>
        <textarea id="ms-notes-textarea" rows="4" style="resize:vertical;width:100%;">${ms.notes || ''}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--border-soft);padding-top:12px;">
        <button type="button" class="btn primary sm" data-action="save-notes">${t("geral.salvar")}</button>
        <button type="button" class="btn" data-action="edit-milestone">${t("geral.editar")}</button>
      </div>
    `;
    wrap.querySelector("#ms-modal-title").textContent = `${escapeHtml(ms.title)}`;
    body.querySelector('[data-action="save-notes"]').addEventListener("click", async () => {
      const notes = body.querySelector("#ms-notes-textarea").value;
      try {
        await updateMilestone(ms.id, { notes });
        const found = estado.milestones.find(m => m.id === ms.id);
        if (found) found.notes = notes;
        renderMilestones();
      } catch (err) {
        showErrorModal(err.message, t("aprendizado_modais.erro_ao_salvar_notas"));
      }
    });
    body.querySelector('[data-action="edit-milestone"]').addEventListener("click", () => {
      closeMilestoneModal();
      openMilestoneModal(ms.id, "edit");
    });
  } else {
    body.innerHTML = `
      <div class="field">
        <label for="ms-edit-name">${t("aprendizado_modais.nome")}</label>
        <input type="text" id="ms-edit-name" value="${escapeHtml(ms.title)}">
      </div>
      <div class="field">
        <label for="ms-edit-desc">${t("aprendizado_modais.descricao")}</label>
        <textarea id="ms-edit-desc" rows="3">${ms.description || ''}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
        <button type="button" class="btn primary" data-action="save-edit">${t("geral.salvar")}</button>
        <button type="button" class="btn sm" data-action="cancel-edit">${t("geral.cancelar")}</button>
        <button type="button" class="btn" data-action="delete-milestone" style="color:var(--red);margin-left:auto;">${t("aprendizado_modais.excluir")}</button>
      </div>
    `;
    wrap.querySelector("#ms-modal-title").innerHTML = `${icon("pencil", { size: 13 })} editar ${escapeHtml(ms.title)}`;
    body.querySelector('[data-action="save-edit"]').addEventListener("click", async () => {
      const name = body.querySelector("#ms-edit-name").value.trim();
      const description = body.querySelector("#ms-edit-desc").value.trim() || null;
      if (!name) { showErrorModal(t("aprendizado_modais.nome_e_obrigatorio"), t("geral.atencao")); return; }
      try {
        await updateMilestone(ms.id, { title: name, description });
        const found = estado.milestones.find(m => m.id === ms.id);
        if (found) { found.title = name; found.description = description; }
        closeMilestoneModal();
        renderMilestones();
        await refreshTracks();
      } catch (err) {
        showErrorModal(err.message, t("aprendizado_modais.erro_ao_salvar"));
      }
    });
    body.querySelector('[data-action="cancel-edit"]').addEventListener("click", () => {
      closeMilestoneModal();
    });
    body.querySelector('[data-action="delete-milestone"]').addEventListener("click", () => {
      openConfirmModal(t("aprendizado.excluir_modulo", { modulo: ms.title }), async () => {
        try {
          await deleteMilestone(ms.id);
          closeMilestoneModal();
          await refreshTracks();
          await refreshMilestones();
          // item 5 das pendências ("foco depois de excluir... cai no
          // <body>"): fechar o modal devolveria o foco pro botão
          // "editar" que o abriu, mas refreshMilestones() já
          // reconstruiu a timeline por baixo — reaproveita o mesmo
          // fallback do atalho Alt+R (shortcutFocusRoadmap): primeiro
          // módulo restante, ou o placeholder de "adicionar" se a
          // trilha ficou vazia.
          announce(t("aprendizado.modulo_excluido", { modulo: ms.title }));
          const roadmapBody = estado.containerEl.querySelector('#apr-detail-body');
          (roadmapBody?.querySelector('.roadmap-title') || roadmapBody?.querySelector('.roadmap-add-placeholder'))?.focus();
        } catch (err) {
          showErrorModal(err.message, t("aprendizado_modais.erro_ao_excluir"));
        }
      });
    });
  }
  wrap.classList.add("open");
}

export function closeMilestoneModal() {
  if (milestoneModalEl) milestoneModalEl.classList.remove("open");
}

// ─── Modal de criação de módulo ──────────────────────────────────────────
let newMilestoneModalEl = null;

function buildNewMilestoneModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "new-milestone-modal";
  wrap.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <div class="modal-head">
        <span>${t("aprendizado_modais.novo_modulo")}</span>
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label for="new-ms-name">${t("aprendizado_modais.nome")}</label>
          <input type="text" id="new-ms-name" placeholder="${t("aprendizado_modais.ex_git")}">
        </div>
        <div class="field">
          <label for="new-ms-desc">${t("aprendizado_modais.descricao")}</label>
          <textarea id="new-ms-desc" rows="3"></textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button type="button" class="btn primary" data-action="create">${t("geral.salvar")}</button>
          <button type="button" class="btn sm" data-action="cancel">${t("geral.cancelar")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireNewMilestoneModal(wrap);
  return wrap;
}

function wireNewMilestoneModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", closeNewMilestoneModal);
  wrap.querySelector('[data-action="cancel"]').addEventListener("click", closeNewMilestoneModal);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeNewMilestoneModal();
  });
  wrap.querySelector('[data-action="create"]').addEventListener("click", async () => {
    const name = wrap.querySelector("#new-ms-name").value.trim();
    const description = wrap.querySelector("#new-ms-desc").value.trim() || null;
    if (!name) { showErrorModal(t("aprendizado_modais.digite_um_nome"), t("geral.atencao")); return; }
    try {
      await createMilestone(estado.selectedTrackId, { title: name, description });
      closeNewMilestoneModal();
      await refreshMilestones();
      await refreshTracks();
    } catch (err) {
      showErrorModal(err.message, t("aprendizado_modais.erro_ao_criar_modulo"));
    }
  });
}

export function openNewMilestoneModal() {
  if (!newMilestoneModalEl) newMilestoneModalEl = buildNewMilestoneModal();
  const wrap = newMilestoneModalEl;
  wrap.querySelector("#new-ms-name").value = "";
  wrap.querySelector("#new-ms-desc").value = "";
  wrap.classList.add("open");
}

export function closeNewMilestoneModal() {
  if (newMilestoneModalEl) newMilestoneModalEl.classList.remove("open");
}
