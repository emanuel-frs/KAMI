import {
  listTracks,
  createTrack,
  updateTrack,
  deleteTrack,
  listMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  reorderMilestones,
} from "../api/aprendizado.js";
import { escapeHtml } from "../widgets/format.js";
import { getLog } from "../api/nucleo.js";

// ─── estado ────────────────────────────────────────────────────────────────
let containerEl = null;
let tracks = [];
let milestones = [];
let selectedTrackId = null;
let editingTrack = false;
let currentMilestoneId = null;
let selectedNodeId = null;
let expandedMilestoneId = null;
let confirmModalEl = null;
let confirmModalCallback = null;

// ─── helpers ──────────────────────────────────────────────────────────────
function getTrack(id) { return tracks.find(t => t.id === id); }

// ─── roadmap (timeline conectada) ─────────────────────────────────────────
function computeVisualStates(list) {
  let foundActive = false;
  return list.map(m => {
    if (m.status === 'concluido') return 'done';
    if (m.status === 'esquecido') return 'esquecido';
    if (!foundActive) { foundActive = true; return 'active'; }
    return 'locked';
  });
}

function renderRoadmapTimeline(list, { editable, listId, expandedId }) {
  if (!list.length) {
    return `<div class="empty-state" style="margin-top:12px;">nenhum módulo definido.</div>`;
  }
  const states = computeVisualStates(list);
  let inner = '';
  list.forEach((m, i) => {
    const visual = states[i];
    const checked = m.status === 'concluido' ? 'checked' : '';
    const isExpanded = editable && expandedId === m.id;
    inner += `
      <div class="roadmap-node" data-visual="${visual}" data-milestone-id="${m.id}" draggable="true">
        <div class="roadmap-connector"></div>
        <div class="roadmap-box">
          ${editable ? `<span class="roadmap-drag-dot" data-tooltip="arrastar">⠿</span>` : ''}
          <input type="checkbox" ${checked} class="ms-checkbox" data-id="${m.id}">
          <span class="roadmap-title" data-id="${m.id}">${escapeHtml(m.title)}</span>
          ${editable
            ? `<span class="roadmap-expand-btn" data-id="${m.id}" data-tooltip="expandir">▼</span>`
            : `<span class="roadmap-arrow" data-id="${m.id}" data-tooltip="ver detalhes">›</span>`
          }
          ${isExpanded ? `
            <div class="roadmap-expanded">
              ${m.description ? `<div class="roadmap-expanded-desc">${escapeHtml(m.description)}</div>` : ''}
              <div class="field">
                <label>notas</label>
                <textarea class="ms-notes-textarea" data-id="${m.id}" rows="4" style="width:100%; resize:vertical;">${escapeHtml(m.notes || '')}</textarea>
              </div>
              <div style="display:flex; gap:8px; margin-top:8px;">
                <button type="button" class="btn primary sm" data-action="save-notes-inline" data-id="${m.id}">salvar</button>
                <button type="button" class="btn sm" data-action="edit-milestone-inline" data-id="${m.id}">editar</button>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  });
  return `
    <div class="roadmap-canvas" id="${listId}-canvas">
      <div class="roadmap-canvas-scroll" id="${listId}-scroll">
        <div class="roadmap-timeline" id="${listId}">${inner}</div>
      </div>
    </div>
  `;
}

function buildConfirmModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "confirm-modal";
  wrap.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-head">
        <span id="confirm-modal-title">confirmar</span>
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body">
        <div id="confirm-modal-text" style="font-size:12px;color:var(--text-dim);line-height:1.5;margin-bottom:16px;"></div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn" data-action="confirm-yes" style="color:var(--red);border-color:var(--red);">excluir</button>
          <button type="button" class="btn sm" data-action="cancel">cancelar</button>
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

function openConfirmModal(text, onConfirm) {
  if (!confirmModalEl) confirmModalEl = buildConfirmModal();
  const wrap = confirmModalEl;
  wrap.querySelector("#confirm-modal-text").textContent = text;
  confirmModalCallback = onConfirm;
  wrap.classList.add("open");
}

function closeConfirmModal() {
  if (confirmModalEl) confirmModalEl.classList.remove("open");
  confirmModalCallback = null;
}

