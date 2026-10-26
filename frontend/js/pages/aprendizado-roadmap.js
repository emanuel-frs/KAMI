/**
 * Aprendizado — mapa da trilha (roadmap): linha do tempo dos módulos,
 * modo de edição, teclado e edição de título no lugar.
 * MAN-02: saiu de pages/aprendizado.js, que continua montando a tela
 * (lista de trilhas, atalhos, montar/desmontar); o estado compartilhado
 * mora em aprendizado-estado.js.
 */
import { updateTrack, deleteTrack, listMilestones, updateMilestone, reorderMilestones } from "../api/aprendizado.js";
import { escapeHtml } from "../components/format.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "../modals/err-modal.js";
import { makeFocusable, announce } from "../components/a11y.js";
import { contarNotas, linkNotasHtml } from "../components/notas-vinculadas.js";
import { estado } from "./aprendizado-estado.js";
import { getTrack, refreshTracks, startTrackNameEdit } from "./aprendizado.js";
import { openConfirmModal, openMilestoneModal, openNewMilestoneModal } from "./aprendizado-modais.js";
import { setupDragAndDrop, setupDragAndDropEdit } from "./aprendizado-arrastar.js";
import { renderAprHeatmap } from "./aprendizado-heatmap.js";
import { t } from "../i18n.js";

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
    // Mesmo canvas com altura limitada do estado populado (em vez de um
    // texto solto que deixa um vão preto sem fim abaixo dele) — com um
    // card tracejado no lugar de um módulo, convidando a adicionar um.
    return `
      <div class="roadmap-canvas" id="${listId}-canvas">
        <div class="roadmap-canvas-scroll" id="${listId}-scroll">
          <div class="roadmap-timeline roadmap-timeline-empty" id="${listId}">
            <div class="roadmap-add-placeholder" id="${listId}-add-placeholder">
              <span class="roadmap-add-plus">+</span>
              <span>${t("aprendizado_roadmap.adicionar_modulo")}</span>
            </div>
          </div>
        </div>
      </div>
    `;
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
          <div class="roadmap-heading">
            ${editable ? `<span class="roadmap-drag-dot" data-tooltip="${t("aprendizado_roadmap.arrastar")}">${icon("grip", { size: 12 })}</span>` : ''}
            <input type="checkbox" ${checked} class="ms-checkbox" data-id="${m.id}" aria-label="${escapeHtml(t("aprendizado_roadmap.concluido", { nome: m.title }))}">
            <span class="roadmap-title" data-id="${m.id}" data-tooltip="${escapeHtml(m.title)}">${escapeHtml(m.title)}</span>
            ${editable
              ? `<span class="roadmap-expand-btn" data-id="${m.id}" data-tooltip="${t("aprendizado_roadmap.expandir")}">${icon("chevron-down", { size: 14 })}</span>`
              : `<span class="roadmap-arrow" data-id="${m.id}" data-tooltip="${t("aprendizado_roadmap.ver_detalhes")}">${icon("chevron-right", { size: 14 })}</span>`
            }
          </div>
          ${isExpanded ? `
            <div class="roadmap-expanded">
              ${m.description ? `<div class="roadmap-expanded-desc">${escapeHtml(m.description)}</div>` : ''}
              <div class="field">
                <label for="ms-notes-${m.id}">${t("aprendizado_roadmap.notas")}</label>
                <textarea class="ms-notes-textarea" id="ms-notes-${m.id}" data-id="${m.id}" rows="4" style="width:100%; resize:vertical;">${escapeHtml(m.notes || '')}</textarea>
              </div>
              <div style="display:flex; gap:8px; margin-top:8px;">
                <button type="button" class="btn primary sm" data-action="save-notes-inline" data-id="${m.id}">${t("geral.salvar")}</button>
                <button type="button" class="btn sm" data-action="edit-milestone-inline" data-id="${m.id}">${t("geral.editar")}</button>
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

function captureRoadmapFocus() {
  const a = document.activeElement;
  const body = estado.containerEl?.querySelector("#apr-detail-body");
  if (!a || !body || !body.contains(a) || !a.dataset || !a.dataset.id) return;
  for (const kind of ["ms-checkbox", "roadmap-title", "roadmap-expand-btn"]) {
    if (a.classList.contains(kind)) {
      estado.pendingRoadmapFocus = { kind, id: a.dataset.id };
      return;
    }
  }
}

export async function renderMilestones() {
  captureRoadmapFocus();
  const headerEl = estado.containerEl.querySelector("#apr-detail-header");
  const bodyEl = estado.containerEl.querySelector("#apr-detail-body");
  if (headerEl) headerEl.style.display = '';
  if (!estado.selectedTrackId) {
    if (headerEl) headerEl.innerHTML = '';
    if (bodyEl) bodyEl.innerHTML = `<div class="empty-state">${t("aprendizado_roadmap.selecione_uma_trilha")}</div>`;
    return;
  }
  const track = getTrack(estado.selectedTrackId);
  if (!track) {
    if (headerEl) headerEl.innerHTML = '';
    if (bodyEl) bodyEl.innerHTML = `<div class="empty-state">${t("aprendizado_roadmap.trilha_nao_encontrada")}</div>`;
    return;
  }

  if (estado.editingTrack) {
    renderTrackEditMode();
    return;
  }

  // Modo normal
  headerEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-size:12px;font-weight:500;color:var(--text-dim);">${escapeHtml(track.name)}</div>
        ${track.general_goal ? `<div class="track-goal-subtitle" data-tooltip="${escapeHtml(track.general_goal)}">${escapeHtml(track.general_goal)}</div>` : ''}
        <div class="track-notas" data-track-notas="${track.id}"></div>
      </div>
      <button type="button" class="btn sm" id="btn-edit-track">${t("geral.editar")}</button>
    </div>
  `;
  headerEl.querySelector("#btn-edit-track").addEventListener("click", () => {
    estado.editingTrack = true;
    renderMilestones();
    const left = estado.containerEl.querySelector('.apr-left');
    if (left) left.style.display = 'none';
    const grid = estado.containerEl.querySelector('.apr-grid');
    if (grid) grid.style.gridTemplateColumns = '1fr';
  });

  // ORG-01: "notas (N)" da trilha — contagem chega depois, sem segurar o desenho
  contarNotas("trilha").then((c) => {
    const alvo = headerEl.querySelector(`[data-track-notas="${track.id}"]`);
    if (alvo) alvo.innerHTML = linkNotasHtml("trilha", track.id, track.name, c[track.id] || 0);
  });

  let html = renderRoadmapTimeline(estado.milestones, { editable: false, listId: 'milestone-list' });
  bodyEl.innerHTML = html;
  enableCanvasPan(bodyEl.querySelector('#milestone-list-canvas'), bodyEl.querySelector('#milestone-list-scroll'));

  const addPlaceholder = bodyEl.querySelector('#milestone-list-add-placeholder');
  if (addPlaceholder) {
    addPlaceholder.addEventListener('click', () => {
      estado.editingTrack = true;
      renderMilestones();
      const left = estado.containerEl.querySelector('.apr-left');
      if (left) left.style.display = 'none';
      const grid = estado.containerEl.querySelector('.apr-grid');
      if (grid) grid.style.gridTemplateColumns = '1fr';
      openNewMilestoneModal();
    });
  }

  bodyEl.querySelectorAll('#milestone-list .ms-checkbox').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const newStatus = cb.checked ? 'concluido' : 'pendente';
      try {
        await updateMilestone(id, { status: newStatus });
        await refreshMilestones();
        await refreshTracks();
        estado.heatmapEntries = null;
        await renderAprHeatmap();
      } catch (err) {
        showErrorModal(err.message, t("aprendizado_roadmap.erro_ao_atualizar"));
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

  wireRoadmapKeyboard(bodyEl, '#milestone-list', { editable: false });
  setupDragAndDrop();
}

export function renderTrackEditMode() {
  const headerEl = estado.containerEl.querySelector("#apr-detail-header");
  const bodyEl = estado.containerEl.querySelector("#apr-detail-body");
  const track = getTrack(estado.selectedTrackId);
  if (!track) return;
  headerEl.style.display = '';

  // Cabeçalho do modo edição (sem botão expandir)
  headerEl.innerHTML = `
    <div style="display:flex; gap:8px; align-items:flex-start; flex-wrap:wrap;">
      <button type="button" class="btn sm icon-btn-square" id="btn-back-from-edit" data-tooltip="${t("aprendizado_roadmap.voltar")}">${icon("arrow-left", { size: 13 })}</button>
      <div style="flex:1;min-width:0;">
        <span class="track-name-display" style="font-size:12px;font-weight:500;color:var(--text-dim); cursor:pointer;">${escapeHtml(track.name)}</span>
        <div class="track-goal-display" style="font-size:10px;color:var(--text-faint);margin-top:2px;cursor:pointer;">${track.general_goal ? escapeHtml(track.general_goal) : `<span style="opacity:0.5;">${t("aprendizado_roadmap.sem_descricao_clique_2x_para")}</span>`}</div>
      </div>
      <button type="button" class="btn sm icon-btn-square" id="btn-delete-track" data-tooltip="${t("aprendizado_roadmap.deletar_trilha")}">${icon("trash-2", { size: 13 })}</button>
      <button type="button" class="btn sm icon-btn-square" id="btn-add-module" data-tooltip="${t("aprendizado_roadmap.adicionar_modulo")}">+</button>
    </div>
  `;

  // Eventos do cabeçalho
  headerEl.querySelector('#btn-back-from-edit').addEventListener('click', () => {
    estado.editingTrack = false;
    estado.expandedMilestoneId = null; // limpa expansão
    const left = estado.containerEl.querySelector('.apr-left');
    if (left) left.style.display = '';
    const grid = estado.containerEl.querySelector('.apr-grid');
    if (grid) grid.style.gridTemplateColumns = '40% 1fr';
    renderMilestones();
  });

  headerEl.querySelector('#btn-delete-track').addEventListener('click', () => {
    openConfirmModal(t("aprendizado.deletar_trilha", { trilha: track.name }), async () => {
      try {
        await deleteTrack(track.id);
        estado.selectedTrackId = null;
        estado.editingTrack = false;
        estado.expandedMilestoneId = null;
        await refreshTracks();
        headerEl.innerHTML = '';
        bodyEl.innerHTML = `<div class="empty-state">${t("aprendizado_roadmap.trilha_deletada")}</div>`;
        const left = estado.containerEl.querySelector('.apr-left');
        if (left) left.style.display = '';
        const grid = estado.containerEl.querySelector('.apr-grid');
        if (grid) grid.style.gridTemplateColumns = '40% 1fr';
        // item 5 das pendências ("foco depois de excluir... cai no
        // <body>"): o botão que tinha o foco (#btn-delete-track) acabou
        // de sumir com o headerEl.innerHTML = ''. "+ adicionar trilha"
        // é o único alvo estável (sempre existe, é a próxima ação óbvia
        // depois de deletar) — announce() cobre quem usa leitor de tela
        // mesmo que o foco em si não fale "trilha deletada" sozinho.
        announce(t("aprendizado.trilha_deletada", { trilha: track.name }));
        estado.containerEl.querySelector('#apr-add-track')?.focus();
      } catch (err) {
        showErrorModal(err.message, t("aprendizado_roadmap.erro_ao_deletar"));
      }
    });
  });

  headerEl.querySelector('#btn-add-module').addEventListener('click', () => {
    estado.expandedMilestoneId = null;
    openNewMilestoneModal();
  });

  // Renderiza a timeline no modo edição (com expansão)
  let html = renderRoadmapTimeline(estado.milestones, {
    editable: true,
    listId: 'edit-milestone-list',
    expandedId: estado.expandedMilestoneId
  });
  bodyEl.innerHTML = html;
  enableCanvasPan(bodyEl.querySelector('#edit-milestone-list-canvas'), bodyEl.querySelector('#edit-milestone-list-scroll'));

  const editAddPlaceholder = bodyEl.querySelector('#edit-milestone-list-add-placeholder');
  if (editAddPlaceholder) {
    editAddPlaceholder.addEventListener('click', () => {
      estado.expandedMilestoneId = null;
      openNewMilestoneModal();
    });
  }

  // Eventos dos checkboxes
  bodyEl.querySelectorAll('#edit-milestone-list .ms-checkbox').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const newStatus = cb.checked ? 'concluido' : 'pendente';
      try {
        await updateMilestone(id, { status: newStatus });
        await refreshMilestones();
        await refreshTracks();
        estado.heatmapEntries = null;
        await renderAprHeatmap();
      } catch (err) {
        showErrorModal(err.message, t("aprendizado_roadmap.erro_ao_atualizar"));
        cb.checked = !cb.checked;
      }
    });
  });

  // Edição inline do título (clique duas vezes ou clique após selecionar)
  wireInlineTitleEdit(bodyEl, '#edit-milestone-list');

  // Expansão ao clicar no ícone de seta (chevron-down, ver icons.js)
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
        const found = estado.milestones.find(m => m.id === id);
        if (found) found.notes = notes;
        // Re-renderiza mantendo o mesmo expandido
        estado.expandedMilestoneId = id;
        renderMilestones();
      } catch (err) {
        showErrorModal(err.message, t("aprendizado_roadmap.erro_ao_salvar_notas"));
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
  // dblclick não tem equivalente no teclado — Enter faz o mesmo
  makeFocusable(trackNameEl, {
    label: t("aprendizado.renomear_trilha", { nome: track.name }),
    onActivate: () => startTrackNameEdit(trackNameEl, track),
  });

  const trackGoalEl = headerEl.querySelector('.track-goal-display');
  trackGoalEl.addEventListener('dblclick', () => {
    startTrackGoalEdit(trackGoalEl, track);
  });
  makeFocusable(trackGoalEl, {
    label: t("aprendizado_roadmap.editar_descricao_da_trilha"),
    onActivate: () => startTrackGoalEdit(trackGoalEl, track),
  });

  wireRoadmapKeyboard(bodyEl, '#edit-milestone-list', { editable: true });

  // Drag and drop no modo edição
  setupDragAndDropEdit();
}

