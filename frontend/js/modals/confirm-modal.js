/**
 * Modal genérico de confirmação — substitui confirm(...) nos fluxos de
 * remoção/ações destrutivas. Mesmo padrão singleton dos outros modais
 * (ver err-modal.js): DOM construído uma vez, reaproveitado depois.
 *
 * Diferente dos outros modais, esse devolve uma Promise<boolean> —
 * resolve `true` se o usuário confirmar, `false` se cancelar/fechar.
 * Só uma confirmação pendente por vez (mesma limitação de confirm()).
 *
 * Uso:
 *   if (!(await showConfirmModal("remover essa conta fixa?"))) return;
 *
 *   const ok = await showConfirmModal("remover essa dívida?", {
 *     title: "remover dívida",
 *     confirmText: "remover",
 *     danger: true,
 *   });
 */

let modalEl = null;
let pendingResolve = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "confirm-modal";
  wrap.innerHTML = `
    <div class="modal narrow">
      <div class="modal-head"><span id="cm-title">confirmar</span> <span class="close" data-action="cancel">×</span></div>
      <div class="modal-body">
        <p id="cm-message" class="em-message"></p>
        <div class="form-actions">
          <button class="btn sm" data-action="cancel">cancelar</button>
          <button class="btn sm primary" id="cm-confirm-btn" data-action="confirm">confirmar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelectorAll('[data-action="cancel"]').forEach((el) => el.addEventListener("click", () => settle(false)));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) settle(false); });
  wrap.querySelector('[data-action="confirm"]').addEventListener("click", () => settle(true));

  return wrap;
}

function settle(result) {
  modalEl?.classList.remove("open");
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(result);
}

/**
 * @param {string} message
 * @param {{ title?: string, confirmText?: string, cancelText?: string, danger?: boolean }} [opts]
 *   `danger` troca o botão de confirmar pro estilo destrutivo (mesma
 *   classe usada em ações de remoção — ver base.css/.btn.danger).
 * @returns {Promise<boolean>}
 */
export function showConfirmModal(message, opts = {}) {
  const { title = "confirmar", confirmText = "confirmar", cancelText = "cancelar", danger = false } = opts;

  modalEl = modalEl || buildModal();

  // se já tinha uma confirmação pendente (não deveria acontecer no uso
  // normal, já que as ações que chamam isso ficam bloqueadas até
  // resolver), resolve como cancelada antes de abrir a nova — evita
  // vazar uma Promise pendurada pra sempre.
  if (pendingResolve) settle(false);

  modalEl.querySelector("#cm-title").textContent = title;
  modalEl.querySelector("#cm-message").textContent = message;

  const confirmBtn = modalEl.querySelector("#cm-confirm-btn");
  confirmBtn.textContent = confirmText;
  confirmBtn.classList.toggle("danger", !!danger);

  const cancelBtn = modalEl.querySelector('[data-action="cancel"].btn');
  if (cancelBtn) cancelBtn.textContent = cancelText;

  modalEl.classList.add("open");

  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}