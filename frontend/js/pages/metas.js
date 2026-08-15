import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  contributeGoal,
  listContributions,
} from "../api/metas.js";
import { listBanks } from "../api/wallet.js";
import { listTracks } from "../api/aprendizado.js";
import { escapeHtml, fmtDateBR, fmtMoney } from "../components/format.js";
import { icon } from "../components/icons.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { showErrorModal } from "../modals/err-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { renderProgressChart } from "../charts/metas-grafico-progresso.js";
import { store } from "../state/store.js";
import { maybeStartMetasTips, replayMetasTips } from "./metas-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";

// ─── constantes (espelham GOAL_TYPES/GOAL_WEIGHTS de app/routers/metas.py) ──
const GOAL_TYPES_MANUAL = ["financeira", "livre", "saude", "leitura", "habito"];
const GOAL_TYPE_LABELS = {
  financeira: "financeira",
  livre: "livre",
  saude: "saúde",
  leitura: "leitura",
  habito: "hábito",
  aprendizado: "aprendizado",
};
// placeholder do campo "unidade" no modal — só cosmético, ajuda a lembrar o
// tipo de valor esperado sem travar o usuário num vocabulário fixo
const UNIT_LABEL_PLACEHOLDER = {
  livre: "ex: vezes, unidades...",
  saude: "ex: kg, cm...",
  leitura: "ex: páginas, livros...",
  habito: "ex: vezes, dias...",
};
const GOAL_WEIGHT_XP_MULT = { baixo: 0.5, medio: 1.0, alto: 1.75, epico: 3.0 };
const XP_GOAL_COMPLETED_BONUS = 30;

function xpBonusFor(weight) {
  return Math.round(XP_GOAL_COMPLETED_BONUS * (GOAL_WEIGHT_XP_MULT[weight] ?? 1));
}

// ─── estado ────────────────────────────────────────────────────────────────
let containerEl = null;
let goals = [];
// ids de metas com o painel de gráfico de progresso aberto — precisa
// sobreviver a re-renders (ex: depois de uma contribuição), senão o
// painel fecharia sozinho toda vez que a lista é atualizada
let openProgressGoalIds = new Set();
// dicas contextuais (etapa 5) — mesmo padrão de núcleo/perfil/finanças:
// unsubscribeProfile cobre a corrida do primeiro boot (tela pode montar
// antes do onboarding geral terminar), currentReplayFn é o que fica
// registrado pro botão de ajuda global chamar via "rever dicas desta tela".
let unsubscribeProfile = null;
let currentReplayFn = null;

// ─── helpers de formatação ─────────────────────────────────────────────────
function fmtDeadline(iso) {
  return iso ? fmtDateBR(iso.slice(0, 10)) : "";
}

function fmtCount(v) {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function goalValuesText(goal) {
  const cur = goal.unit === "money" ? fmtMoney(goal.current_value) : fmtCount(goal.current_value);
  const target = goal.unit === "money" ? fmtMoney(goal.target_value) : fmtCount(goal.target_value);
  if (goal.type === "aprendizado") return `${cur} / ${target} módulos`;
  const suffix = goal.unit === "count" && goal.unit_label ? ` ${goal.unit_label}` : "";
  return `${cur} / ${target}${suffix}`;
}

function getGoal(id) {
  return goals.find((g) => g.id === id);
}

async function navigateToAprendizado() {
  document.querySelector('.nav-link[data-page="aprendizado"]')?.click();
}

// ─── modal: criar/editar meta (decisão 18 — criação/edição sempre em modal) ─
let goalModalEl = null;
let goalModalEditingId = null; // null = criando

function buildGoalModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "goal-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span id="goal-modal-title">nova meta</span>
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>título</label>
          <input type="text" id="goal-title-input" placeholder="ex: fundo de emergência">
        </div>
        <div class="field-row">
          <div class="field">
            <label>tipo</label>
            <select id="goal-type-input">
              ${GOAL_TYPES_MANUAL.map((t) => `<option value="${t}">${GOAL_TYPE_LABELS[t]}</option>`).join("")}
              <option value="aprendizado">aprendizado (trilha)</option>
              <option value="academica" disabled>acadêmica (pós-mvp)</option>
            </select>
          </div>
          <div class="field">
            <label>peso (xp)</label>
            <select id="goal-weight-input">
              <option value="baixo">baixo</option>
              <option value="medio">médio</option>
              <option value="alto">alto</option>
              <option value="epico">épico</option>
            </select>
          </div>
        </div>

        <div class="field" id="goal-track-field">
          <label>trilha</label>
          <select id="goal-track-input"></select>
        </div>

        <div class="field-row">
          <div class="field">
            <label id="goal-target-label">alvo</label>
            <input type="number" id="goal-target-input" placeholder="5000" min="0.01" step="0.01">
          </div>
          <div class="field">
            <label>prazo (opcional)</label>
            <input type="date" id="goal-deadline-input">
          </div>
        </div>

        <div class="field" id="goal-unit-label-field">
          <label>unidade (opcional)</label>
          <input type="text" id="goal-unit-label-input" placeholder="ex: kg, páginas...">
        </div>

        <div class="field" id="goal-conta-field">
          <label>conta padrão (opcional)</label>
          <select id="goal-conta-input"></select>
        </div>

        <div class="goal-modal-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
        <button type="button" class="btn primary" id="goal-modal-save" style="width:100%;">criar meta</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-action="close"]').addEventListener("click", closeGoalModal);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeGoalModal(); });
  wrap.querySelector("#goal-modal-save").addEventListener("click", saveGoalModal);
  wrap.querySelector("#goal-type-input").addEventListener("change", () => updateGoalModalVisibility(wrap));
  wrap.querySelector("#goal-track-input").addEventListener("change", () => applyTrackDefaultTarget(wrap));
  enhanceSelect(wrap.querySelector("#goal-type-input"));
  enhanceSelect(wrap.querySelector("#goal-weight-input"));
  return wrap;
}

