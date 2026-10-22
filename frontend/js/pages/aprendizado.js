import { listTracks, updateTrack, listMilestones } from "../api/aprendizado.js";
import { escapeHtml, fmtData } from "../components/format.js";
import { icon } from "../components/icons.js";
import { getLog } from "../api/nucleo.js";
import { store } from "../state/store.js";
import { maybeStartAprendizadoTips, replayAprendizadoTips } from "./aprendizado-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";
import { showErrorModal } from "../modals/err-modal.js";
import { makeFocusable } from "../components/a11y.js";
import { registerScreenShortcuts, clearScreenShortcuts } from "../components/shortcuts.js";
import { consumePendingFocus } from "../components/pending-focus.js";
import { estado } from "./aprendizado-estado.js";
import { renderMilestones, renderTrackEditMode, refreshMilestones } from "./aprendizado-roadmap.js";
import {
  closeConfirmModal,
  openTrackModal,
  closeTrackModal,
  closeMilestoneModal,
  openNewMilestoneModal,
  closeNewMilestoneModal,
} from "./aprendizado-modais.js";
import { setupTracksDragAndDrop, setupTrackListKeyboard } from "./aprendizado-arrastar.js";
import { renderAprHeatmap } from "./aprendizado-heatmap.js";

let shortcutsToken = null;
// dicas contextuais (etapa 5) — mesmo padrão de núcleo/perfil/financas/metas/organizacao
let unsubscribeProfile = null;
let currentReplayFn = null;

// ─── helpers ──────────────────────────────────────────────────────────────
export function getTrack(id) { return estado.tracks.find(t => t.id === id); }

// ─── Renderização ─────────────────────────────────────────────────────────

function captureTrackFocus(listEl) {
  const a = document.activeElement;
  if (!listEl || !a || !listEl.contains(a)) return;
  const item = a.closest(".apr-track-item");
  if (item) estado.pendingTrackFocusId = item.dataset.trackId;
}

function restoreTrackFocus(listEl) {
  if (!estado.pendingTrackFocusId) return;
  const id = estado.pendingTrackFocusId;
  estado.pendingTrackFocusId = null;
  const el = [...listEl.querySelectorAll(".apr-track-item")].find((x) => x.dataset.trackId === id);
  if (el) el.focus();
}

export function renderTracks() {
  const listEl = estado.containerEl.querySelector("#apr-tracks-list");
  captureTrackFocus(listEl);
  if (!estado.tracks.length) {
    estado.pendingTrackFocusId = null;
    listEl.removeAttribute("role");
    listEl.removeAttribute("aria-label");
    listEl.innerHTML = `<div class="empty-state">nenhuma trilha criada.</div>`;
    return;
  }
  const sorted = [...estado.tracks].sort((a, b) => a.position - b.position);
  // lista de seleção única: 1 parada de Tab (a trilha selecionada, ou a
  // primeira) e setas percorrem as demais — ver setupListEvents().
  listEl.setAttribute("role", "listbox");
  listEl.setAttribute("aria-label", "trilhas de aprendizado");
  const tabStopId = sorted.some((t) => t.id === estado.selectedTrackId) ? estado.selectedTrackId : sorted[0].id;
  listEl.innerHTML = sorted.map(track => {
    const pct = track.progress_pct ?? 0;
    const isSelected = estado.selectedTrackId === track.id;
    return `
      <div class="apr-track-item${isSelected ? " selected" : ""}" data-track-id="${track.id}"
           role="option" aria-selected="${isSelected}" tabindex="${track.id === tabStopId ? 0 : -1}"
           aria-label="${escapeHtml(track.name)}, ${Math.round(pct)}%">
        <span class="apr-track-drag-dot" data-tooltip="arrastar" aria-hidden="true">${icon("grip", { size: 12 })}</span>
        <div class="apr-track-item-body">
          <div class="apr-track-info">
            <span class="apr-track-name">${escapeHtml(track.name)}</span>
            <span class="apr-track-pct">${Math.round(pct)}%</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill alt" style="width:${pct}%;"></div>
          </div>
        </div>
      </div>
    `;
  }).join("");
  setupTracksDragAndDrop();
  restoreTrackFocus(listEl);
  if (estado.selectedTrackId) {
    renderMilestones();
  } else {
    const header = estado.containerEl.querySelector("#apr-detail-header");
    const body = estado.containerEl.querySelector("#apr-detail-body");
    // #apr-detail-header sempre desenha a própria borda mesmo vazio (sobra
    // como uma barra sem conteúdo); escondendo de vez enquanto não há
    // trilha selecionada, e sem a caixa tracejada do empty-state — só o
    // texto solto, sem moldura nenhuma.
    if (header) { header.innerHTML = ''; header.style.display = 'none'; }
    if (body) body.innerHTML = `<div class="empty-state" style="border:none;">comece uma trilha de aprendizado</div>`;
  }
}