function startTrackGoalEdit(displayEl, track) {
  const wrap = document.createElement('div');
  wrap.className = 'track-goal-edit-wrap';
  wrap.innerHTML = `
    <textarea rows="2" style="width:100%;font-size:11px;">${escapeHtml(track.general_goal || '')}</textarea>
    <div style="display:flex;gap:6px;margin-top:4px;">
      <span class="icon-btn confirm" data-tooltip="${t("geral.salvar")}">${icon("check")}</span>
      <span class="icon-btn cancel" data-tooltip="${t("geral.cancelar")}">${icon("x")}</span>
    </div>
  `;
  displayEl.replaceWith(wrap);
  wrap.querySelectorAll('.icon-btn').forEach((b) =>
    makeFocusable(b, { label: b.classList.contains('confirm') ? 'salvar' : 'cancelar' })
  );
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
        showErrorModal(err.message, t("aprendizado_roadmap.erro_ao_salvar_descricao"));
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

// ─── Teclado no roadmap (módulos) ─────────────────────────────────────────

async function moveMilestoneByKeyboard(id, delta) {
  const ids = estado.milestones.map((m) => m.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return;
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  try {
    await reorderMilestones(estado.selectedTrackId, ids);
    estado.milestones = ids.map((x) => estado.milestones.find((m) => m.id === x)).filter(Boolean);
    estado.pendingRoadmapFocus = { kind: 'roadmap-title', id };
    renderMilestones();
    announce(t("aprendizado.modulo_movido", { pos: to + 1, total: ids.length }));
    await refreshTracks();
  } catch (err) {
    showErrorModal(err.message, t("aprendizado_roadmap.erro_ao_reordenar"));
  }
}

/**
 * Deixa o roadmap utilizável só com teclado. Chamado a cada render
 * (o corpo é reescrito via innerHTML), depois que o HTML já existe.
 *  - títulos: focáveis; Enter/Espaço abrem os detalhes (vista) ou
 *    renomeiam direto (edição — o "clique 1 seleciona, clique 2 renomeia"
 *    do mouse existe só pra evitar edição acidental);
 *  - ↑/↓ movem o foco entre os títulos, Home/End vão às pontas,
 *    Shift+↑/↓ reordenam o módulo (alternativa ao arrastar);
 *  - botão de expandir (edição) e "adicionar módulo": focáveis;
 *  - seta "ver detalhes" da vista: escondida do leitor de tela e fora do
 *    Tab — faz exatamente o mesmo que o título, seria parada dupla.
 */
function wireRoadmapKeyboard(bodyEl, listSelector, { editable }) {
  const listEl = bodyEl.querySelector(listSelector);
  if (!listEl) return;

  listEl.querySelectorAll('.roadmap-node').forEach((node) => {
    const id = node.dataset.milestoneId;
    const name = estado.milestones.find((m) => m.id === id)?.title || t("aprendizado_roadmap.modulo");

    const title = node.querySelector('.roadmap-title');
    if (title) {
      if (editable) {
        makeFocusable(title, { label: t("aprendizado.renomear_modulo", { nome: name }), onActivate: () => startInlineEdit(title, id) });
      } else {
        makeFocusable(title, { label: t("aprendizado.abrir_detalhes", { nome: name }) });
      }
    }
    const arrow = node.querySelector('.roadmap-arrow');
    if (arrow) arrow.setAttribute('aria-hidden', 'true');
    const dragDot = node.querySelector('.roadmap-drag-dot');
    if (dragDot) dragDot.setAttribute('aria-hidden', 'true');

    const expandBtn = node.querySelector('.roadmap-expand-btn');
    if (expandBtn) {
      const open = estado.expandedMilestoneId === id;
      makeFocusable(expandBtn, { label: t(open ? "aprendizado.recolher_modulo" : "aprendizado.expandir_modulo", { nome: name }), expanded: open });
    }
  });

  const placeholder = listEl.querySelector('.roadmap-add-placeholder');
  if (placeholder) makeFocusable(placeholder, { label: t("aprendizado_roadmap.adicionar_modulo") });

  listEl.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.classList || !t.classList.contains('roadmap-title')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const titles = [...listEl.querySelectorAll('.roadmap-title')];
    const i = titles.indexOf(t);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      if (e.shiftKey) moveMilestoneByKeyboard(t.dataset.id, d);
      else titles[i + d]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      titles[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      titles[titles.length - 1]?.focus();
    }
  });

  // devolve o foco ao que estava focado antes deste render
  if (estado.pendingRoadmapFocus) {
    const { kind, id } = estado.pendingRoadmapFocus;
    estado.pendingRoadmapFocus = null;
    [...listEl.querySelectorAll('.' + kind)].find((x) => x.dataset.id === id)?.focus();
  }
}

