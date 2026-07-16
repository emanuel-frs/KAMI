import {
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  contributeGoal,
} from "../api/metas.js";
import { escapeHtml, fmtDateBR, fmtMoney } from "../widgets/format.js";

// ─── estado ────────────────────────────────────────────────────────────────
let containerEl = null;
let goals = [];

// ─── helpers de formatação ─────────────────────────────────────────────────
// fmtDateBR espera "YYYY-MM-DD" puro — o campo deadline já vem assim do
// backend, mas garantimos o slice(0,10) pra não quebrar se algum dia virar
// um datetime completo.
function fmtDeadline(iso) {
  return iso ? fmtDateBR(iso.slice(0, 10)) : "";
}

function fmtCount(v) {
  // valores "livres" não são sempre inteiros redondos (ex: 2.5kg) — mas o
  // caso comum (contador tipo "3x na academia") fica melhor sem casas
  // decimais soltas
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtValue(v, unit) {
  return unit === "money" ? fmtMoney(v) : fmtCount(v);
}

function getGoal(id) {
  return goals.find((g) => g.id === id);
}

// ─── modal: confirmação genérica (excluir meta) ────────────────────────────
let confirmModalEl = null;
let confirmModalCallback = null;

function buildConfirmModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "goal-confirm-modal";
  wrap.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-head">
        <span>confirmar</span>
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body">
        <div id="goal-confirm-text" style="font-size:12px;color:var(--text-dim);line-height:1.5;margin-bottom:16px;"></div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn" data-action="confirm-yes" style="color:var(--red);border-color:var(--red);">excluir</button>
          <button type="button" class="btn sm" data-action="cancel">cancelar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-action="close"]').addEventListener("click", closeConfirmModal);
  wrap.querySelector('[data-action="cancel"]').addEventListener("click", closeConfirmModal);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeConfirmModal(); });
  wrap.querySelector('[data-action="confirm-yes"]').addEventListener("click", () => {
    const cb = confirmModalCallback;
    closeConfirmModal();
    if (cb) cb();
  });
  return wrap;
}

function openConfirmModal(text, onConfirm) {
  if (!confirmModalEl) confirmModalEl = buildConfirmModal();
  confirmModalEl.querySelector("#goal-confirm-text").textContent = text;
  confirmModalCallback = onConfirm;
  confirmModalEl.classList.add("open");
}

function closeConfirmModal() {
  if (confirmModalEl) confirmModalEl.classList.remove("open");
  confirmModalCallback = null;
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
        <div class="field">
          <label>tipo</label>
          <select id="goal-type-input">
            <option value="financeira">financeira</option>
            <option value="livre">livre</option>
            <option value="academica" disabled>acadêmica (pós-mvp)</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field">
            <label>alvo</label>
            <input type="number" id="goal-target-input" placeholder="5000" min="0.01" step="0.01">
          </div>
          <div class="field">
            <label>prazo (opcional)</label>
            <input type="date" id="goal-deadline-input">
          </div>
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
  return wrap;
}

function openCreateGoalModal() {
  if (!goalModalEl) goalModalEl = buildGoalModal();
  goalModalEditingId = null;
  const wrap = goalModalEl;
  wrap.querySelector("#goal-modal-title").textContent = "nova meta";
  wrap.querySelector("#goal-modal-save").textContent = "criar meta";
  wrap.querySelector("#goal-title-input").value = "";
  wrap.querySelector("#goal-type-input").value = "financeira";
  wrap.querySelector("#goal-target-input").value = "";
  wrap.querySelector("#goal-deadline-input").value = "";
  wrap.querySelector(".goal-modal-error").style.display = "none";
  wrap.classList.add("open");
}