function enableCanvasPan(canvasEl, scrollEl) {
  if (!canvasEl || !scrollEl) return;
  let isPanning = false, startY = 0, startScroll = 0;
  canvasEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('.roadmap-box')) return;
    isPanning = true;
    canvasEl.classList.add('panning');
    startY = e.clientY;
    startScroll = scrollEl.scrollTop;
  });
  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    scrollEl.scrollTop = startScroll - (e.clientY - startY);
  });
  window.addEventListener('mouseup', () => {
    isPanning = false;
    canvasEl.classList.remove('panning');
  });
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
        <span id="track-modal-title">nova trilha</span>
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>nome da trilha</label>
          <input type="text" id="track-name-input" placeholder="ex: programação">
        </div>
        <div class="field">
          <label>descrição</label>
          <textarea id="track-description-input" placeholder="ex: Aprenda programação do zero"></textarea>
        </div>
        <div style="display:flex; gap:8px; margin-top:4px; align-items:center;">
          <button type="button" class="btn primary" data-action="save" id="track-save-btn">criar</button>
          <button type="button" class="btn sm" data-action="cancel">cancelar</button>
          <button type="button" class="btn sm" data-action="toggle-import" style="margin-left:auto;" data-tooltip="importar via JSON">importar json</button>
        </div>
        <div class="track-error" style="display:none; color:var(--red); font-size:10.5px; margin-top:8px;"></div>

        <div id="track-import-section" style="display:none; margin-top:16px; border-top:1px dashed var(--border-soft); padding-top:12px;">
          <div class="field">
            <label>json da trilha</label>
            <textarea id="track-import-json" rows="8" placeholder='{"name":"Rust","general_goal":"...","modules":[{"title":"sintaxe","description":"..."}]}'></textarea>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn primary sm" data-action="import-json">criar via json</button>
            <button type="button" class="btn sm" data-action="cancel-import">cancelar</button>
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
      errorEl.textContent = "digite um nome para a trilha.";
      errorEl.style.display = "block";
      return;
    }
    try {
      await createTrack({ name, general_goal: wrap.querySelector("#track-description-input").value.trim() || null });
    } catch (err) {
      errorEl.textContent = `erro ao criar trilha: ${err.message}`;
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
      errorEl.textContent = "JSON inválido — verifique a sintaxe.";
      errorEl.style.display = "block";
      return;
    }

    if (!data.name || typeof data.name !== "string") {
      errorEl.textContent = 'campo "name" é obrigatório e deve ser texto.';
      errorEl.style.display = "block";
      return;
    }
    const modules = Array.isArray(data.modules) ? data.modules : [];
    if (modules.some(m => !m.title || typeof m.title !== "string")) {
      errorEl.textContent = 'todo módulo em "modules" precisa de um "title" válido.';
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
        progressEl.textContent = `criando módulo ${i + 1}/${modules.length}…`;
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
      errorEl.textContent = `erro ao importar: ${err.message}`;
      errorEl.style.display = "block";
    }
  });
}

function openTrackModal() {
  if (!trackModalEl) trackModalEl = buildTrackModal();
  const wrap = trackModalEl;
  wrap.querySelector("#track-name-input").value = "";
  wrap.querySelector("#track-description-input").value = "";
  wrap.querySelector("#track-modal-title").textContent = "nova trilha";
  wrap.querySelector("#track-save-btn").textContent = "criar";
  wrap.querySelector(".track-error").style.display = "none";
  wrap.querySelector("#track-import-section").style.display = "none";
  wrap.querySelector("#track-import-json").value = "";
  wrap.querySelector(".track-import-error").style.display = "none";
  wrap.classList.add("open");
}

