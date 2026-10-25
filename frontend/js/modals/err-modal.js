import { playSound } from "../components/sound.js";
import { icon } from "../components/icons.js";
import { recentlyNotified } from "../components/error-notice.js";
import { noIdiomaAtual } from "../i18n.js";

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
      <div class="modal-head"><span id="em-title">erro</span> <button type="button" class="close" data-action="close" aria-label="fechar">${icon("x")}</button></div>
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
  // CONF-01: erro inesperado da API já virou toast vermelho com o mesmo
  // texto (e o código do log) — não abre um modal repetindo por cima
  if (recentlyNotified(message)) return;
  modalEl = noIdiomaAtual(modalEl, buildModal);
  modalEl.querySelector("#em-title").textContent = title;
  modalEl.querySelector("#em-message").textContent = message;
  modalEl.classList.add("open");
  playSound("erro"); // GAM-13
}

export function closeErrorModal() {
  modalEl?.classList.remove("open");
}