function updateGoalModalVisibility(wrap) {
  const type = wrap.querySelector("#goal-type-input").value;
  const isAprendizado = type === "aprendizado";
  const isFinanceira = type === "financeira";

  wrap.querySelector("#goal-track-field").style.display = isAprendizado ? "block" : "none";
  wrap.querySelector("#goal-conta-field").style.display = isFinanceira ? "block" : "none";
  wrap.querySelector("#goal-unit-label-field").style.display =
    !isAprendizado && !isFinanceira ? "block" : "none";

  wrap.querySelector("#goal-target-label").textContent = isAprendizado ? "quantos módulos" : "alvo";
  wrap.querySelector("#goal-unit-label-input").placeholder = UNIT_LABEL_PLACEHOLDER[type] || "ex: unidades...";
}

// pré-preenche o alvo com o total de módulos da trilha escolhida — só um
// ponto de partida cômodo ("terminar a trilha inteira"), o usuário pode
// editar pra um número menor ("só os 3 primeiros módulos")
function applyTrackDefaultTarget(wrap) {
  const trackId = wrap.querySelector("#goal-track-input").value;
  const track = wrap.__tracks?.find((t) => t.id === trackId);
  if (track) {
    wrap.querySelector("#goal-target-input").value = track.total_milestones || 1;
  }
}

async function populateGoalModalSelects(wrap, { selectedContaId = "", selectedTrackId = "" } = {}) {
  const contaSelect = wrap.querySelector("#goal-conta-input");
  const trackSelect = wrap.querySelector("#goal-track-input");
  contaSelect.innerHTML = `<option value="">nenhuma</option>`;
  trackSelect.innerHTML = `<option value="">carregando…</option>`;
  refreshCustomSelect(contaSelect);
  refreshCustomSelect(trackSelect);

  try {
    const [banks, tracks] = await Promise.all([listBanks(), listTracks()]);
    const accountsFlat = banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
    wrap.__tracks = tracks;

    contaSelect.innerHTML =
      `<option value="">nenhuma</option>` +
      accountsFlat.map((a) => `<option value="${a.id}">${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}</option>`).join("");
    contaSelect.value = selectedContaId || "";
    refreshCustomSelect(contaSelect);

    trackSelect.innerHTML = tracks.length
      ? tracks.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")
      : `<option value="">nenhuma trilha cadastrada</option>`;
    trackSelect.value = selectedTrackId || (tracks[0]?.id ?? "");
    refreshCustomSelect(trackSelect);
  } catch (err) {
    trackSelect.innerHTML = `<option value="">erro ao carregar trilhas</option>`;
    refreshCustomSelect(trackSelect);
  }
}

