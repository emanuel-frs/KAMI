import { icon } from "../components/icons.js";

/**
 * Modal "filtrar assinaturas" — mesmo padrão de registro-filter-modal.js.
 * Filtro client-side sobre as assinaturas já carregadas: devolve
 * { contaId, status } via onApply, status é 'paga' | 'pendente' | null
 * (referente ao mês atual, mesmo period que financas-assinaturas.js
 * já resolve por assinatura).
 */

let modalEl = null;
let onApplyCb = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "assinatura-filter-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">filtrar assinaturas <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field">
          <label>conta</label>
          <select id="afm-conta"><option value="">— todas —</option></select>
        </div>
        <div class="field">
          <label>status (mês atual)</label>
          <select id="afm-status">
            <option value="">— todos —</option>
            <option value="paga">paga</option>
            <option value="pendente">não paga</option>
          </select>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="clear">limpar filtro</button>
          <button class="btn sm primary" data-action="apply">aplicar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function applyFilter(wrap) {
  const filter = {
    contaId: wrap.querySelector("#afm-conta").value || null,
    status: wrap.querySelector("#afm-status").value || null,
  };
  closeAssinaturaFilterModal();
  onApplyCb?.(filter);
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeAssinaturaFilterModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeAssinaturaFilterModal(); });
  wrap.querySelector('[data-action="apply"]').addEventListener("click", () => applyFilter(wrap));
  wrap.querySelector('[data-action="clear"]').addEventListener("click", () => {
    wrap.querySelector("#afm-conta").value = "";
    wrap.querySelector("#afm-status").value = "";
    applyFilter(wrap);
  });
}

/**
 * @param {{ accounts: Array, current: object, onApply: (filter) => void }} opts
 */
export function openAssinaturaFilterModal({ accounts, current, onApply } = {}) {
  modalEl = modalEl || buildModal();
  onApplyCb = onApply;

  const contaSel = modalEl.querySelector("#afm-conta");
  contaSel.innerHTML = `<option value="">— todas —</option>` +
    (accounts || []).map((a) => `<option value="${a.id}">${a.bankNome} — ${a.nome}</option>`).join("");

  contaSel.value = current?.contaId || "";
  modalEl.querySelector("#afm-status").value = current?.status || "";

  modalEl.classList.add("open");
}

export function closeAssinaturaFilterModal() {
  modalEl?.classList.remove("open");
}
