import { icon } from "../components/icons.js";

/**
 * Modal "filtrar registros" — mesmo padrão singleton dos outros modais
 * (ver transaction-modal.js). Filtro é só client-side sobre os dados já
 * carregados por financas-registros.js: não muda nenhum endpoint, só
 * devolve um objeto { contaId, categoria, type } (campos vazios =
 * "sem filtro nesse campo") via onApply.
 */

let modalEl = null;
let onApplyCb = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "registro-filter-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">filtrar registros <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field">
          <label>conta</label>
          <select id="rfm-conta"><option value="">— todas —</option></select>
        </div>
        <div class="field">
          <label>categoria</label>
          <select id="rfm-categoria"><option value="">— todas —</option></select>
        </div>
        <div class="field">
          <label>tipo</label>
          <select id="rfm-tipo">
            <option value="">— todos —</option>
            <option value="entrada">entrada</option>
            <option value="saida">saída</option>
            <option value="transferencia">transferência</option>
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
    contaId: wrap.querySelector("#rfm-conta").value || null,
    categoria: wrap.querySelector("#rfm-categoria").value || null,
    type: wrap.querySelector("#rfm-tipo").value || null,
  };
  closeRegistroFilterModal();
  onApplyCb?.(filter);
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeRegistroFilterModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeRegistroFilterModal(); });
  wrap.querySelector('[data-action="apply"]').addEventListener("click", () => applyFilter(wrap));
  wrap.querySelector('[data-action="clear"]').addEventListener("click", () => {
    wrap.querySelector("#rfm-conta").value = "";
    wrap.querySelector("#rfm-categoria").value = "";
    wrap.querySelector("#rfm-tipo").value = "";
    applyFilter(wrap);
  });
}

/**
 * @param {{ accounts: Array, categories: Array<string>, current: object, onApply: (filter) => void }} opts
 *   `accounts` já achatadas com bankNome (mesmo formato dos outros
 *   modais). `categories` — lista de categorias distintas presentes
 *   nos registros do mês atual (calculada por quem chama). `current`
 *   — filtro já aplicado, pra reabrir o modal com os campos preenchidos.
 */
export function openRegistroFilterModal({ accounts, categories, current, onApply } = {}) {
  modalEl = modalEl || buildModal();
  onApplyCb = onApply;

  const contaSel = modalEl.querySelector("#rfm-conta");
  contaSel.innerHTML = `<option value="">— todas —</option>` +
    (accounts || []).map((a) => `<option value="${a.id}">${a.bankNome} — ${a.nome}</option>`).join("");

  const catSel = modalEl.querySelector("#rfm-categoria");
  catSel.innerHTML = `<option value="">— todas —</option>` +
    (categories || []).map((c) => `<option value="${c}">${c}</option>`).join("");

  contaSel.value = current?.contaId || "";
  catSel.value = current?.categoria || "";
  modalEl.querySelector("#rfm-tipo").value = current?.type || "";

  modalEl.classList.add("open");
}

export function closeRegistroFilterModal() {
  modalEl?.classList.remove("open");
}