function closeTrackModal() {
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
        <span id="ms-modal-title">módulo</span>
        <span class="close" data-action="close">✕</span>
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

function openMilestoneModal(milestoneId, mode = "view") {
  if (!milestoneModalEl) milestoneModalEl = buildMilestoneModal();
  const wrap = milestoneModalEl;
  const ms = milestones.find(m => m.id === milestoneId);
  if (!ms) return;
  currentMilestoneId = milestoneId;
  milestoneModalMode = mode;

  const body = wrap.querySelector("#ms-modal-body");
  if (mode === "view") {
    body.innerHTML = `
      <div class="field">
        <label>nome</label>
        <div class="val" style="font-weight:500;font-size:13px;">${escapeHtml(ms.title)}</div>
      </div>
      <div class="field">
        <label>descrição</label>
        <div class="val">${ms.description ? escapeHtml(ms.description) : '<span style="color:var(--text-faint)">(vazio)</span>'}</div>
      </div>
      <div class="field">
        <label>notas</label>
        <textarea id="ms-notes-textarea" rows="4" style="resize:vertical;width:100%;">${ms.notes || ''}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;border-top:1px solid var(--border-soft);padding-top:12px;">
        <button type="button" class="btn primary sm" data-action="save-notes">salvar</button>
        <button type="button" class="btn" data-action="edit-milestone">editar</button>
      </div>
    `;
    wrap.querySelector("#ms-modal-title").textContent = `${escapeHtml(ms.title)}`;
    body.querySelector('[data-action="save-notes"]').addEventListener("click", async () => {
      const notes = body.querySelector("#ms-notes-textarea").value;
      try {
        await updateMilestone(ms.id, { notes });
        const found = milestones.find(m => m.id === ms.id);
        if (found) found.notes = notes;
        renderMilestones();
      } catch (err) {
        alert(`Erro ao salvar notas: ${err.message}`);
      }
    });
    body.querySelector('[data-action="edit-milestone"]').addEventListener("click", () => {
      closeMilestoneModal();
      openMilestoneModal(ms.id, "edit");
    });
  } else {
    body.innerHTML = `
      <div class="field">
        <label>nome</label>
        <input type="text" id="ms-edit-name" value="${escapeHtml(ms.title)}">
      </div>
      <div class="field">
        <label>descrição</label>
        <textarea id="ms-edit-desc" rows="3">${ms.description || ''}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
        <button type="button" class="btn primary" data-action="save-edit">salvar</button>
        <button type="button" class="btn sm" data-action="cancel-edit">cancelar</button>
        <button type="button" class="btn" data-action="delete-milestone" style="color:var(--red);margin-left:auto;">excluir</button>
      </div>
    `;
    wrap.querySelector("#ms-modal-title").textContent = `✎ editar ${escapeHtml(ms.title)}`;
    body.querySelector('[data-action="save-edit"]').addEventListener("click", async () => {
      const name = body.querySelector("#ms-edit-name").value.trim();
      const description = body.querySelector("#ms-edit-desc").value.trim() || null;
      if (!name) { alert("Nome é obrigatório."); return; }
      try {
        await updateMilestone(ms.id, { title: name, description });
        const found = milestones.find(m => m.id === ms.id);
        if (found) { found.title = name; found.description = description; }
        closeMilestoneModal();
        renderMilestones();
        await refreshTracks();
      } catch (err) {
        alert(`Erro ao salvar: ${err.message}`);
      }
    });
    body.querySelector('[data-action="cancel-edit"]').addEventListener("click", () => {
      closeMilestoneModal();
    });
    body.querySelector('[data-action="delete-milestone"]').addEventListener("click", () => {
      openConfirmModal(`Excluir o módulo "${ms.title}"?`, async () => {
        try {
          await deleteMilestone(ms.id);
          closeMilestoneModal();
          await refreshTracks();
          await refreshMilestones();
        } catch (err) {
          alert(`Erro ao excluir: ${err.message}`);
        }
      });
    });
  }
  wrap.classList.add("open");
}

function closeMilestoneModal() {
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
        <span>novo módulo</span>
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>nome</label>
          <input type="text" id="new-ms-name" placeholder="ex: Git">
        </div>
        <div class="field">
          <label>descrição</label>
          <textarea id="new-ms-desc" rows="3"></textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button type="button" class="btn primary" data-action="create">salvar</button>
          <button type="button" class="btn sm" data-action="cancel">cancelar</button>
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
    if (!name) { alert("Digite um nome."); return; }
    try {
      await createMilestone(selectedTrackId, { title: name, description });
      closeNewMilestoneModal();
      await refreshMilestones();
      await refreshTracks();
    } catch (err) {
      alert(`Erro ao criar módulo: ${err.message}`);
    }
  });
}

function openNewMilestoneModal() {
  if (!newMilestoneModalEl) newMilestoneModalEl = buildNewMilestoneModal();
  const wrap = newMilestoneModalEl;
  wrap.querySelector("#new-ms-name").value = "";
  wrap.querySelector("#new-ms-desc").value = "";
  wrap.classList.add("open");
}

function closeNewMilestoneModal() {
  if (newMilestoneModalEl) newMilestoneModalEl.classList.remove("open");
}

// ─── Modal de "expandir mapa" (mantido, mas sem botão de acesso) ──────
let expandModalEl = null;

function buildExpandModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "expand-modal";
  wrap.innerHTML = `
    <div class="modal" style="max-width:800px;max-height:80vh;">
      <div class="modal-head">
        <span>mapa completo</span>
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body" id="expand-body" style="overflow-y:auto;"></div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-action="close"]').addEventListener("click", closeExpandModal);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeExpandModal();
  });
  return wrap;
}

function openExpandModal() {
  if (!expandModalEl) expandModalEl = buildExpandModal();
  const body = expandModalEl.querySelector("#expand-body");
  if (!selectedTrackId) return;
  const track = getTrack(selectedTrackId);
  if (!track) return;
  let html = `<div style="padding:4px 0 12px;font-size:14px;font-weight:500;">${escapeHtml(track.name)}</div>`;
  html += renderRoadmapTimeline(milestones, { editable: false, listId: 'milestone-list' });
  body.innerHTML = html;
  enableCanvasPan(body.querySelector('#milestone-list-canvas'), body.querySelector('#milestone-list-scroll'));
  body.querySelectorAll('.roadmap-title, .roadmap-arrow').forEach(el => {
    el.addEventListener('click', () => openMilestoneModal(el.dataset.id, 'view'));
  });
  body.querySelectorAll('.ms-checkbox').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const newStatus = cb.checked ? 'concluido' : 'pendente';
      try {
        await updateMilestone(id, { status: newStatus });
        await refreshMilestones();
        await refreshTracks();
        heatmapEntries = null;
        await renderAprHeatmap();
        openExpandModal();
      } catch (err) {
        alert(`Erro ao atualizar: ${err.message}`);
        cb.checked = !cb.checked;
      }
    });
  });
  expandModalEl.classList.add("open");
}

function closeExpandModal() {
  if (expandModalEl) expandModalEl.classList.remove("open");
}

// ─── Renderização ─────────────────────────────────────────────────────────

function renderTracks() {
  const listEl = containerEl.querySelector("#apr-tracks-list");
  if (!tracks.length) {
    listEl.innerHTML = `<div class="empty-state">nenhuma trilha criada.</div>`;
    return;
  }
  const sorted = [...tracks].sort((a, b) => a.name.localeCompare(b.name));
  listEl.innerHTML = sorted.map(track => {
    const pct = track.progress_pct ?? 0;
    const isSelected = selectedTrackId === track.id;
    return `
      <div class="apr-track-item${isSelected ? " selected" : ""}" data-track-id="${track.id}">
        <div class="apr-track-info">
          <span class="apr-track-name">${escapeHtml(track.name)}</span>
          <span class="apr-track-pct">${Math.round(pct)}%</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%;"></div>
        </div>
      </div>
    `;
  }).join("");
  if (selectedTrackId) {
    renderMilestones();
  } else {
    const header = containerEl.querySelector("#apr-detail-header");
    const body = containerEl.querySelector("#apr-detail-body");
    if (header) header.innerHTML = '';
    if (body) body.innerHTML = `<div class="empty-state">comece uma trilha de aprendizado</div>`;
  }
}

async function renderMilestones() {
  const headerEl = containerEl.querySelector("#apr-detail-header");
  const bodyEl = containerEl.querySelector("#apr-detail-body");
  if (!selectedTrackId) {
    if (headerEl) headerEl.innerHTML = '';
    if (bodyEl) bodyEl.innerHTML = `<div class="empty-state">selecione uma trilha</div>`;
    return;
  }
  const track = getTrack(selectedTrackId);
  if (!track) {
    if (headerEl) headerEl.innerHTML = '';
    if (bodyEl) bodyEl.innerHTML = `<div class="empty-state">trilha não encontrada</div>`;
    return;
  }

  if (editingTrack) {
    renderTrackEditMode();
    return;
  }

  // Modo normal
  headerEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:12px;font-weight:500;color:var(--text-dim);">${escapeHtml(track.name)}</div>
        ${track.general_goal ? `<div class="track-goal-subtitle" title="${escapeHtml(track.general_goal)}">${escapeHtml(track.general_goal)}</div>` : ''}
      </div>
      <button type="button" class="btn sm" id="btn-edit-track">editar</button>
    </div>
  `;
  headerEl.querySelector("#btn-edit-track").addEventListener("click", () => {
    editingTrack = true;
    renderMilestones();
    const left = containerEl.querySelector('.apr-left');
    if (left) left.style.display = 'none';
    const grid = containerEl.querySelector('.apr-grid');
    if (grid) grid.style.gridTemplateColumns = '1fr';
  });

  let html = renderRoadmapTimeline(milestones, { editable: false, listId: 'milestone-list' });
  bodyEl.innerHTML = html;
  enableCanvasPan(bodyEl.querySelector('#milestone-list-canvas'), bodyEl.querySelector('#milestone-list-scroll'));

  bodyEl.querySelectorAll('#milestone-list .ms-checkbox').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const newStatus = cb.checked ? 'concluido' : 'pendente';
      try {
        await updateMilestone(id, { status: newStatus });
        await refreshMilestones();
        await refreshTracks();
      } catch (err) {
        alert(`Erro ao atualizar: ${err.message}`);
        cb.checked = !cb.checked;
      }
    });
  });

  bodyEl.querySelectorAll('#milestone-list .roadmap-title, #milestone-list .roadmap-arrow').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      openMilestoneModal(id, 'view');
    });
  });

  setupDragAndDrop();
}

