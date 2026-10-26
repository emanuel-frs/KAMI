import * as carreiraApi from "../api/carreira.js";
import { showErrorModal } from "./err-modal.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { escapeHtml } from "../components/format.js";
import { noIdiomaAtual, t } from "../i18n.js";
import { rotuloContrato } from "../components/textos-sistema.js";

/**
 * Modal "nova posição" / "editar posição" — mesmo padrão dual singleton
 * de debt-modal.js: passar `position` faz o modal virar edição (PUT em
 * vez de POST), pré-preenchido. `end_date` em branco = posição atual
 * (múltiplas posições "atuais" são permitidas, sem validação de
 * unicidade — seção 3 do documento de regras de negócio); "tipo de
 * vínculo" é um <select> só de UI, o backend aceita qualquer texto.
 */

let modalEl = null;
let onSavedCb = null;
let editingPosition = null;

// o valor é o que fica gravado (em português); só o rótulo muda com o idioma
const EMPLOYMENT_TYPES = ["CLT", "PJ", "freelancer", "estágio", "outro"];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "position-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("posicao.nova_posicao")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field"><label for="pm-company">${t("posicao.empresa")}</label><input type="text" id="pm-company" placeholder="${t("posicao.ex_acme_ltda")}"></div>
          <div class="field"><label for="pm-role">${t("posicao.cargo")}</label><input type="text" id="pm-role" placeholder="${t("posicao.ex_dev_backend_pleno")}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="pm-area">${t("posicao.area_opcional")}</label><input type="text" id="pm-area" placeholder="${t("posicao.ex_engenharia")}"></div>
          <div class="field">
            <label for="pm-employment-type">${t("posicao.tipo_de_vinculo")}</label>
            <select id="pm-employment-type">
              ${EMPLOYMENT_TYPES.map((v) => `<option value="${v}">${escapeHtml(rotuloContrato(v))}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label for="pm-start">${t("posicao.inicio")}</label><input type="date" id="pm-start"></div>
          <div class="field"><label for="pm-end">${t("posicao.fim_opcional_em_branco_atual")}</label><input type="date" id="pm-end"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="pm-contract-end">${t("posicao.fim_de_contrato_previsto_opcional")}</label><input type="date" id="pm-contract-end"></div>
          <div class="field"><label for="pm-salary-review">${t("posicao.proxima_revisao_salarial_prevista_opcional")}</label><input type="date" id="pm-salary-review"></div>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="save">${t("posicao.adicionar")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  enhanceSelect(wrap.querySelector("#pm-employment-type"));
  return wrap;
}

async function submitPosition(wrap) {
  const company = wrap.querySelector("#pm-company").value.trim();
  const role = wrap.querySelector("#pm-role").value.trim();
  const start_date = wrap.querySelector("#pm-start").value.trim();
  if (!company || !role || !start_date) {
    showErrorModal(t("posicao.preenche_empresa_cargo_e_inicio"), t("geral.atencao"));
    return;
  }

  const payload = {
    company,
    role,
    area: wrap.querySelector("#pm-area").value.trim() || null,
    employment_type: wrap.querySelector("#pm-employment-type").value || null,
    start_date,
    end_date: wrap.querySelector("#pm-end").value.trim() || null,
    expected_contract_end: wrap.querySelector("#pm-contract-end").value.trim() || null,
    expected_salary_review: wrap.querySelector("#pm-salary-review").value.trim() || null,
  };

  try {
    if (editingPosition) {
      await carreiraApi.updateCareerPosition(editingPosition.id, payload);
    } else {
      await carreiraApi.createCareerPosition(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingPosition ? t("posicao.erro_ao_salvar_posicao") : t("posicao.erro_ao_criar_posicao"));
    return;
  }
  closePosicaoModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closePosicaoModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closePosicaoModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitPosition(wrap));
}

/**
 * @param {{ position?: object, onSaved: () => Promise<void>|void }} opts
 *   `position` — se informado, o modal abre em modo edição (PUT em vez
 *   de POST) pré-preenchido com os dados da posição.
 */
export function openPosicaoModal({ position = null, onSaved } = {}) {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  onSavedCb = onSaved;
  editingPosition = position || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingPosition ? t("posicao.editar_posicao") : t("posicao.nova_posicao");
  saveBtn.textContent = editingPosition ? t("posicao.salvar_alteracoes") : "+ adicionar";

  modalEl.querySelector("#pm-company").value = editingPosition?.company || "";
  modalEl.querySelector("#pm-role").value = editingPosition?.role || "";
  modalEl.querySelector("#pm-area").value = editingPosition?.area || "";
  modalEl.querySelector("#pm-employment-type").value = editingPosition?.employment_type || EMPLOYMENT_TYPES[0];
  modalEl.querySelector("#pm-start").value = editingPosition?.start_date || "";
  modalEl.querySelector("#pm-end").value = editingPosition?.end_date || "";
  modalEl.querySelector("#pm-contract-end").value = editingPosition?.expected_contract_end || "";
  modalEl.querySelector("#pm-salary-review").value = editingPosition?.expected_salary_review || "";
  refreshCustomSelect(modalEl.querySelector("#pm-employment-type"));
  modalEl.classList.add("open");
}

export function closePosicaoModal() {
  modalEl?.classList.remove("open");
}
