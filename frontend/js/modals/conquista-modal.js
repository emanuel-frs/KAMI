import { createCustomAchievement } from "../api/nucleo.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "./err-modal.js";

/**
 * Modal "nova conquista" (GAM-14) — o usuário cria a própria regra:
 * nome + área + quantidade de ações + palavra-chave opcional (procurada na
 * descrição da ação). Vira uma conquista da galeria como as outras, com a
 * marca "sua" (widgets/achievements.js); a contagem é feita no backend
 * (critério custom_count em app/achievements.py), sem contar bônus nem
 * ação manual do Núcleo. Mesmo padrão dos outros modais de formulário
 * (divida-modal.js): construído uma vez, reaberto limpo.
 */

let modalEl = null;
let onSavedCb = null;

const AREAS = [
  { value: "", label: "qualquer área" },
  { value: "aprendizado", label: "aprendizado" },
  { value: "carreira", label: "carreira" },
  { value: "financas", label: "finanças" },
  { value: "metas", label: "metas" },
  { value: "organizacao", label: "organização" },
];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "conquista-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">nova conquista</span> <button type="button" class="close" data-action="close" aria-label="fechar">${icon("x")}</button></div>
      <div class="modal-body">
        <p class="settings-desc" style="margin-top:0;">crie a sua regra: quando você fizer X ações (numa área, com uma palavra na descrição, se quiser), ela desbloqueia. ações manuais do núcleo não contam.</p>
        <div class="field"><label for="cqm-title">nome</label><input type="text" id="cqm-title" maxlength="60" placeholder="ex: poliglota"></div>
        <div class="field-row">
          <div class="field">
            <label for="cqm-area">área</label>
            <select id="cqm-area">${AREAS.map((a) => `<option value="${a.value}">${a.label}</option>`).join("")}</select>
          </div>
          <div class="field"><label for="cqm-count">quantas ações</label><input type="number" id="cqm-count" min="1" max="10000" value="10"></div>
        </div>
        <div class="field"><label for="cqm-keyword">palavra-chave (opcional)</label><input type="text" id="cqm-keyword" maxlength="40" placeholder="ex: inglês — tem que aparecer na descrição da ação"></div>
        <div class="form-actions">
          <button class="btn sm" data-action="close">cancelar</button>
          <button class="btn sm primary" data-action="save">+ criar conquista</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeConquistaModal));
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeConquistaModal();
  });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submit(wrap));
  enhanceSelect(wrap.querySelector("#cqm-area"));
  return wrap;
}

async function submit(wrap) {
  const title = wrap.querySelector("#cqm-title").value.trim();
  const count = Number(wrap.querySelector("#cqm-count").value);
  if (!title || !Number.isInteger(count) || count < 1) {
    showErrorModal("dê um nome e diga quantas ações (1 ou mais).", "atenção");
    return;
  }
  let created;
  try {
    created = await createCustomAchievement({
      title,
      attribute: wrap.querySelector("#cqm-area").value || null,
      count,
      keyword: wrap.querySelector("#cqm-keyword").value.trim() || null,
    });
  } catch (err) {
    showErrorModal(err.message, "erro ao criar conquista");
    return;
  }
  closeConquistaModal();
  await onSavedCb?.(created);
}

/** @param {{ onSaved?: (achievement) => void }} opts */
export function openConquistaModal({ onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  modalEl.querySelector("#cqm-title").value = "";
  modalEl.querySelector("#cqm-count").value = "10";
  modalEl.querySelector("#cqm-keyword").value = "";
  modalEl.querySelector("#cqm-area").value = "";
  refreshCustomSelect(modalEl.querySelector("#cqm-area"));
  modalEl.classList.add("open");
}

export function closeConquistaModal() {
  modalEl?.classList.remove("open");
}
