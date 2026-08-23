import { icon } from "../components/icons.js";

/**
 * Modal genérico de erro — substitui alert(err.message) nos catches de
 * chamada de API. Mesmo padrão singleton dos outros modais (ver
 * avatar-modal.js): DOM construído uma vez, reaproveitado depois.
 *
 * Uso: showErrorModal(err.message) ou showErrorModal(err.message, "erro ao lançar")
 */

let modalEl = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "error-modal";
  wrap.innerHTML = `
    <div class="modal narrow">
      <div class="modal-head"><span id="em-title">erro</span> <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <p id="em-message" class="em-message"></p>
        <div class="form-actions">
          <button class="btn sm primary" data-action="close">ok</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeErrorModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeErrorModal(); });
  return wrap;
}

export function showErrorModal(message, title = "erro") {
  modalEl = modalEl || buildModal();
  modalEl.querySelector("#em-title").textContent = title;
  modalEl.querySelector("#em-message").textContent = message;
  modalEl.classList.add("open");
}

export function closeErrorModal() {
  modalEl?.classList.remove("open");
}