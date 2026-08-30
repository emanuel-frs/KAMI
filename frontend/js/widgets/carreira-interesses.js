import { getCareerInterests, addCareerInterest, deleteCareerInterest } from "../api/carreira.js";
import { escapeHtml } from "../components/format.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "../modals/err-modal.js";

/**
 * Widget de interesses profissionais (seção 2 do documento de regras
 * de negócio): lista livre de tags, sem limite fixo, sem XP por
 * adicionar ou remover — metadado que ajuda a descrever a pessoa, não
 * uma ação registrada.
 *
 * Um único campo por item (a tag em si), então diferente das 3 listas
 * "de verdade" da seção 8 (posições/formações/salários, que abrem
 * janela própria pra cadastro multi-campo), aqui cadastrar é só um
 * input + botão direto no card — sem modal.
 */

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando…</div>';

  let interests;
  try {
    interests = await getCareerInterests();
  } catch (err) {
    el.innerHTML = `<div class="empty-state">erro ao carregar interesses: ${err.message}</div>`;
    return;
  }

  function renderList() {
    el.innerHTML = `
      <div class="ci-tags">
        ${
          interests.length
            ? interests
                .map(
                  (i) => `
              <span class="ci-tag">
                ${escapeHtml(i.tag)}
                <span class="ci-tag-remove" data-remove="${i.id}" data-tooltip="remover">${icon("x", { size: 10 })}</span>
              </span>`
                )
                .join("")
            : `<div class="empty-state" style="flex:1 1 100%;">nenhum interesse cadastrado ainda.</div>`
        }
      </div>
      <div class="ci-add-row">
        <input type="text" id="ci-new-tag" maxlength="40" placeholder="adicionar interesse (ex: backend, gestão, produto)">
        <button type="button" class="btn sm" data-action="add" data-tooltip="adicionar">${icon("plus", { size: 12 })}</button>
      </div>
    `;
    wire();
  }

  function wire() {
    const input = el.querySelector("#ci-new-tag");

    async function submitAdd() {
      const tag = input.value.trim();
      if (!tag) return;
      input.disabled = true;
      try {
        const created = await addCareerInterest(tag);
        interests = [...interests, created];
      } catch (err) {
        showErrorModal(err.message, "erro ao adicionar interesse");
        input.disabled = false;
        return;
      }
      renderList();
      el.querySelector("#ci-new-tag")?.focus();
    }

    el.querySelector('[data-action="add"]')?.addEventListener("click", submitAdd);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitAdd();
      }
    });

    el.querySelectorAll("[data-remove]").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const id = chip.dataset.remove;
        try {
          await deleteCareerInterest(id);
        } catch (err) {
          showErrorModal(err.message, "erro ao remover interesse");
          return;
        }
        interests = interests.filter((i) => i.id !== id);
        renderList();
      });
    });
  }

  renderList();
}
