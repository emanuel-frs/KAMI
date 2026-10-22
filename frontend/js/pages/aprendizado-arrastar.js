/**
 * Aprendizado — arrastar e reordenar trilhas e módulos (mouse e teclado).
 * MAN-02: saiu de pages/aprendizado.js, que continua montando a tela
 * (lista de trilhas, atalhos, montar/desmontar); o estado compartilhado
 * mora em aprendizado-estado.js.
 */
import { reorderTracks, reorderMilestones } from "../api/aprendizado.js";
import { showErrorModal } from "../modals/err-modal.js";
import { announce } from "../components/a11y.js";
import { estado } from "./aprendizado-estado.js";
import { renderTracks, refreshTracks } from "./aprendizado.js";
import { renderMilestones } from "./aprendizado-roadmap.js";

// ─── Drag and Drop ────────────────────────────────────────────────────────
let dragSrcId = null;

export function setupDragAndDrop() {
  const list = estado.containerEl.querySelector('#milestone-list');
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
      const ids = estado.milestones.map(m => m.id);
      const srcIdx = ids.indexOf(dragSrcId);
      const tgtIdx = ids.indexOf(targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, dragSrcId);
      try {
        await reorderMilestones(estado.selectedTrackId, ids);
        const reordered = ids.map(id => estado.milestones.find(m => m.id === id)).filter(Boolean);
        estado.milestones = reordered;
        renderMilestones();
        await refreshTracks();
      } catch (err) {
        showErrorModal(err.message, "erro ao reordenar");
      }
    });
  });
}

export function setupDragAndDropEdit() {
  const list = estado.containerEl.querySelector('#edit-milestone-list');
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
      const ids = estado.milestones.map(m => m.id);
      const srcIdx = ids.indexOf(dragSrcId);
      const tgtIdx = ids.indexOf(targetId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, dragSrcId);
      try {
        await reorderMilestones(estado.selectedTrackId, ids);
        const reordered = ids.map(id => estado.milestones.find(m => m.id === id)).filter(Boolean);
        estado.milestones = reordered;
        renderMilestones();
        await refreshTracks();
      } catch (err) {
        showErrorModal(err.message, "erro ao reordenar");
      }
    });
  });
}

// Drag manual via mouse (não usa a API nativa de HTML5 drag-and-drop):
// o WebKitGTK, engine usada pelo Tauri no Linux, tem suporte instável a
// dragstart/dragover/drop — o item "levanta" mas o "drop" não dispara de
// forma confiável, então a reordenação nunca chega a ser persistida.
// Rastreando o mouse manualmente (mousedown no grip → mousemove no
// window → mouseup) contornamos isso por completo, sem depender do
// motor de drag nativo do WebView.
export function setupTracksDragAndDrop() {
  const list = estado.containerEl.querySelector('#apr-tracks-list');
  if (!list) return;
  list.querySelectorAll('.apr-track-drag-dot').forEach(dot => {
    dot.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const item = dot.closest('.apr-track-item');
      if (item) startTrackDrag(item, e);
    });
  });
}

// Mesmo padrão visual do drag de widgets (attachDragHandle em
// js/widgets/grid.js): o item vira position:fixed e segue o cursor, e um
// placeholder tracejado (.apr-track-placeholder, espelha .wg-placeholder)
// ocupa o lugar vazio até soltar — em vez de só trocar o item de lugar
// na lista sem indicar visualmente o espaço de destino.
function startTrackDrag(item, startEvent) {
  const list = estado.containerEl.querySelector('#apr-tracks-list');
  if (!list) return;

  const rect = item.getBoundingClientRect();
  const offsetX = startEvent.clientX - rect.left;
  const offsetY = startEvent.clientY - rect.top;

  const placeholder = document.createElement('div');
  placeholder.className = 'apr-track-placeholder';
  placeholder.style.height = `${rect.height}px`;
  item.after(placeholder);

  document.body.classList.add('kami-dragging');
  item.classList.add('dragging');
  item.style.position = 'fixed';
  item.style.top = `${rect.top}px`;
  item.style.left = `${rect.left}px`;
  item.style.width = `${rect.width}px`;
  item.style.zIndex = 1000;
  item.style.pointerEvents = 'none';
  document.body.appendChild(item);

  const onMouseMove = (e) => {
    item.style.top = `${e.clientY - offsetY}px`;
    item.style.left = `${e.clientX - offsetX}px`;

    const siblings = [...list.querySelectorAll('.apr-track-item')];
    const after = siblings.find(el => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) {
      list.insertBefore(placeholder, after);
    } else {
      list.appendChild(placeholder);
    }
  };

  const onMouseUp = async () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    document.body.classList.remove('kami-dragging');

    item.style.position = '';
    item.style.top = '';
    item.style.left = '';
    item.style.width = '';
    item.style.zIndex = '';
    item.style.pointerEvents = '';
    item.classList.remove('dragging');
    placeholder.replaceWith(item);

    const ids = [...list.querySelectorAll('.apr-track-item')].map(el => el.dataset.trackId);
    try {
      estado.tracks = await reorderTracks(ids);
      renderTracks();
    } catch (err) {
      showErrorModal(err.message, "erro ao reordenar trilhas");
      renderTracks();
    }
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// ─── Eventos da lista de trilhas ────────────────────────────────────────

async function moveTrackByKeyboard(id, delta) {
  const ids = [...estado.tracks].sort((a, b) => a.position - b.position).map((t) => t.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return;
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  estado.pendingTrackFocusId = id;
  try {
    estado.tracks = await reorderTracks(ids);
    renderTracks();
    announce(`trilha movida para a posição ${to + 1} de ${ids.length}`);
  } catch (err) {
    estado.pendingTrackFocusId = null;
    showErrorModal(err.message, "erro ao reordenar trilhas");
    renderTracks();
  }
}

function focusTrackItem(items, index) {
  const target = items[Math.max(0, Math.min(items.length - 1, index))];
  if (!target) return;
  items.forEach((el) => el.setAttribute("tabindex", el === target ? "0" : "-1"));
  target.focus();
}

// Teclado na lista de trilhas (padrão listbox): setas movem o foco,
// Home/End vão às pontas, Enter/Espaço selecionam (mesmo efeito do clique),
// Shift+↑/↓ reordenam — alternativa por teclado ao arrastar pelo grip.
export function setupTrackListKeyboard(listEl) {
  listEl.addEventListener("keydown", (e) => {
    const item = e.target.closest(".apr-track-item");
    if (!item || e.target !== item) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const items = [...listEl.querySelectorAll(".apr-track-item")];
    const i = items.indexOf(item);

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      if (e.shiftKey) moveTrackByKeyboard(item.dataset.trackId, d);
      else focusTrackItem(items, i + d);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusTrackItem(items, 0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusTrackItem(items, items.length - 1);
    } else if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      item.click();
    }
  });
}
