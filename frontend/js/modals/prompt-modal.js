/**
 * Modal genérico de prompt de valor único — substitui prompt(...) no
 * fluxo que ainda pedia um valor rápido pelo dialog nativo do
 * navegador (ver feedback: mesmo problema visual do alert()/confirm(),
 * um prompt() sai com o estilo bruto do navegador/OS, sem seguir o
 * tema do sistema). Mesmo padrão singleton + Promise de
 * confirm-modal.js: resolve com a string digitada, ou `null` se
 * cancelado/fechado (equivalente ao `null` que prompt() devolve).
 *
 * Uso:
 *   const valorStr = await showPromptModal("valor pago", {
 *     title: "marcar como pago",
 *     placeholder: "deixe em branco pra usar o valor esperado",
 *     inputType: "number",
 *   });
 *   if (valorStr === null) return; // cancelado
 */

let modalEl = null;
let pendingResolve = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "prompt-modal";
  wrap.innerHTML = `
    <div class="modal narrow">
      <div class="modal-head"><span id="pm-title">informar valor</span> <span class="close" data-action="cancel">×</span></div>
      <div class="modal-body">
        <div class="field">
          <label id="pm-label"></label>
          <input type="text" id="pm-input">
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="cancel">cancelar</button>
          <button class="btn sm primary" data-action="confirm">confirmar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelectorAll('[data-action="cancel"]').forEach((el) => el.addEventListener("click", () => settle(null)));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) settle(null); });
  wrap.querySelector('[data-action="confirm"]').addEventListener("click", () => settle(wrap.querySelector("#pm-input").value));
  wrap.querySelector("#pm-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") settle(wrap.querySelector("#pm-input").value);
    if (e.key === "Escape") settle(null);
  });

  return wrap;
}

function settle(result) {
  modalEl?.classList.remove("open");
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(result);
}

/**
 * @param {string} label texto do campo (ex: "valor pago")
 * @param {{ title?: string, placeholder?: string, inputType?: string, confirmText?: string, cancelText?: string }} [opts]
 * @returns {Promise<string|null>} string digitada (pode ser vazia), ou null se cancelado
 */
export function showPromptModal(label, opts = {}) {
  const { title = "informar valor", placeholder = "", inputType = "text", confirmText = "confirmar", cancelText = "cancelar" } = opts;

  modalEl = modalEl || buildModal();

  // mesma regra do confirm-modal.js: só um prompt pendente por vez —
  // resolve o anterior como cancelado antes de abrir o novo.
  if (pendingResolve) settle(null);

  modalEl.querySelector("#pm-title").textContent = title;
  modalEl.querySelector("#pm-label").textContent = label;
  const input = modalEl.querySelector("#pm-input");
  input.type = inputType;
  input.placeholder = placeholder;
  input.value = "";

  modalEl.querySelector('[data-action="confirm"]').textContent = confirmText;
  const cancelBtn = modalEl.querySelector('[data-action="cancel"].btn');
  if (cancelBtn) cancelBtn.textContent = cancelText;

  modalEl.classList.add("open");
  setTimeout(() => input.focus(), 0);

  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}