async function openCreateGoalModal() {
  if (!goalModalEl) goalModalEl = buildGoalModal();
  goalModalEditingId = null;
  const wrap = goalModalEl;
  wrap.querySelector("#goal-modal-title").textContent = "nova meta";
  wrap.querySelector("#goal-modal-save").textContent = "criar meta";
  wrap.querySelector("#goal-title-input").value = "";
  wrap.querySelector("#goal-type-input").value = "financeira";
  refreshCustomSelect(wrap.querySelector("#goal-type-input"));
  wrap.querySelector("#goal-weight-input").value = "medio";
  refreshCustomSelect(wrap.querySelector("#goal-weight-input"));
  wrap.querySelector("#goal-target-input").value = "";
  wrap.querySelector("#goal-deadline-input").value = "";
  wrap.querySelector("#goal-unit-label-input").value = "";
  wrap.querySelector(".goal-modal-error").style.display = "none";
  updateGoalModalVisibility(wrap);
  wrap.classList.add("open");
  await populateGoalModalSelects(wrap);
}

async function openEditGoalModal(goalId) {
  const goal = getGoal(goalId);
  if (!goal) return;
  if (!goalModalEl) goalModalEl = buildGoalModal();
  goalModalEditingId = goalId;
  const wrap = goalModalEl;
  wrap.querySelector("#goal-modal-title").textContent = `editar "${goal.title}"`;
  wrap.querySelector("#goal-modal-save").textContent = "salvar";
  wrap.querySelector("#goal-title-input").value = goal.title;
  wrap.querySelector("#goal-type-input").value = goal.type;
  refreshCustomSelect(wrap.querySelector("#goal-type-input"));
  wrap.querySelector("#goal-weight-input").value = goal.weight;
  refreshCustomSelect(wrap.querySelector("#goal-weight-input"));
  wrap.querySelector("#goal-target-input").value = goal.target_value;
  wrap.querySelector("#goal-deadline-input").value = goal.deadline ? goal.deadline.slice(0, 10) : "";
  wrap.querySelector("#goal-unit-label-input").value = goal.unit_label || "";
  wrap.querySelector(".goal-modal-error").style.display = "none";
  updateGoalModalVisibility(wrap);
  wrap.classList.add("open");
  await populateGoalModalSelects(wrap, {
    selectedContaId: goal.linked_conta_id || "",
    selectedTrackId: goal.linked_track_id || "",
  });
}

function closeGoalModal() {
  if (goalModalEl) goalModalEl.classList.remove("open");
  goalModalEditingId = null;
}

async function saveGoalModal() {
  const wrap = goalModalEl;
  const errorEl = wrap.querySelector(".goal-modal-error");
  errorEl.style.display = "none";

  const title = wrap.querySelector("#goal-title-input").value.trim();
  const type = wrap.querySelector("#goal-type-input").value;
  const weight = wrap.querySelector("#goal-weight-input").value;
  const target = parseFloat(wrap.querySelector("#goal-target-input").value);
  const deadline = wrap.querySelector("#goal-deadline-input").value || null;
  const unitLabel = wrap.querySelector("#goal-unit-label-input").value.trim() || null;
  const contaId = wrap.querySelector("#goal-conta-input").value || null;
  const trackId = wrap.querySelector("#goal-track-input").value || null;

  if (!title) {
    errorEl.textContent = "digite um título para a meta.";
    errorEl.style.display = "block";
    return;
  }
  if (!target || target <= 0) {
    errorEl.textContent = type === "aprendizado"
      ? "informe quantos módulos essa meta precisa concluir."
      : "o alvo precisa ser um número maior que zero.";
    errorEl.style.display = "block";
    return;
  }
  if (type === "aprendizado" && !trackId) {
    errorEl.textContent = "escolha a trilha vinculada a essa meta.";
    errorEl.style.display = "block";
    return;
  }

  const payload = {
    title,
    type,
    target_value: target,
    deadline,
    weight,
    unit_label: type === "financeira" || type === "aprendizado" ? null : unitLabel,
    linked_conta_id: type === "financeira" ? contaId : null,
    linked_track_id: type === "aprendizado" ? trackId : null,
  };

  try {
    if (goalModalEditingId) {
      await updateGoal(goalModalEditingId, {
        ...payload,
        clear_deadline: !deadline,
        clear_unit_label: !payload.unit_label,
        clear_linked_conta_id: !payload.linked_conta_id,
      });
    } else {
      await createGoal(payload);
    }
  } catch (err) {
    errorEl.textContent = `erro ao salvar: ${err.message}`;
    errorEl.style.display = "block";
    return;
  }
  closeGoalModal();
  await refreshGoals();
}