function renderTrackEditMode() {
  const headerEl = containerEl.querySelector("#apr-detail-header");
  const bodyEl = containerEl.querySelector("#apr-detail-body");
  const track = getTrack(selectedTrackId);
  if (!track) return;

  // Cabeçalho do modo edição (sem botão expandir)
  headerEl.innerHTML = `
    <div style="display:flex; gap:8px; align-items:flex-start; flex-wrap:wrap;">
      <button type="button" class="btn sm icon-btn-square" id="btn-back-from-edit" data-tooltip="voltar">‹</button>
      <div style="flex:1;min-width:0;">
        <span class="track-name-display" style="font-size:12px;font-weight:500;color:var(--text-dim); cursor:pointer;">${escapeHtml(track.name)}</span>
        <div class="track-goal-display" style="font-size:10px;color:var(--text-faint);margin-top:2px;cursor:pointer;">${track.general_goal ? escapeHtml(track.general_goal) : '<span style="opacity:0.5;">(sem descrição — clique 2x para adicionar)</span>'}</div>
      </div>
      <button type="button" class="btn sm icon-btn-square" id="btn-delete-track" data-tooltip="deletar trilha">🗑</button>
      <button type="button" class="btn sm icon-btn-square" id="btn-add-module" data-tooltip="adicionar módulo">+</button>
    </div>
  `;

  // Eventos do cabeçalho
  headerEl.querySelector('#btn-back-from-edit').addEventListener('click', () => {
    editingTrack = false;
    expandedMilestoneId = null; // limpa expansão
    const left = containerEl.querySelector('.apr-left');
    if (left) left.style.display = '';
    const grid = containerEl.querySelector('.apr-grid');
    if (grid) grid.style.gridTemplateColumns = '40% 1fr';
    renderMilestones();
  });

  headerEl.querySelector('#btn-delete-track').addEventListener('click', () => {
    openConfirmModal(`Tem certeza que deseja deletar a trilha "${track.name}"?`, async () => {
      try {
        await deleteTrack(track.id);
        selectedTrackId = null;
        editingTrack = false;
        expandedMilestoneId = null;
        await refreshTracks();
        headerEl.innerHTML = '';
        bodyEl.innerHTML = `<div class="empty-state">trilha deletada</div>`;
        const left = containerEl.querySelector('.apr-left');
        if (left) left.style.display = '';
        const grid = containerEl.querySelector('.apr-grid');
        if (grid) grid.style.gridTemplateColumns = '40% 1fr';
      } catch (err) {
        alert(`Erro ao deletar: ${err.message}`);
      }
    });
  });

  headerEl.querySelector('#btn-add-module').addEventListener('click', () => {
    expandedMilestoneId = null;
    openNewMilestoneModal();
  });

  // Renderiza a timeline no modo edição (com expansão)
  let html = renderRoadmapTimeline(milestones, {
    editable: true,
    listId: 'edit-milestone-list',
    expandedId: expandedMilestoneId
  });
  bodyEl.innerHTML = html;
  enableCanvasPan(bodyEl.querySelector('#edit-milestone-list-canvas'), bodyEl.querySelector('#edit-milestone-list-scroll'));

  // Eventos dos checkboxes
  bodyEl.querySelectorAll('#edit-milestone-list .ms-checkbox').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const newStatus = cb.checked ? 'concluido' : 'pendente';
      try {
        await updateMilestone(id, { status: newStatus });
        await refreshMilestones();
        await refreshTracks();
      } catch (err) {
        alert(`Erro: ${err.message}`);
        cb.checked = !cb.checked;
      }
    });
  });

  // Edição inline do título (clique duas vezes ou clique após selecionar)
  wireInlineTitleEdit(bodyEl, '#edit-milestone-list');

  // Botões editar e excluir módulo
  bodyEl.querySelectorAll('#edit-milestone-list .ms-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      openMilestoneModal(id, 'edit');
    });
  });

  bodyEl.querySelectorAll('#edit-milestone-list .ms-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const ms = milestones.find(m => m.id === id);
      if (!ms) return;
      openConfirmModal(`Excluir módulo "${ms.title}"?`, async () => {
        try {
          await deleteMilestone(id);
          await refreshMilestones();
          await refreshTracks();
        } catch (err) {
          alert(`Erro: ${err.message}`);
        }
      });
    });
  });

  // Expansão ao clicar na seta ▼
  bodyEl.querySelectorAll('#edit-milestone-list .roadmap-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      toggleExpand(id);
    });
  });

  // Salvar notas inline
  bodyEl.querySelectorAll('#edit-milestone-list [data-action="save-notes-inline"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const textarea = bodyEl.querySelector(`.ms-notes-textarea[data-id="${id}"]`);
      if (!textarea) return;
      const notes = textarea.value;
      try {
        await updateMilestone(id, { notes });
        const found = milestones.find(m => m.id === id);
        if (found) found.notes = notes;
        // Re-renderiza mantendo o mesmo expandido
        expandedMilestoneId = id;
        renderMilestones();
      } catch (err) {
        alert(`Erro ao salvar notas: ${err.message}`);
      }
    });
  });

  // Editar via botão dentro do expandido (abre modal de edição)
  bodyEl.querySelectorAll('#edit-milestone-list [data-action="edit-milestone-inline"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      openMilestoneModal(id, 'edit');
    });
  });

  const trackNameEl = headerEl.querySelector('.track-name-display');
  trackNameEl.addEventListener('dblclick', () => {
    startTrackNameEdit(trackNameEl, track);
  });

  const trackGoalEl = headerEl.querySelector('.track-goal-display');
  trackGoalEl.addEventListener('dblclick', () => {
    startTrackGoalEdit(trackGoalEl, track);
  });

  // Drag and drop no modo edição
  setupDragAndDropEdit();
}

