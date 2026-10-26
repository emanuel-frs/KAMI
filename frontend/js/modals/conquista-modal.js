import { createCustomAchievement } from "../api/nucleo.js";
import { enhanceSelect, refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "./err-modal.js";
import { noIdiomaAtual, t } from "../i18n.js";

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

const areas = () => [
  { value: "", label: t("conquista.qualquer_area") },
  { value: "aprendizado", label: t("conquista.aprendizado") },
  { value: "carreira", label: t("conquista.carreira") },
  { value: "financas", label: t("conquista.financas") },
  { value: "metas", label: t("conquista.metas") },
  { value: "organizacao", label: t("conquista.organizacao") },
];

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "conquista-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("conquista.nova_conquista")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <p class="settings-desc" style="margin-top:0;">${t("conquista.crie_a_sua_regra_quando")}</p>
        <div class="field"><label for="cqm-title">${t("conquista.nome")}</label><input type="text" id="cqm-title" maxlength="60" placeholder="${t("conquista.ex_poliglota")}"></div>
        <div class="field-row">
          <div class="field">
            <label for="cqm-area">${t("conquista.area")}</label>
            <select id="cqm-area">${areas().map((a) => `<option value="${a.value}">${a.label}</option>`).join("")}</select>
          </div>
          <div class="field"><label for="cqm-count">${t("conquista.quantas_acoes")}</label><input type="number" id="cqm-count" min="1" max="10000" value="10"></div>
        </div>
        <div class="field"><label for="cqm-keyword">${t("conquista.palavra_chave_opcional")}</label><input type="text" id="cqm-keyword" maxlength="40" placeholder="${t("conquista.ex_ingles_tem_que_aparecer")}"></div>
        <div class="form-actions">
          <button class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="save">${t("conquista.criar_conquista")}</button>
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
    showErrorModal(t("conquista.de_um_nome_e_diga"), t("geral.atencao"));
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
    showErrorModal(err.message, t("conquista.erro_ao_criar_conquista"));
    return;
  }
  closeConquistaModal();
  await onSavedCb?.(created);
}

/** @param {{ onSaved?: (achievement) => void }} opts */
export function openConquistaModal({ onSaved } = {}) {
  modalEl = noIdiomaAtual(modalEl, buildModal);
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