export async function refreshMilestones() {
  if (!estado.selectedTrackId) return;
  try {
    estado.milestones = await listMilestones(estado.selectedTrackId);
  } catch (err) {
    estado.milestones = [];
    const detail = estado.containerEl.querySelector("#apr-detail-body");
    if (detail) detail.innerHTML = `<div class="empty-state">${escapeHtml(t("erro.erro_ao_carregar_modulos", { erro: err.message }))}</div>`;
    return;
  }
  renderMilestones();
}

function wireInlineTitleEdit(scopeEl, listSelector) {
  scopeEl.querySelectorAll(`${listSelector} .roadmap-node`).forEach(node => {
    const id = node.dataset.milestoneId;
    const titleEl = node.querySelector('.roadmap-title');
    if (!titleEl) return;
    titleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (estado.selectedNodeId !== id) {
        scopeEl.querySelectorAll(`${listSelector} .roadmap-node`).forEach(n => n.classList.remove('selected'));
        node.classList.add('selected');
        estado.selectedNodeId = id;
        return;
      }
      startInlineEdit(titleEl, id);
    });
  });
}

function toggleExpand(milestoneId) {
  if (estado.expandedMilestoneId === milestoneId) {
    estado.expandedMilestoneId = null;
  } else {
    estado.expandedMilestoneId = milestoneId;
  }
  renderMilestones();
}

function startInlineEdit(titleEl, id) {
  const ms = estado.milestones.find(m => m.id === id);
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
        showErrorModal(err.message, t("aprendizado_roadmap.erro_ao_renomear"));
      }
    }
    estado.selectedNodeId = null;
    estado.pendingRoadmapFocus = { kind: 'roadmap-title', id };
    renderMilestones();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = ms.title; input.blur(); }
  });
  input.addEventListener('blur', commit, { once: true });
}