function startTrackGoalEdit(displayEl, track) {
  const wrap = document.createElement('div');
  wrap.className = 'track-goal-edit-wrap';
  wrap.innerHTML = `
    <textarea rows="2" style="width:100%;font-size:11px;">${escapeHtml(track.general_goal || '')}</textarea>
    <div style="display:flex;gap:6px;margin-top:4px;">
      <span class="icon-btn confirm" data-tooltip="salvar">✓</span>
      <span class="icon-btn cancel" data-tooltip="cancelar">✕</span>
    </div>
  `;
  displayEl.replaceWith(wrap);
  const textarea = wrap.querySelector('textarea');
  textarea.focus();

  const commit = async () => {
    const newGoal = textarea.value.trim();
    if (newGoal !== (track.general_goal || '')) {
      try {
        await updateTrack(track.id, { general_goal: newGoal || null });
        track.general_goal = newGoal || null;
        await refreshTracks();
      } catch (err) {
        alert(`Erro ao salvar descrição: ${err.message}`);
      }
    }
    renderTrackEditMode();
  };
  const cancel = () => renderTrackEditMode();

  wrap.querySelector('.confirm').addEventListener('click', commit);
  wrap.querySelector('.cancel').addEventListener('click', cancel);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
  });
}

// ─── Drag and Drop ────────────────────────────────────────────────────────
let dragSrcId = null;

function setupDragAndDrop() {
  const list = containerEl.querySelector('#milestone-list');
  if (!list) return;
  const items = list.querySelectorAll('.roadmap-node');
  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragSrcId = item.dataset.milestoneId;
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetId = item.dataset.milestoneId;
      if (!dragSrcId || dragSrcId === targetId) return;
      const ids = milestones.map(m => m.id);
      const srcIdx = ids.indexOf(dragSrcId);
      const tgtIdx = ids.indexOf(targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, dragSrcId);
      try {
        await reorderMilestones(selectedTrackId, ids);
        const reordered = ids.map(id => milestones.find(m => m.id === id)).filter(Boolean);
        milestones = reordered;
        renderMilestones();
        await refreshTracks();
      } catch (err) {
        alert(`Erro ao reordenar: ${err.message}`);
      }
    });
  });
}

function setupDragAndDropEdit() {
  const list = containerEl.querySelector('#edit-milestone-list');
  if (!list) return;
  const items = list.querySelectorAll('.roadmap-node');
  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragSrcId = item.dataset.milestoneId;
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetId = item.dataset.milestoneId;
      if (!dragSrcId || dragSrcId === targetId) return;
      const ids = milestones.map(m => m.id);
      const srcIdx = ids.indexOf(dragSrcId);
      const tgtIdx = ids.indexOf(targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, dragSrcId);
      try {
        await reorderMilestones(selectedTrackId, ids);
        const reordered = ids.map(id => milestones.find(m => m.id === id)).filter(Boolean);
        milestones = reordered;
        renderMilestones();
        await refreshTracks();
      } catch (err) {
        alert(`Erro ao reordenar: ${err.message}`);
      }
    });
  });
}

// ─── Carregar dados ──────────────────────────────────────────────────────

async function refreshTracks() {
  const listEl = containerEl.querySelector("#apr-tracks-list");
  listEl.innerHTML = '<div class="empty-state">carregando…</div>';
  try {
    tracks = await listTracks();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">erro: ${err.message}</div>`;
    return;
  }
  renderTracks();
}