// ─── Atalhos de tela (Alt + tecla) ───────────────────────────────────────

function enterTrackEditMode() {
  estado.editingTrack = true;
  renderMilestones();
  const left = estado.containerEl.querySelector('.apr-left');
  if (left) left.style.display = 'none';
  const grid = estado.containerEl.querySelector('.apr-grid');
  if (grid) grid.style.gridTemplateColumns = '1fr';
}

function leaveTrackEditMode() {
  estado.containerEl.querySelector('#btn-back-from-edit')?.click();
}

function shortcutNewTrack() {
  openTrackModal();
}

function shortcutToggleEdit() {
  if (!estado.selectedTrackId) return;
  if (estado.editingTrack) {
    leaveTrackEditMode();
    requestAnimationFrame(() => estado.containerEl?.querySelector('#btn-edit-track')?.focus());
  } else {
    estado.containerEl.querySelector('#btn-edit-track')?.click();
    requestAnimationFrame(() => estado.containerEl?.querySelector('#btn-back-from-edit')?.focus());
  }
}

function shortcutNewMilestone() {
  if (!estado.selectedTrackId) return;
  if (!estado.editingTrack) enterTrackEditMode(); // mesmo caminho do "adicionar módulo" do estado vazio
  estado.expandedMilestoneId = null;
  openNewMilestoneModal();
}

function shortcutFocusTracks() {
  if (estado.editingTrack) leaveTrackEditMode(); // a lista fica escondida durante a edição
  const list = estado.containerEl.querySelector('#apr-tracks-list');
  const item = list?.querySelector('.apr-track-item[tabindex="0"]') || list?.querySelector('.apr-track-item');
  (item || estado.containerEl.querySelector('#apr-add-track'))?.focus();
}

function shortcutFocusRoadmap() {
  const body = estado.containerEl.querySelector('#apr-detail-body');
  (body?.querySelector('.roadmap-title') || body?.querySelector('.roadmap-add-placeholder'))?.focus();
}

// ─── Carregar dados ──────────────────────────────────────────────────────

export async function refreshTracks() {
  const listEl = estado.containerEl.querySelector("#apr-tracks-list");
  captureTrackFocus(listEl); // antes de "carregando…" apagar a lista (e o foco junto)
  listEl.innerHTML = '<div class="empty-state">carregando…</div>';
  try {
    estado.tracks = await listTracks();
  } catch (err) {
    estado.pendingTrackFocusId = null;
    listEl.innerHTML = `<div class="empty-state">erro: ${escapeHtml(err.message)}</div>`;
    return;
  }
  renderTracks();
}

function fmtDateShort(isoDate) {
  return fmtData(isoDate); // ORG-07
}

function setupListEvents() {
  const listEl = estado.containerEl.querySelector("#apr-tracks-list");
  setupTrackListKeyboard(listEl);
  listEl.addEventListener("click", async (e) => {
    const item = e.target.closest(".apr-track-item");
    if (!item) return;
    const id = item.dataset.trackId;
    if (estado.selectedTrackId === id) {
      estado.selectedTrackId = null;
      renderTracks();
      return;
    }
    estado.selectedTrackId = id;
    if (estado.editingTrack) {
      estado.editingTrack = false;
      estado.expandedMilestoneId = null;
      const left = estado.containerEl.querySelector('.apr-left');
      if (left) left.style.display = '';
      const grid = estado.containerEl.querySelector('.apr-grid');
      if (grid) grid.style.gridTemplateColumns = '40% 1fr';
    }
    await refreshMilestones();
    renderTracks();
  });
}

