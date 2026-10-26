import * as carreiraApi from "../api/carreira.js";
import { showErrorModal } from "./err-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { noIdiomaAtual, t } from "../i18n.js";

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

const niveis = () => [
  { value: "certificacao", label: t("formacao.certificacao") },
  { value: "tecnico", label: t("formacao.tecnico") },
  { value: "pos_graduacao", label: t("formacao.pos_graduacao") },
  { value: "graduacao", label: t("formacao.graduacao") },
  { value: "mestrado", label: t("formacao.mestrado") },
  { value: "doutorado", label: t("formacao.doutorado") },
];

const statuses = () => [
  { value: "em_andamento", label: t("formacao.em_andamento") },
  { value: "concluido", label: t("formacao.concluido") },
  { value: "trancado", label: t("formacao.trancado") },
];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "education-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("formacao.nova_formacao")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field"><label for="em-curso">${t("formacao.curso")}</label><input type="text" id="em-curso" placeholder="${t("formacao.ex_ciencia_da_computacao")}"></div>
          <div class="field"><label for="em-instituicao">${t("formacao.instituicao")}</label><input type="text" id="em-instituicao" placeholder="${t("formacao.ex_usp")}"></div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="em-nivel">${t("formacao.nivel")}</label>
            <select id="em-nivel">
              ${niveis().map((n) => `<option value="${n.value}">${n.label}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="em-status">${t("formacao.status")}</label>
            <select id="em-status">
              ${statuses().map((s) => `<option value="${s.value}">${s.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label for="em-previsao">${t("formacao.previsao_de_conclusao_opcional")}</label><input type="date" id="em-previsao"></div>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="save">${t("formacao.adicionar")}</button>
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
    showErrorModal(t("formacao.preenche_curso_e_instituicao"), t("geral.atencao"));
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
    showErrorModal(err.message, editingEducation ? t("formacao.erro_ao_salvar_formacao") : t("formacao.erro_ao_criar_formacao"));
    return;
  }
  closeFormacaoModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeFormacaoModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeFormacaoModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitEducation(wrap));
}

/**
 * @param {{ education?: object, onSaved: () => Promise<void>|void }} opts
 *   `education` — se informado, o modal abre em modo edição (PUT em vez
 *   de POST) pré-preenchido com os dados da formação.
 */
export function openFormacaoModal({ education = null, onSaved } = {}) {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  onSavedCb = onSaved;
  editingEducation = education || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingEducation ? t("formacao.editar_formacao") : t("formacao.nova_formacao");
  saveBtn.textContent = editingEducation ? t("formacao.salvar_alteracoes") : "+ adicionar";

  modalEl.querySelector("#em-curso").value = editingEducation?.curso || "";
  modalEl.querySelector("#em-instituicao").value = editingEducation?.instituicao || "";
  modalEl.querySelector("#em-nivel").value = editingEducation?.nivel || niveis()[0].value;
  modalEl.querySelector("#em-status").value = editingEducation?.status || statuses()[0].value;
  modalEl.querySelector("#em-previsao").value = editingEducation?.previsao_conclusao || "";
  refreshCustomSelect(modalEl.querySelector("#em-nivel"));
  refreshCustomSelect(modalEl.querySelector("#em-status"));
  modalEl.classList.add("open");
}

export function closeFormacaoModal() {
  modalEl?.classList.remove("open");
}