function openEditGoalModal(goalId) {
  const goal = getGoal(goalId);
  if (!goal) return;
  if (!goalModalEl) goalModalEl = buildGoalModal();
  goalModalEditingId = goalId;
  const wrap = goalModalEl;
  wrap.querySelector("#goal-modal-title").textContent = `editar "${goal.title}"`;
  wrap.querySelector("#goal-modal-save").textContent = "salvar";
  wrap.querySelector("#goal-title-input").value = goal.title;
  wrap.querySelector("#goal-type-input").value = goal.type;
  wrap.querySelector("#goal-target-input").value = goal.target_value;
  wrap.querySelector("#goal-deadline-input").value = goal.deadline ? goal.deadline.slice(0, 10) : "";
  wrap.querySelector(".goal-modal-error").style.display = "none";
  wrap.classList.add("open");
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
  const target = parseFloat(wrap.querySelector("#goal-target-input").value);
  const deadline = wrap.querySelector("#goal-deadline-input").value || null;

  if (!title) {
    errorEl.textContent = "digite um título para a meta.";
    errorEl.style.display = "block";
    return;
  }
  if (!target || target <= 0) {
    errorEl.textContent = "o alvo precisa ser um número maior que zero.";
    errorEl.style.display = "block";
    return;
  }

  try {
    if (goalModalEditingId) {
      await updateGoal(goalModalEditingId, {
        title,
        type,
        target_value: target,
        deadline,
        clear_deadline: !deadline,
      });
    } else {
      await createGoal({ title, type, target_value: target, deadline });
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
  return wrap;
}

function openContributeModal(goalId) {
  const goal = getGoal(goalId);
  if (!goal) return;
  if (!contributeModalEl) contributeModalEl = buildContributeModal();
  contributingGoalId = goalId;
  const wrap = contributeModalEl;
  wrap.querySelector("#goal-contribute-title").textContent = `contribuir para "${goal.title}"`;
  wrap.querySelector("#goal-contribute-amount-label").textContent =
    goal.unit === "money" ? "valor (R$)" : "quantidade";
  wrap.querySelector("#goal-contribute-amount").value = "";
  wrap.querySelector("#goal-contribute-note").value = "";
  wrap.querySelector(".goal-contribute-error").style.display = "none";
  wrap.classList.add("open");
  wrap.querySelector("#goal-contribute-amount").focus();
}

function closeContributeModal() {
  if (contributeModalEl) contributeModalEl.classList.remove("open");
  contributingGoalId = null;
}

async function saveContribution() {
  const wrap = contributeModalEl;
  const errorEl = wrap.querySelector(".goal-contribute-error");
  errorEl.style.display = "none";

  const amount = parseFloat(wrap.querySelector("#goal-contribute-amount").value);
  const note = wrap.querySelector("#goal-contribute-note").value.trim() || null;

  if (!amount || amount <= 0) {
    errorEl.textContent = "informe um valor maior que zero.";
    errorEl.style.display = "block";
    return;
  }

  try {
    await contributeGoal(contributingGoalId, { amount, note });
  } catch (err) {
    errorEl.textContent = `erro ao contribuir: ${err.message}`;
    errorEl.style.display = "block";
    return;
  }
  closeContributeModal();
  await refreshGoals();
}

// ─── renderização ───────────────────────────────────────────────────────────

function goalCardHtml(goal) {
  const isDone = goal.status === "concluida";
  const pct = Math.min(100, goal.progress_pct ?? 0);
  const curTxt = fmtValue(goal.current_value, goal.unit);
  const targetTxt = fmtValue(goal.target_value, goal.unit);

  return `
    <div class="card goal-card${isDone ? " done" : ""}" data-goal-id="${goal.id}">
      <div class="card-head">
        <span class="goal-title">${escapeHtml(goal.title)}</span>
        <span class="goal-type-tag">${goal.type}</span>
        <span class="push goal-card-icons">
          <span class="icon-btn" data-action="edit-goal" data-tooltip="editar">✎</span>
          <span class="icon-btn danger" data-action="delete-goal" data-tooltip="excluir">🗑</span>
        </span>
      </div>
      <div class="card-body">
        <div class="bar-track"><div class="bar-fill${isDone ? " alt" : ""}" style="width:${pct}%;"></div></div>
        <div class="goal-values">
          <span>${curTxt} / ${targetTxt}</span>
          <span>${pct}%</span>
        </div>
        ${goal.deadline ? `<div class="goal-meta">prazo: ${fmtDeadline(goal.deadline)}</div>` : ""}
        ${isDone
          ? `<div class="goal-meta">concluída${goal.completed_at ? " em " + fmtDeadline(goal.completed_at) : ""} · +${30} xp bônus</div>
             <button type="button" class="btn sm" disabled>meta concluída ✓</button>`
          : `<button type="button" class="btn sm primary" data-action="contribute-goal">+ contribuir</button>`
        }
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
}

function wireCardActions(scopeEl) {
  scopeEl.querySelectorAll(".goal-card").forEach((card) => {
    const goalId = card.dataset.goalId;
    const goal = getGoal(goalId);
    if (!goal) return;

    card.querySelector('[data-action="edit-goal"]').addEventListener("click", () => {
      openEditGoalModal(goalId);
    });

    card.querySelector('[data-action="delete-goal"]').addEventListener("click", () => {
      openConfirmModal(`Excluir a meta "${goal.title}"? O histórico de contribuições também será apagado.`, async () => {
        try {
          await deleteGoal(goalId);
          await refreshGoals();
        } catch (err) {
          alert(`Erro ao excluir: ${err.message}`);
        }
      });
    });

    const contributeBtn = card.querySelector('[data-action="contribute-goal"]');
    if (contributeBtn) {
      contributeBtn.addEventListener("click", () => openContributeModal(goalId));
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

    <div class="goals-section-label">ativas</div>
    <div class="goals-grid" id="goals-grid-active"><div class="empty-state">carregando…</div></div>

    <div class="goals-section-label">histórico — metas concluídas</div>
    <div class="goals-grid" id="goals-grid-done"></div>
  `;

  container.querySelector("#goals-add-btn").addEventListener("click", openCreateGoalModal);

  await refreshGoals();
}

export function unmount() {
  closeGoalModal();
  closeContributeModal();
  closeConfirmModal();
  containerEl = null;
  goals = [];
}