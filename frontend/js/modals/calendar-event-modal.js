import * as calendarioApi from "../api/calendario.js";
import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";

/**
 * Modal "novo evento" / "editar evento" — único tipo do calendário com
 * CRUD próprio (calendar_events, ver app/routers/calendario.py). Mesmo
 * padrão de fixed-bill-modal.js/account-modal.js: passar `event` faz o
 * modal virar edição (PUT em vez de POST), com um botão de remover a
 * mais (não existe uma tela de lista própria pra esse tipo — o painel
 * do dia no calendário É a lista, então excluir mora aqui dentro).
 *
 * `event` recebido aqui é o registro cru de calendar_events (id, title,
 * date, time, notes, recurrence, recurrence_end,
 * reminder_minutes_before) — não o evento agregado da grade (que tem
 * id composto "evento:{id}:{data}"), então quem chama precisa separar
 * o id real antes de abrir (ver pages/calendario.js).
 */

let modalEl = null;
let onSavedCb = null;
let onDeletedCb = null;
let editingEvent = null;

const REMINDER_OPTIONS = [
  { value: "", label: "sem lembrete" },
  { value: "0", label: "na hora" },
  { value: "5", label: "5 min antes" },
  { value: "15", label: "15 min antes" },
  { value: "30", label: "30 min antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 dia antes" },
];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "calendar-event-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">novo evento</span> <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field"><label>título</label><input type="text" id="cem-title" placeholder="ex: consulta, reunião, viagem..."></div>
        <div class="field-row">
          <div class="field"><label>data</label><input type="date" id="cem-date"></div>
          <div class="field"><label>hora (opcional)</label><input type="time" id="cem-time"></div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>repetir</label>
            <select id="cem-recurrence">
              <option value="none">não repete</option>
              <option value="daily">diariamente</option>
              <option value="weekly">semanalmente</option>
              <option value="monthly">mensalmente</option>
              <option value="yearly">anualmente</option>
            </select>
          </div>
          <div class="field" id="cem-until-field">
            <label>repetir até (opcional)</label>
            <input type="date" id="cem-until">
          </div>
        </div>
        <div class="field">
          <label>lembrete</label>
          <select id="cem-reminder">
            ${REMINDER_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>notas (opcional)</label><textarea id="cem-notes" rows="2" placeholder="detalhes, endereço, link..."></textarea></div>
        <div class="form-actions" id="cem-actions">
          <button class="btn sm danger cal-event-delete-btn" data-action="delete" id="cem-delete-btn" hidden>excluir</button>
          <button class="btn sm" data-action="close">cancelar</button>
          <button class="btn sm primary" data-action="save">+ adicionar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  enhanceSelect(wrap.querySelector("#cem-recurrence"));
  enhanceSelect(wrap.querySelector("#cem-reminder"));
  wrap.querySelector("#cem-recurrence").addEventListener("change", () => syncUntilFieldVisibility(wrap));
  return wrap;
}

function syncUntilFieldVisibility(wrap) {
  const recurrence = wrap.querySelector("#cem-recurrence").value;
  wrap.querySelector("#cem-until-field").hidden = recurrence === "none";
}

function buildPayload(wrap) {
  const title = wrap.querySelector("#cem-title").value.trim();
  const date = wrap.querySelector("#cem-date").value;
  if (!title || !date) return null;

  const reminderRaw = wrap.querySelector("#cem-reminder").value;
  const recurrence = wrap.querySelector("#cem-recurrence").value;

  return {
    title,
    date,
    time: wrap.querySelector("#cem-time").value || null,
    notes: wrap.querySelector("#cem-notes").value.trim() || null,
    recurrence,
    recurrence_end: recurrence === "none" ? null : (wrap.querySelector("#cem-until").value || null),
    reminder_minutes_before: reminderRaw === "" ? null : Number(reminderRaw),
  };
}

async function submitEvent(wrap) {
  const payload = buildPayload(wrap);
  if (!payload) { showErrorModal("preenche título e data.", "atenção"); return; }

  try {
    if (editingEvent) {
      await calendarioApi.updateEvento(editingEvent.id, payload);
    } else {
      await calendarioApi.createEvento(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingEvent ? "erro ao salvar evento" : "erro ao criar evento");
    return;
  }
  closeCalendarEventModal();
  await onSavedCb?.();
}

async function deleteEvent(wrap) {
  if (!editingEvent) return;
  const isRecurring = editingEvent.recurrence && editingEvent.recurrence !== "none";
  const ok = await showConfirmModal(
    isRecurring
      ? "remover este evento e TODAS as suas repetições? isso não afeta os outros tipos de evento do calendário (contas, dívidas, metas...)."
      : "remover este evento?",
    { title: "remover evento", confirmText: "remover", danger: true },
  );
  if (!ok) return;

  try {
    await calendarioApi.deleteEvento(editingEvent.id);
  } catch (err) {
    showErrorModal(err.message, "erro ao remover evento");
    return;
  }
  closeCalendarEventModal();
  await onDeletedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeCalendarEventModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeCalendarEventModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitEvent(wrap));
  wrap.querySelector('[data-action="delete"]').addEventListener("click", () => deleteEvent(wrap));
}

/**
 * @param {{ event?: object, date?: string, onSaved: () => Promise<void>|void, onDeleted?: () => Promise<void>|void }} opts
 *   `event` — registro cru de calendar_events; se informado, abre em modo edição.
 *   `date` — pré-preenche a data em modo criação (ex: dia selecionado no calendário).
 */
export function openCalendarEventModal({ event = null, date = null, onSaved, onDeleted } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  onDeletedCb = onDeleted;
  editingEvent = event || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  const deleteBtn = modalEl.querySelector("#cem-delete-btn");
  titleEl.textContent = editingEvent ? "editar evento" : "novo evento";
  saveBtn.textContent = editingEvent ? "salvar alterações" : "+ adicionar";
  deleteBtn.hidden = !editingEvent;

  modalEl.querySelector("#cem-title").value = editingEvent?.title || "";
  modalEl.querySelector("#cem-date").value = editingEvent?.date || date || "";
  modalEl.querySelector("#cem-time").value = editingEvent?.time || "";
  modalEl.querySelector("#cem-notes").value = editingEvent?.notes || "";
  modalEl.querySelector("#cem-recurrence").value = editingEvent?.recurrence || "none";
  modalEl.querySelector("#cem-until").value = editingEvent?.recurrence_end || "";
  const reminder = editingEvent?.reminder_minutes_before;
  modalEl.querySelector("#cem-reminder").value = reminder == null ? "" : String(reminder);
  refreshCustomSelect(modalEl.querySelector("#cem-recurrence"));
  refreshCustomSelect(modalEl.querySelector("#cem-reminder"));
  syncUntilFieldVisibility(modalEl);

  modalEl.classList.add("open");
  modalEl.querySelector("#cem-title").focus();
}

export function closeCalendarEventModal() {
  modalEl?.classList.remove("open");
}