export function startTrackNameEdit(displayEl, track) {
  const wrap = document.createElement('span');
  wrap.className = 'track-name-edit-wrap';
  wrap.style.flex = '1';
  wrap.innerHTML = `
    <input type="text" value="${escapeHtml(track.name)}">
    <span class="icon-btn confirm" data-tooltip="salvar">${icon("check")}</span>
    <span class="icon-btn cancel" data-tooltip="cancelar">${icon("x")}</span>
  `;
  displayEl.replaceWith(wrap);
  wrap.querySelectorAll('.icon-btn').forEach((b) =>
    makeFocusable(b, { label: b.classList.contains('confirm') ? 'salvar' : 'cancelar' })
  );
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
        showErrorModal(err.message, "erro ao renomear trilha");
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

/**
 * Chamado por app.js (schedulePreload) durante a janela do boot-splash,
 * antes de qualquer navegação de verdade pra essa tela. Não toca em
 * `container`, no estado do módulo (tracks/milestones/selectedTrackId)
 * nem em nada visual — só repete as mesmas leituras que o mount() faz
 * de cara, pra elas caírem no cache de GET de api/client.js. Quando o
 * mount() de verdade rodar mais tarde, essas chamadas voltam na hora
 * em vez de esperar outro round-trip ao backend.
 *
 * Resultado é descartado de propósito (é só um "esquenta cache"); se
 * algo aqui falhar, o mount() de verdade tenta de novo e trata o erro
 * como sempre tratou.
 */
export async function preload() {
  const list = await listTracks().catch(() => []);
  const sorted = [...list].sort((a, b) => a.position - b.position);
  const firstTrackId = sorted[0]?.id;
  await Promise.all([
    getLog({ attribute: "aprendizado", period_days: 1100 }).catch(() => {}),
    firstTrackId ? listMilestones(firstTrackId).catch(() => {}) : null,
  ]);
}

export async function mount(container) {
  estado.containerEl = container;
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
          <div class="apr-heatmap-main" aria-hidden="true">
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
          <!-- fora do aria-hidden acima de propósito: são botões de
               verdade (trocar de ano), não decoração — sumir com eles
               do teclado/leitor de tela tiraria uma função real, não
               só uma redundância visual. -->
          <div class="apr-heatmap-years" id="apr-heatmap-years"></div>
        </div>
        <div id="apr-heatmap-alt"></div>
      </div>
    </div>
  `;

  container.querySelector("#apr-add-track").addEventListener("click", openTrackModal);

  await refreshTracks();
  setupListEvents();

  // ORG-03: trilha/marco escolhido na busca (Ctrl+K)
  const trilhaPedida = consumePendingFocus("trilha");
  if (trilhaPedida && estado.tracks.some((t) => t.id === trilhaPedida)) {
    estado.selectedTrackId = trilhaPedida;
    await refreshMilestones();
    renderTracks();
  }

  if (!estado.selectedTrackId && estado.tracks.length > 0) {
    const sorted = [...estado.tracks].sort((a, b) => a.position - b.position);
    estado.selectedTrackId = sorted[0].id;
    await refreshMilestones();
    renderTracks();
  }

  await renderAprHeatmap();

  // recalcula o tamanho da célula do heatmap quando o card muda de
  // largura (janela redimensionada, sidebar recolhida etc.) — sem
  // isso o cálculo feito no primeiro render() ficaria desatualizado.
  const heatmapMainEl = container.querySelector('.apr-heatmap-main');
  if (heatmapMainEl && window.ResizeObserver) {
    estado.heatmapResizeObserver = new ResizeObserver(() => {
      clearTimeout(estado.heatmapResizeTimer);
      estado.heatmapResizeTimer = setTimeout(() => renderAprHeatmap(), 120);
    });
    estado.heatmapResizeObserver.observe(heatmapMainEl);
  }

  maybeStartAprendizadoTips();
  unsubscribeProfile = store.subscribe("profile", () => maybeStartAprendizadoTips());

  // etapa 6: expõe o replay pro botão de ajuda global (screen-tips-registry.js)
  currentReplayFn = () => replayAprendizadoTips();
  registerScreenTipsReplay(currentReplayFn);

  // atalhos da tela (lista aparece em Alt+H / menu de ajuda)
  shortcutsToken = registerScreenShortcuts({
    name: 'aprendizado',
    actions: [
      { code: 'KeyN', label: 'nova trilha', run: shortcutNewTrack },
      { code: 'KeyE', label: 'editar a trilha selecionada (ou voltar da edição)', run: shortcutToggleEdit, when: () => !!estado.selectedTrackId },
      { code: 'KeyM', label: 'novo módulo na trilha selecionada', run: shortcutNewMilestone, when: () => !!estado.selectedTrackId },
      { code: 'KeyT', label: 'ir para a lista de trilhas', run: shortcutFocusTracks },
      { code: 'KeyR', label: 'ir para os módulos da trilha (roadmap)', run: shortcutFocusRoadmap },
    ],
    hints: [
      { combos: [['↑'], ['↓']], label: 'na lista de trilhas ou de módulos: mover o foco (Home / End vão ao primeiro / último)' },
      { combos: [['Enter'], ['Espaço']], label: 'trilha: selecionar ou desmarcar · módulo: abrir detalhes (no modo edição, renomear)' },
      { combos: [['Shift', '↑'], ['Shift', '↓']], label: 'mover a trilha ou o módulo de posição (alternativa ao arrastar)' },
    ],
  });
}

export function unmount() {
  cancelActiveTipSequence();
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  estado.heatmapResizeObserver?.disconnect();
  estado.heatmapResizeObserver = null;
  clearTimeout(estado.heatmapResizeTimer);
  if (currentReplayFn) clearScreenTipsReplay(currentReplayFn);
  currentReplayFn = null;
  clearScreenShortcuts(shortcutsToken);
  shortcutsToken = null;
  estado.pendingTrackFocusId = null;
  estado.pendingRoadmapFocus = null;
  estado.containerEl = null;
  closeTrackModal();
  closeMilestoneModal();
  closeNewMilestoneModal();
  closeConfirmModal();
  estado.editingTrack = false;
  estado.selectedTrackId = null;
  estado.expandedMilestoneId = null;
  estado.tracks = [];
  estado.milestones = [];
}