function fmtDateShort(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

let heatmapEntries = null;
let heatmapYear = new Date().getFullYear();

const MONTH_NAMES_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

async function loadHeatmapEntries() {
  try {
    // ~3 anos de histórico cobrem os 3 tabs de ano exibidos
    heatmapEntries = await getLog({ attribute: 'aprendizado', period_days: 1100 });
  } catch (err) {
    heatmapEntries = [];
  }
}

function buildYearWeeks(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const dec31 = new Date(Date.UTC(year, 11, 31));
  const start = new Date(jan1);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(dec31);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

  const weeks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return { weeks, jan1, dec31 };
}

async function renderAprHeatmap() {
  const gridEl = containerEl?.querySelector('#apr-heatmap');
  const monthsEl = containerEl?.querySelector('#apr-heatmap-months');
  const yearsEl = containerEl?.querySelector('#apr-heatmap-years');
  if (!gridEl || !monthsEl || !yearsEl) return;

  if (!heatmapEntries) await loadHeatmapEntries();

  const countsByDay = {};
  const milestoneByDay = {};
  heatmapEntries.forEach(l => {
    const key = l.created_at.slice(0, 10);
    countsByDay[key] = (countsByDay[key] || 0) + 1;
    if (l.description && l.description.startsWith('concluiu marco:')) {
      milestoneByDay[key] = (milestoneByDay[key] || []).concat(
        l.description.replace('concluiu marco: ', '')
      );
    }
  });

  const currentYear = new Date().getFullYear();
  const yearsWithData = new Set(
    heatmapEntries.map(l => parseInt(l.created_at.slice(0, 4), 10))
  );
  yearsWithData.add(currentYear);
  const years = [...yearsWithData].sort((a, b) => b - a);

  yearsEl.innerHTML = years.map(y => `
    <button type="button" class="apr-heatmap-year-btn${y === heatmapYear ? ' active' : ''}" data-year="${y}">${y}</button>
  `).join('');
  yearsEl.querySelectorAll('[data-year]').forEach(btn => {
    btn.addEventListener('click', () => {
      heatmapYear = parseInt(btn.dataset.year, 10);
      renderAprHeatmap();
    });
  });

  const { weeks, jan1, dec31 } = buildYearWeeks(heatmapYear);

  gridEl.style.gridTemplateColumns = `repeat(${weeks.length}, 13px)`;
  monthsEl.style.gridTemplateColumns = `repeat(${weeks.length}, 13px)`;

  let cellsHtml = '';
  weeks.forEach(week => {
    week.forEach(d => {
      if (d < jan1 || d > dec31) {
        cellsHtml += `<div class="hm-cell-empty"></div>`;
        return;
      }
      const key = d.toISOString().slice(0, 10);
      const c = countsByDay[key] || 0;
      const lvl = c >= 3 ? 3 : c === 2 ? 2 : c === 1 ? 1 : 0;
      const isMilestone = !!milestoneByDay[key];
      const [y, m, dd] = key.split('-');
      const tip = `${dd}/${m}/${y}`
        + (c ? ` · ${c} registro${c > 1 ? 's' : ''} em aprendizado` : ' · sem registro')
        + (isMilestone ? ` · marco concluído: ${milestoneByDay[key].join('; ')}` : '');
      cellsHtml += `<div class="hm-cell lvl-${lvl}${isMilestone ? ' milestone' : ''}" title="${escapeHtml(tip)}"></div>`;
    });
  });
  gridEl.innerHTML = cellsHtml;

  let monthsHtml = '';
  let lastMonth = -1;
  weeks.forEach((week, idx) => {
    const marker = week.find(d => d >= jan1 && d <= dec31 && d.getUTCDate() <= 7);
    if (marker) {
      const month = marker.getUTCMonth();
      if (month !== lastMonth) {
        monthsHtml += `<span style="grid-column:${idx + 1};">${MONTH_NAMES_PT[month]}</span>`;
        lastMonth = month;
      }
    }
  });
  monthsEl.innerHTML = monthsHtml;
}

async function refreshMilestones() {
  if (!selectedTrackId) return;
  try {
    milestones = await listMilestones(selectedTrackId);
  } catch (err) {
    milestones = [];
    const detail = containerEl.querySelector("#apr-detail-body");
    if (detail) detail.innerHTML = `<div class="empty-state">erro ao carregar módulos: ${err.message}</div>`;
    return;
  }
  renderMilestones();
}

// ─── Eventos da lista de trilhas ────────────────────────────────────────

function setupListEvents() {
  const listEl = containerEl.querySelector("#apr-tracks-list");
  listEl.addEventListener("click", async (e) => {
    const item = e.target.closest(".apr-track-item");
    if (!item) return;
    const id = item.dataset.trackId;
    if (selectedTrackId === id) {
      selectedTrackId = null;
      renderTracks();
      return;
    }
    selectedTrackId = id;
    if (editingTrack) {
      editingTrack = false;
      expandedMilestoneId = null;
      const left = containerEl.querySelector('.apr-left');
      if (left) left.style.display = '';
      const grid = containerEl.querySelector('.apr-grid');
      if (grid) grid.style.gridTemplateColumns = '40% 1fr';
    }
    await refreshMilestones();
    renderTracks();
  });
}

function wireInlineTitleEdit(scopeEl, listSelector) {
  scopeEl.querySelectorAll(`${listSelector} .roadmap-node`).forEach(node => {
    const id = node.dataset.milestoneId;
    const titleEl = node.querySelector('.roadmap-title');
    if (!titleEl) return;
    titleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedNodeId !== id) {
        scopeEl.querySelectorAll(`${listSelector} .roadmap-node`).forEach(n => n.classList.remove('selected'));
        node.classList.add('selected');
        selectedNodeId = id;
        return;
      }
      startInlineEdit(titleEl, id);
    });
  });
}

function toggleExpand(milestoneId) {
  if (expandedMilestoneId === milestoneId) {
    expandedMilestoneId = null;
  } else {
    expandedMilestoneId = milestoneId;
  }
  renderMilestones();
}