// ─── modal: contribuir (valor livre, decisão explícita — não é passo fixo) ──
let contributeModalEl = null;
let contributingGoalId = null;

function buildContributeModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "goal-contribute-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span id="goal-contribute-title">contribuir</span>
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body">
        <div class="field" id="goal-contribute-origem-field">
          <label>de onde vem esse valor?</label>
          <select id="goal-contribute-origem-input">
            <option value="conta">de uma conta (sai o saldo de verdade)</option>
            <option value="externo">externo (presente, ajuda de terceiro...)</option>
          </select>
        </div>
        <div class="field" id="goal-contribute-conta-field">
          <label>conta</label>
          <select id="goal-contribute-conta-input"></select>
        </div>
        <div class="field">
          <label id="goal-contribute-amount-label">valor</label>
          <input type="number" id="goal-contribute-amount" min="0.01" step="0.01">
        </div>
        <div class="field">
          <label>nota (opcional)</label>
          <input type="text" id="goal-contribute-note" placeholder="ex: sobrou do salário desse mês">
        </div>
        <div class="goal-contribute-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
        <button type="button" class="btn primary" id="goal-contribute-save" style="width:100%;">+ contribuir</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-action="close"]').addEventListener("click", closeContributeModal);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeContributeModal(); });
  wrap.querySelector("#goal-contribute-save").addEventListener("click", saveContribution);
  wrap.querySelector("#goal-contribute-origem-input").addEventListener("change", () => updateContributeModalVisibility(wrap));
  enhanceSelect(wrap.querySelector("#goal-contribute-origem-input"));
  return wrap;
}

function updateContributeModalVisibility(wrap) {
  const goal = getGoal(contributingGoalId);
  const isFinanceira = goal?.type === "financeira";
  wrap.querySelector("#goal-contribute-origem-field").style.display = isFinanceira ? "block" : "none";
  const origem = wrap.querySelector("#goal-contribute-origem-input").value;
  wrap.querySelector("#goal-contribute-conta-field").style.display =
    isFinanceira && origem === "conta" ? "block" : "none";
}

async function openContributeModal(goalId) {
  const goal = getGoal(goalId);
  if (!goal) return;
  if (!contributeModalEl) contributeModalEl = buildContributeModal();
  contributingGoalId = goalId;
  const wrap = contributeModalEl;
  wrap.querySelector("#goal-contribute-title").textContent = `contribuir para "${goal.title}"`;
  wrap.querySelector("#goal-contribute-amount-label").textContent =
    goal.unit === "money" ? "valor (R$)" : `quantidade${goal.unit_label ? ` (${goal.unit_label})` : ""}`;
  wrap.querySelector("#goal-contribute-amount").value = "";
  wrap.querySelector("#goal-contribute-note").value = "";
  wrap.querySelector("#goal-contribute-origem-input").value = "conta";
  refreshCustomSelect(wrap.querySelector("#goal-contribute-origem-input"));
  wrap.querySelector(".goal-contribute-error").style.display = "none";
  updateContributeModalVisibility(wrap);
  wrap.classList.add("open");
  wrap.querySelector("#goal-contribute-amount").focus();

  if (goal.type === "financeira") {
    const contaSelect = wrap.querySelector("#goal-contribute-conta-input");
    contaSelect.innerHTML = `<option value="">carregando…</option>`;
    refreshCustomSelect(contaSelect);
    try {
      const banks = await listBanks();
      const accountsFlat = banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome })));
      contaSelect.innerHTML = accountsFlat.length
        ? accountsFlat.map((a) => `<option value="${a.id}">${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}</option>`).join("")
        : `<option value="">nenhuma conta cadastrada</option>`;
      contaSelect.value = goal.linked_conta_id || accountsFlat[0]?.id || "";
      refreshCustomSelect(contaSelect);
    } catch (err) {
      contaSelect.innerHTML = `<option value="">erro ao carregar contas</option>`;
      refreshCustomSelect(contaSelect);
    }
  }
}

function closeContributeModal() {
  if (contributeModalEl) contributeModalEl.classList.remove("open");
  contributingGoalId = null;
}

