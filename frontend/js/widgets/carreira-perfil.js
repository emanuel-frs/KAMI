import { getCareerProfile, updateCareerProfile } from "../api/carreira.js";
import { escapeHtml } from "../components/format.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "../modals/err-modal.js";
import { t } from "../i18n.js";

/**
 * Widget "campo simples" de carreira (seção 1 + seção 8 do documento
 * de regras de negócio): área atual e área-meta, editáveis a qualquer
 * momento, sem histórico próprio e sem XP.
 *
 * Segue à risca a regra de modo visualização/edição da seção 8: a
 * tela mostra só a informação (sem input nenhum aparecendo) até
 * clicar em "editar", que troca pra um formulário — nunca os dois
 * misturados. Reaproveita a infraestrutura .view-mode/.edit-mode já
 * existente em widgets/card-base.css (mesma marcação que o widget de
 * perfil usava antes de virar somente-leitura — ver profile.js) via
 * data-editable no .card + classe .editing alternada no clique.
 *
 * Não-removível (mesmo tratamento do widget "profile" em perfil.js)
 * porque é o bloco de identidade da tela — mas não é pinado
 * (data-pinned): nada impede o usuário de reordenar/redimensionar
 * este card em relação a carreira_interesses e aos próximos widgets
 * da tela (linha do tempo, formação, salário).
 */

export async function render(el, widget) {
  const cardEl = el.closest(".card");
  cardEl?.setAttribute("data-editable", "");

  el.innerHTML = `<div class="empty-state">${t("geral.carregando")}</div>`;

  let profile;
  try {
    profile = await getCareerProfile();
  } catch (err) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(t("erro.erro_ao_carregar_carreira", { erro: err.message }))}</div>`;
    return;
  }

  function renderView() {
    el.innerHTML = `
      <div class="view-mode">
        <div style="flex:1 1 220px; min-width:0;">
          <div class="vm-row"><span class="k">${t("carreira_perfil.area_atual")}</span><span class="v">${profile.area_atual ? escapeHtml(profile.area_atual) : "—"}</span></div>
          <div class="vm-row"><span class="k">${t("carreira_perfil.area_meta")}</span><span class="v">${profile.area_meta ? escapeHtml(profile.area_meta) : "—"}</span></div>
        </div>
        <button type="button" class="btn sm" data-action="edit" style="display:flex; align-items:center; gap:5px;">${icon("pencil", { size: 11 })} ${t("geral.editar")}</button>
      </div>
      <div class="edit-mode">
        <div style="flex:1 1 100%; display:flex; flex-direction:column; gap:12px;">
          <div class="field-row">
            <div class="field"><label for="cp-atual">${t("carreira_perfil.area_atual")}</label><input type="text" id="cp-atual" maxlength="80" value="${escapeHtml(profile.area_atual ?? "")}" placeholder="${t("carreira_perfil.ex_desenvolvimento_backend")}"></div>
            <div class="field"><label for="cp-meta">${t("carreira_perfil.area_meta")}</label><input type="text" id="cp-meta" maxlength="80" value="${escapeHtml(profile.area_meta ?? "")}" placeholder="${t("carreira_perfil.ex_arquitetura_de_software")}"></div>
          </div>
          <div style="display:flex; gap:6px; justify-content:flex-end;">
            <button type="button" class="btn sm" data-action="cancel">${t("geral.cancelar")}</button>
            <button type="button" class="btn sm primary" data-action="save">${t("geral.salvar")}</button>
          </div>
        </div>
      </div>
    `;
    wire();
  }

  function wire() {
    el.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
      cardEl?.classList.add("editing");
      el.querySelector("#cp-atual")?.focus();
    });

    el.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
      cardEl?.classList.remove("editing");
      renderView(); // descarta qualquer edição não salva, volta pro valor atual
    });

    el.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
      const area_atual = el.querySelector("#cp-atual").value;
      const area_meta = el.querySelector("#cp-meta").value;
      try {
        profile = await updateCareerProfile({ area_atual, area_meta });
      } catch (err) {
        showErrorModal(err.message, t("carreira_perfil.erro_ao_salvar_carreira"));
        return;
      }
      cardEl?.classList.remove("editing");
      renderView();
    });
  }

  renderView();
}
