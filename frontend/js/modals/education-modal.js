import * as carreiraApi from "../api/carreira.js";
import { showErrorModal } from "./err-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";

/**
 * Modal "nova formação" / "editar formação" — mesmo padrão dual
 * singleton de position-modal.js: passar `education` faz o modal virar
 * edição (PUT em vez de POST), pré-preenchido. `nivel` é um <select>
 * com um conjunto FIXO de valores (diferente de "tipo de vínculo" em
 * posições, que é texto livre) porque o backend usa `nivel` pra
 * escalonar o XP de conclusão (NIVEL_XP em routers/carreira.py) — só
 * esses valores são aceitos. Mudar `status` pra "concluído" aqui é o
 * que credita o XP (não o cadastro em si); reabrir uma formação já
 * concluída estorna o XP — ver docstring do endpoint PUT no backend.
 */

let modalEl = null;
let onSavedCb = null;
let editingEducation = null;

const NIVEIS = [
  { value: "certificacao", label: "certificação" },
  { value: "tecnico", label: "técnico" },
  { value: "pos_graduacao", label: "pós-graduação" },
  { value: "graduacao", label: "graduação" },
  { value: "mestrado", label: "mestrado" },
  { value: "doutorado", label: "doutorado" },
];

const STATUSES = [
  { value: "em_andamento", label: "em andamento" },
  { value: "concluido", label: "concluído" },
  { value: "trancado", label: "trancado" },
];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "education-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">nova formação</span> <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field"><label>curso</label><input type="text" id="em-curso" placeholder="ex: ciência da computação"></div>
          <div class="field"><label>instituição</label><input type="text" id="em-instituicao" placeholder="ex: usp"></div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>nível</label>
            <select id="em-nivel">
              ${NIVEIS.map((n) => `<option value="${n.value}">${n.label}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>status</label>
            <select id="em-status">
              ${STATUSES.map((s) => `<option value="${s.value}">${s.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>previsão de conclusão (opcional)</label><input type="text" id="em-previsao" placeholder="YYYY-MM-DD"></div>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="close">cancelar</button>
          <button class="btn sm primary" data-action="save">+ adicionar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  enhanceSelect(wrap.querySelector("#em-nivel"));
  enhanceSelect(wrap.querySelector("#em-status"));
  return wrap;
}

async function submitEducation(wrap) {
  const curso = wrap.querySelector("#em-curso").value.trim();
  const instituicao = wrap.querySelector("#em-instituicao").value.trim();
  if (!curso || !instituicao) {
    showErrorModal("preenche curso e instituição.", "atenção");
    return;
  }

  const payload = {
    curso,
    instituicao,
    nivel: wrap.querySelector("#em-nivel").value,
    status: wrap.querySelector("#em-status").value,
    previsao_conclusao: wrap.querySelector("#em-previsao").value.trim() || null,
  };

  try {
    if (editingEducation) {
      await carreiraApi.updateCareerEducation(editingEducation.id, payload);
    } else {
      await carreiraApi.createCareerEducation(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingEducation ? "erro ao salvar formação" : "erro ao criar formação");
    return;
  }
  closeEducationModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeEducationModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeEducationModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitEducation(wrap));
}

/**
 * @param {{ education?: object, onSaved: () => Promise<void>|void }} opts
 *   `education` — se informado, o modal abre em modo edição (PUT em vez
 *   de POST) pré-preenchido com os dados da formação.
 */
export function openEducationModal({ education = null, onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  editingEducation = education || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingEducation ? "editar formação" : "nova formação";
  saveBtn.textContent = editingEducation ? "salvar alterações" : "+ adicionar";

  modalEl.querySelector("#em-curso").value = editingEducation?.curso || "";
  modalEl.querySelector("#em-instituicao").value = editingEducation?.instituicao || "";
  modalEl.querySelector("#em-nivel").value = editingEducation?.nivel || NIVEIS[0].value;
  modalEl.querySelector("#em-status").value = editingEducation?.status || STATUSES[0].value;
  modalEl.querySelector("#em-previsao").value = editingEducation?.previsao_conclusao || "";
  refreshCustomSelect(modalEl.querySelector("#em-nivel"));
  refreshCustomSelect(modalEl.querySelector("#em-status"));
  modalEl.classList.add("open");
}

export function closeEducationModal() {
  modalEl?.classList.remove("open");
}