async function saveContribution() {
  const wrap = contributeModalEl;
  const errorEl = wrap.querySelector(".goal-contribute-error");
  errorEl.style.display = "none";

  const goal = getGoal(contributingGoalId);
  const amount = parseFloat(wrap.querySelector("#goal-contribute-amount").value);
  const note = wrap.querySelector("#goal-contribute-note").value.trim() || null;

  if (!amount || amount <= 0) {
    errorEl.textContent = "informe um valor maior que zero.";
    errorEl.style.display = "block";
    return;
  }

  const payload = { amount, note };
  if (goal?.type === "financeira") {
    payload.origem = wrap.querySelector("#goal-contribute-origem-input").value;
    if (payload.origem === "conta") {
      payload.conta_id = wrap.querySelector("#goal-contribute-conta-input").value || null;
      if (!payload.conta_id) {
        errorEl.textContent = "escolha uma conta pra contribuir a partir dela.";
        errorEl.style.display = "block";
        return;
      }
    }
  }

  try {
    await contributeGoal(contributingGoalId, payload);
  } catch (err) {
    errorEl.textContent = `erro ao contribuir: ${err.message}`;
    errorEl.style.display = "block";
    return;
  }
  closeContributeModal();
  window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
  await refreshGoals();
}

// ─── renderização ───────────────────────────────────────────────────────────

function goalCardHtml(goal) {
  const isDone = goal.status === "concluida";
  const isLearning = goal.type === "aprendizado";
  const pct = Math.min(100, goal.progress_pct ?? 0);

  return `
    <div class="card goal-card${isDone ? " done" : ""}" data-goal-id="${goal.id}">
      <div class="card-head">
        <span class="goal-title">${escapeHtml(goal.title)}</span>
        <span class="goal-type-tag">${GOAL_TYPE_LABELS[goal.type] || goal.type}</span>
        <span class="goal-weight-tag goal-weight-${goal.weight}">${goal.weight}</span>
        <span class="push goal-card-icons">
          ${isLearning ? "" : `<span class="icon-btn" data-action="toggle-progress" data-tooltip="ver progresso">${icon("trending_up", { size: 13 })}</span>`}
          <span class="icon-btn" data-action="edit-goal" data-tooltip="editar">${icon("pencil", { size: 15 })}</span>
          <span class="icon-btn danger" data-action="delete-goal" data-tooltip="excluir">🗑</span>
        </span>
      </div>
      <div class="card-body">
        <div class="bar-track"><div class="bar-fill${isDone ? " alt" : ""}" style="width:${pct}%;"></div></div>
        <div class="goal-values">
          <span>${goalValuesText(goal)}</span>
          <span>${pct}%</span>
        </div>
        ${goal.deadline ? `<div class="goal-meta">prazo: ${fmtDeadline(goal.deadline)}</div>` : ""}
        ${isLearning && goal.linked_track_name
          ? `<div class="goal-meta">sincronizado com a trilha «${escapeHtml(goal.linked_track_name)}»</div>`
          : ""
        }
        ${isDone
          ? `<div class="goal-meta">concluída${goal.completed_at ? " em " + fmtDeadline(goal.completed_at) : ""} · +${xpBonusFor(goal.weight)} xp bônus</div>
             <button type="button" class="btn sm" disabled>meta concluída ✓</button>`
          : isLearning
            ? `<button type="button" class="btn sm" data-action="ver-trilha">ver trilha →</button>`
            : `<button type="button" class="btn sm primary" data-action="contribute-goal">+ contribuir</button>`
        }
        ${isLearning ? "" : `
        <div class="goal-progress-panel${openProgressGoalIds.has(goal.id) ? " open" : ""}" data-progress-panel="${goal.id}">
          <div class="empty-state">carregando…</div>
        </div>`}
      </div>
    </div>
  `;
}

function render() {
  const active = goals.filter((g) => g.status !== "concluida");
  const done = goals.filter((g) => g.status === "concluida");

  const activeEl = containerEl.querySelector("#goals-grid-active");
  const doneEl = containerEl.querySelector("#goals-grid-done");

  activeEl.innerHTML = active.length
    ? active.map(goalCardHtml).join("")
    : `<div class="empty-state">nenhuma meta ativa no momento.</div>`;

  doneEl.innerHTML = done.length
    ? done.map(goalCardHtml).join("")
    : `<div class="empty-state">nenhuma meta concluída ainda.</div>`;

  wireCardActions(activeEl);
  wireCardActions(doneEl);

  // painéis de progresso abertos somem no innerHTML acima (marcação já sai
  // com a classe "open", mas o conteúdo interno precisa ser recarregado) —
  // recarrega os que ainda existem e esquece os de metas que sumiram
  [...openProgressGoalIds].forEach((goalId) => {
    if (getGoal(goalId)) {
      loadProgressPanel(goalId);
    } else {
      openProgressGoalIds.delete(goalId);
    }
  });

  const focusId = consumePendingFocus("meta");
  if (focusId) focusRow(containerEl.querySelector(`.goal-card[data-goal-id="${focusId}"]`), "meta");
}

