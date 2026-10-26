import * as calendarioApi from "../api/calendario.js";
import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { contarNotas, linkNotasHtml } from "../components/notas-vinculadas.js";
import { noIdiomaAtual, t } from "../i18n.js";

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

const reminderOptions = () => [
  { value: "", label: t("calendario_evento.sem_lembrete") },
  { value: "0", label: t("calendario_evento.na_hora") },
  { value: "5", label: t("calendario_evento.5_min_antes") },
  { value: "15", label: t("calendario_evento.15_min_antes") },
  { value: "30", label: t("calendario_evento.30_min_antes") },
  { value: "60", label: t("calendario_evento.1_hora_antes") },
  { value: "1440", label: t("calendario_evento.1_dia_antes") },
];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "calendar-event-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("calendario_evento.novo_evento")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field"><label for="cem-title">${t("calendario_evento.titulo")}</label><input type="text" id="cem-title" placeholder="${t("calendario_evento.ex_consulta_reuniao_viagem")}"></div>
        <div class="field-row">
          <div class="field"><label for="cem-date">${t("calendario_evento.data")}</label><input type="date" id="cem-date"></div>
          <div class="field"><label for="cem-time">${t("calendario_evento.hora_opcional")}</label><input type="time" id="cem-time"></div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="cem-recurrence">${t("calendario_evento.repetir")}</label>
            <select id="cem-recurrence">
              <option value="none">${t("calendario_evento.nao_repete")}</option>
              <option value="daily">${t("calendario_evento.diariamente")}</option>
              <option value="weekly">${t("calendario_evento.semanalmente")}</option>
              <option value="monthly">${t("calendario_evento.mensalmente")}</option>
              <option value="yearly">${t("calendario_evento.anualmente")}</option>
            </select>
          </div>
          <div class="field" id="cem-until-field">
            <label for="cem-until">${t("calendario_evento.repetir_ate_opcional")}</label>
            <input type="date" id="cem-until">
          </div>
        </div>
        <div class="field">
          <label for="cem-reminder">${t("calendario_evento.lembrete")}</label>
          <select id="cem-reminder">
            ${reminderOptions().map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label for="cem-notes">${t("calendario_evento.notas_opcional")}</label><textarea id="cem-notes" rows="2" placeholder="${t("calendario_evento.detalhes_endereco_link")}"></textarea></div>
        <div class="cem-notas-vinc" id="cem-notas-vinc" hidden></div>
        <div class="form-actions" id="cem-actions">
          <button class="btn sm danger cal-event-delete-btn" data-action="delete" id="cem-delete-btn" hidden>${t("calendario_evento.excluir")}</button>
          <button class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="save">${t("calendario_evento.adicionar")}</button>
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
  if (!payload) { showErrorModal(t("calendario_evento.preenche_titulo_e_data"), t("geral.atencao")); return; }

  try {
    if (editingEvent) {
      await calendarioApi.updateEvento(editingEvent.id, payload);
    } else {
      await calendarioApi.createEvento(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingEvent ? t("calendario_evento.erro_ao_salvar_evento") : t("calendario_evento.erro_ao_criar_evento"));
    return;
  }
  closeCalendarioEventoModal();
  await onSavedCb?.();
}

async function deleteEvent(wrap) {
  if (!editingEvent) return;
  const isRecurring = editingEvent.recurrence && editingEvent.recurrence !== "none";
  const ok = await showConfirmModal(
    isRecurring
      ? t("calendario_evento.remover_este_evento_e_todas")
      : t("calendario_evento.remover_este_evento"),
    { title: t("calendario_evento.remover_evento"), confirmText: t("geral.remover"), danger: true },
  );
  if (!ok) return;

  try {
    await calendarioApi.deleteEvento(editingEvent.id);
  } catch (err) {
    showErrorModal(err.message, t("calendario_evento.erro_ao_remover_evento"));
    return;
  }
  closeCalendarioEventoModal();
  await onDeletedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeCalendarioEventoModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeCalendarioEventoModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitEvent(wrap));
  wrap.querySelector('[data-action="delete"]').addEventListener("click", () => deleteEvent(wrap));
}

/**
 * @param {{ event?: object, date?: string, onSaved: () => Promise<void>|void, onDeleted?: () => Promise<void>|void }} opts
 *   `event` — registro cru de calendar_events; se informado, abre em modo edição.
 *   `date` — pré-preenche a data em modo criação (ex: dia selecionado no calendário).
 */
export function openCalendarioEventoModal({ event = null, date = null, onSaved, onDeleted, inicial = null } = {}) {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  onSavedCb = onSaved;
  onDeletedCb = onDeleted;
  editingEvent = event || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  const deleteBtn = modalEl.querySelector("#cem-delete-btn");
  titleEl.textContent = editingEvent ? t("calendario_evento.editar_evento") : t("calendario_evento.novo_evento");
  saveBtn.textContent = editingEvent ? t("calendario_evento.salvar_alteracoes") : "+ adicionar";
  deleteBtn.hidden = !editingEvent;

  // ORG-02: `inicial` = {title, time} vindo da captura rápida ("! amanhã 9h dentista")
  modalEl.querySelector("#cem-title").value = editingEvent?.title || inicial?.title || "";
  modalEl.querySelector("#cem-date").value = editingEvent?.date || date || "";
  modalEl.querySelector("#cem-time").value = editingEvent?.time || inicial?.time || "";
  modalEl.querySelector("#cem-notes").value = editingEvent?.notes || "";
  // ORG-01: evento já salvo pode ter notas vinculadas (Organização › notas)
  const vinc = modalEl.querySelector("#cem-notas-vinc");
  vinc.hidden = true;
  if (editingEvent?.id && !String(editingEvent.id).includes(":")) {
    const id = editingEvent.id;
    contarNotas("evento").then((c) => {
      if (editingEvent?.id !== id) return;
      vinc.innerHTML = linkNotasHtml("evento", id, editingEvent.title, c[id] || 0);
      vinc.hidden = false;
    });
  }
  modalEl.querySelector("#cem-recurrence").value = editingEvent?.recurrence || "none";
  modalEl.querySelector("#cem-until").value = editingEvent?.recurrence_end || "";
  const reminder = editingEvent?.reminder_minutes_before;
  modalEl.querySelector("#cem-reminder").value = reminder == null ? "" : String(reminder);
  refreshCustomSelect(modalEl.querySelector("#cem-recurrence"));
  refreshCustomSelect(modalEl.querySelector("#cem-reminder"));
  syncUntilFieldVisibility(modalEl);

  modalEl.classList.add("open");
  // O foco inicial (e a captura de quem tinha o foco antes de abrir, pra
  // devolver no Esc) já é feito por components/modal-accessibility.js —
  // um .focus() síncrono aqui rodaria ANTES do MutationObserver dele
  // processar a mudança de classe, e faria o sistema achar que o próprio
  // campo de título foi quem "abriu" o modal, quebrando o retorno de foco.
  // Mesmo padrão dos outros ~40 modais: nenhum foca campo próprio aqui.
}

export function closeCalendarioEventoModal() {
  modalEl?.classList.remove("open");
}