function startInlineEdit(titleEl, id) {
  const ms = milestones.find(m => m.id === id);
  if (!ms) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'roadmap-title-input';
  input.value = ms.title;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== ms.title) {
      try {
        await updateMilestone(id, { title: newTitle });
        ms.title = newTitle;
      } catch (err) {
        alert(`Erro ao renomear: ${err.message}`);
      }
    }
    selectedNodeId = null;
    renderMilestones();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = ms.title; input.blur(); }
  });
  input.addEventListener('blur', commit, { once: true });
}

function startTrackNameEdit(displayEl, track) {
  const wrap = document.createElement('span');
  wrap.className = 'track-name-edit-wrap';
  wrap.style.flex = '1';
  wrap.innerHTML = `
    <input type="text" value="${escapeHtml(track.name)}">
    <span class="icon-btn confirm" data-tooltip="salvar">✓</span>
    <span class="icon-btn cancel" data-tooltip="cancelar">✕</span>
  `;
  displayEl.replaceWith(wrap);
  const input = wrap.querySelector('input');
  input.focus();
  input.select();

  const commit = async () => {
    const newName = input.value.trim();
    if (newName && newName !== track.name) {
      try {
        await updateTrack(track.id, { name: newName });
        track.name = newName;
        await refreshTracks();
      } catch (err) {
        alert(`Erro ao renomear trilha: ${err.message}`);
      }
    }
    renderTrackEditMode();
  };
  const cancel = () => {
    renderTrackEditMode();
  };

  wrap.querySelector('.confirm').addEventListener('click', commit);
  wrap.querySelector('.cancel').addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  });
}

// ─── Montagem / Desmontagem ─────────────────────────────────────────────

export async function mount(container) {
  containerEl = container;
  container.innerHTML = `
    <div class="wg-toolbar">
      <button type="button" class="btn sm" id="apr-add-track">+ adicionar trilha</button>
    </div>
    <div class="card" style="max-height: 500px; display: flex; flex-direction: column;">
      <div class="card-head">trilhas de aprendizado</div>
      <div class="card-body apr-grid" style="flex:1;min-height:0;overflow:hidden;">
        <div class="apr-left" style="height:100%;overflow-y:auto;">
          <div id="apr-tracks-list"><div class="empty-state">carregando…</div></div>
        </div>
        <div class="apr-right" style="height:100%;overflow:hidden;display:flex;flex-direction:column;">
          <div id="apr-detail-header" style="flex-shrink:0; padding:6px 8px; background: var(--panel); z-index:5;"></div>
          <div id="apr-detail-body" style="flex:1;overflow-y:auto;">
            <div class="empty-state">selecione uma trilha</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-head">atividade — log de aprendizado agrupado por dia <span class="push" style="color:var(--text-faint); font-size:10px;">estilo contribution graph</span></div>
      <div class="card-body">
        <div class="apr-heatmap-card-inner">
          <div class="apr-heatmap-main">
            <div class="apr-heatmap-months" id="apr-heatmap-months"></div>
            <div class="apr-heatmap-body">
              <div class="apr-heatmap-weekdays">
                <span></span><span>seg</span><span></span><span>qua</span><span></span><span>sex</span><span></span>
              </div>
              <div class="apr-heatmap-grid" id="apr-heatmap"></div>
            </div>
            <div class="apr-heatmap-legend">
              <span>menos</span>
              <span class="lg-sw" style="background:var(--bg-alt);"></span>
              <span class="lg-sw" style="background:var(--accent-dim); opacity:0.5; border-color:transparent;"></span>
              <span class="lg-sw" style="background:var(--accent-dim); opacity:0.85; border-color:transparent;"></span>
              <span class="lg-sw" style="background:var(--accent); border-color:transparent;"></span>
              <span>mais</span>
              <span class="lg-milestone">
                <span class="lg-sw" style="background:var(--bg-alt); box-shadow:0 0 0 2px var(--amber);"></span>
                marco concluído
              </span>
            </div>
          </div>
          <div class="apr-heatmap-years" id="apr-heatmap-years"></div>
        </div>
      </div>
    </div>
  `;

  container.querySelector("#apr-add-track").addEventListener("click", openTrackModal);

  await refreshTracks();
  setupListEvents();

  if (!selectedTrackId && tracks.length > 0) {
    const sorted = [...tracks].sort((a, b) => a.name.localeCompare(b.name));
    selectedTrackId = sorted[0].id;
    await refreshMilestones();
    renderTracks();
  }

  await renderAprHeatmap();
}

export function unmount() {
  containerEl = null;
  closeTrackModal();
  closeMilestoneModal();
  closeNewMilestoneModal();
  closeExpandModal();
  closeConfirmModal();
  editingTrack = false;
  selectedTrackId = null;
  expandedMilestoneId = null;
  tracks = [];
  milestones = [];
}