async function loadProgressPanel(goalId) {
  const panel = containerEl?.querySelector(`[data-progress-panel="${goalId}"]`);
  const goal = getGoal(goalId);
  if (!panel || !goal) return;
  panel.innerHTML = `<div class="empty-state">carregando…</div>`;
  try {
    const contributions = await listContributions(goalId);
    renderProgressChart(panel, goal, contributions);
  } catch (err) {
    panel.innerHTML = `<div class="empty-state">erro ao carregar gráfico: ${err.message}</div>`;
  }
}

function toggleProgressPanel(goalId) {
  const panel = containerEl.querySelector(`[data-progress-panel="${goalId}"]`);
  if (!panel) return;
  if (openProgressGoalIds.has(goalId)) {
    openProgressGoalIds.delete(goalId);
    panel.classList.remove("open");
    return;
  }
  openProgressGoalIds.add(goalId);
  panel.classList.add("open");
  loadProgressPanel(goalId);
}

function wireCardActions(scopeEl) {
  scopeEl.querySelectorAll(".goal-card").forEach((card) => {
    const goalId = card.dataset.goalId;
    const goal = getGoal(goalId);
    if (!goal) return;

    card.querySelector('[data-action="toggle-progress"]')?.addEventListener("click", () => {
      toggleProgressPanel(goalId);
    });

    card.querySelector('[data-action="edit-goal"]').addEventListener("click", () => {
      openEditGoalModal(goalId);
    });

    card.querySelector('[data-action="delete-goal"]').addEventListener("click", async () => {
      const ok = await showConfirmModal(
        `Excluir a meta "${goal.title}"? O histórico de contribuições também será apagado (transações reais já lançadas em Finanças continuam lá).`,
        { title: "excluir meta", confirmText: "excluir", danger: true }
      );
      if (!ok) return;
      try {
        await deleteGoal(goalId);
        await refreshGoals();
      } catch (err) {
        showErrorModal(err.message, "erro ao excluir");
      }
    });

    const contributeBtn = card.querySelector('[data-action="contribute-goal"]');
    if (contributeBtn) {
      contributeBtn.addEventListener("click", () => openContributeModal(goalId));
    }

    const verTrilhaBtn = card.querySelector('[data-action="ver-trilha"]');
    if (verTrilhaBtn) {
      verTrilhaBtn.addEventListener("click", navigateToAprendizado);
    }
  });
}

async function refreshGoals() {
  const activeEl = containerEl.querySelector("#goals-grid-active");
  const doneEl = containerEl.querySelector("#goals-grid-done");
  try {
    goals = await listGoals();
  } catch (err) {
    activeEl.innerHTML = `<div class="empty-state">erro ao carregar metas: ${err.message}</div>`;
    doneEl.innerHTML = "";
    return;
  }
  render();
}

// ─── montagem / desmontagem ─────────────────────────────────────────────────

export async function mount(container) {
  containerEl = container;
  container.innerHTML = `
    <div class="goals-toolbar">
      <button type="button" class="btn sm push" id="goals-add-btn">+ nova meta</button>
    </div>

    <div class="goals-section-label" id="goals-section-active">ativas</div>
    <div class="goals-grid" id="goals-grid-active"><div class="empty-state">carregando…</div></div>

    <div class="goals-section-label" id="goals-section-done">histórico — metas concluídas</div>
    <div class="goals-grid" id="goals-grid-done"></div>
  `;

  container.querySelector("#goals-add-btn").addEventListener("click", openCreateGoalModal);

  await refreshGoals();

  maybeStartMetasTips();
  unsubscribeProfile = store.subscribe("profile", () => maybeStartMetasTips());

  // etapa 6: expõe o replay pro botão de ajuda global (screen-tips-registry.js)
  currentReplayFn = () => replayMetasTips();
  registerScreenTipsReplay(currentReplayFn);
}

export function unmount() {
  cancelActiveTipSequence();
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  if (currentReplayFn) clearScreenTipsReplay(currentReplayFn);
  currentReplayFn = null;
  closeGoalModal();
  closeContributeModal();
  containerEl = null;
  goals = [];
  openProgressGoalIds = new Set();
}
