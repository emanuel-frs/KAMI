import * as financasApi from "../api/financas.js";
import { showErrorModal } from "./err-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";

/**
 * Modal "nova fonte de renda" / "editar fonte de renda" — mesmo padrão
 * dual singleton de fixed-bill-modal.js/subscription-modal.js. Fecha o
 * item 2 do levantamento antigo de pendências: antes não existia CRUD nenhum pro
 * usuário criar/editar/remover fontes de renda (só 2 fontes fixas
 * hardcoded no seed). Agora é um cadastro genérico:
 *
 *   frequencia: mensal | quinzenal | semanal | avulsa
 *   tipo_data (esconde/mostra os campos certos conforme a escolha):
 *     dia_fixo       -> dia_mes (só mensal)
 *     dia_util       -> nth_dia_util (só mensal)
 *     intervalo_dias -> intervalo_dias + data_base (cobre quinzenal/semanal)
 *     offset_fonte   -> fonte_referencia_id (select das outras fontes já
 *                       cadastradas, exceto a própria em edição) + offset_dias_uteis
 *
 * `avulsa` esconde tipo_data inteiro e pede só data_avulsa — uma entrada
 * única, sem gerar novas ocorrências (ver app/routers/financas.py).
 *
 * `conta_id`/`categoria` são opcionais — mesmo padrão de contas fixas/
 * assinaturas: sem conta vinculada, pagar continua sendo só lembrete;
 * com conta, pagar pode gerar uma transação 'entrada' real (ver
 * widgets/financas-renda.js e modals/pay-income-modal.js).
 */

let modalEl = null;
let onSavedCb = null;
let editingSource = null;

const TIPO_DATA_BY_FREQ = {
  mensal: [
    { value: "dia_fixo", label: "dia fixo do mês" },
    { value: "dia_util", label: "N-ésimo dia útil do mês" },
    { value: "offset_fonte", label: "depende de outra fonte" },
  ],
  quinzenal: [
    { value: "intervalo_dias", label: "a cada N dias" },
    { value: "offset_fonte", label: "depende de outra fonte" },
  ],
  semanal: [
    { value: "intervalo_dias", label: "a cada N dias" },
    { value: "offset_fonte", label: "depende de outra fonte" },
  ],
};

const DEFAULT_INTERVALO = { quinzenal: 14, semanal: 7 };

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "income-source-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">nova fonte de renda</span> <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body">
        <div class="field"><label>nome</label><input type="text" id="ism-nome" placeholder="ex: salário, freelance..."></div>
        <div class="field"><label>valor</label><input type="number" id="ism-valor" placeholder="0.00"></div>

        <div class="field">
          <label>frequência</label>
          <select id="ism-frequencia">
            <option value="mensal">mensal</option>
            <option value="quinzenal">quinzenal</option>
            <option value="semanal">semanal</option>
            <option value="avulsa">avulsa (só essa vez)</option>
          </select>
        </div>

        <div class="field" id="ism-tipo-data-field">
          <label>como calcular a data</label>
          <select id="ism-tipo-data"></select>
        </div>

        <div class="field" id="ism-dia-mes-field" style="display:none;">
          <label>dia do mês</label>
          <input type="number" id="ism-dia-mes" min="1" max="31" placeholder="5">
        </div>

        <div class="field" id="ism-nth-dia-util-field" style="display:none;">
          <label>N-ésimo dia útil</label>
          <input type="number" id="ism-nth-dia-util" min="1" placeholder="5">
        </div>

        <div class="field-row" id="ism-intervalo-fields" style="display:none;">
          <div class="field"><label>a cada quantos dias</label><input type="number" id="ism-intervalo-dias" min="1" placeholder="7"></div>
          <div class="field"><label>a partir de</label><input type="date" id="ism-data-base"></div>
        </div>

        <div class="field-row" id="ism-offset-fields" style="display:none;">
          <div class="field">
            <label>depende de</label>
            <select id="ism-fonte-referencia"></select>
          </div>
          <div class="field"><label>+ dias úteis</label><input type="number" id="ism-offset-dias" min="0" placeholder="15"></div>
        </div>

        <div class="field" id="ism-data-avulsa-field" style="display:none;">
          <label>data</label>
          <input type="date" id="ism-data-avulsa">
        </div>

        <div class="field">
          <label>conta vinculada (opcional — habilita creditar automaticamente)</label>
          <select id="ism-conta"><option value="">— nenhuma, só lembrete —</option></select>
        </div>
        <div class="field"><label>categoria (opcional)</label><input type="text" id="ism-categoria" placeholder="ex: salário, freelance..."></div>
        <label class="account-flag"><input type="checkbox" id="ism-active" checked> ativa</label>
        <div class="form-actions">
          <button class="btn sm" data-action="close">cancelar</button>
          <button class="btn sm primary" data-action="save">+ adicionar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function updateTipoDataOptions(wrap, { keepValue = null } = {}) {
  const frequencia = wrap.querySelector("#ism-frequencia").value;
  const isAvulsa = frequencia === "avulsa";

  wrap.querySelector("#ism-tipo-data-field").style.display = isAvulsa ? "none" : "block";
  wrap.querySelector("#ism-data-avulsa-field").style.display = isAvulsa ? "block" : "none";

  if (isAvulsa) {
    updateFieldVisibility(wrap, null);
    return;
  }

  const options = TIPO_DATA_BY_FREQ[frequencia] || TIPO_DATA_BY_FREQ.mensal;
  const tipoSelect = wrap.querySelector("#ism-tipo-data");
  tipoSelect.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  if (keepValue && options.some((o) => o.value === keepValue)) {
    tipoSelect.value = keepValue;
  }
  refreshCustomSelect(tipoSelect);

  // ajuda o usuário: pré-preenche intervalo_dias com 14/7 quando ele
  // troca pra quinzenal/semanal e o campo ainda está vazio
  if (DEFAULT_INTERVALO[frequencia] && !wrap.querySelector("#ism-intervalo-dias").value) {
    wrap.querySelector("#ism-intervalo-dias").value = DEFAULT_INTERVALO[frequencia];
  }

  updateFieldVisibility(wrap, tipoSelect.value);
}

function updateFieldVisibility(wrap, tipoData) {
  wrap.querySelector("#ism-dia-mes-field").style.display = tipoData === "dia_fixo" ? "block" : "none";
  wrap.querySelector("#ism-nth-dia-util-field").style.display = tipoData === "dia_util" ? "block" : "none";
  wrap.querySelector("#ism-intervalo-fields").style.display = tipoData === "intervalo_dias" ? "flex" : "none";
  wrap.querySelector("#ism-offset-fields").style.display = tipoData === "offset_fonte" ? "flex" : "none";
}

function populateFonteReferenciaOptions(wrap, sources) {
  const select = wrap.querySelector("#ism-fonte-referencia");
  const options = (sources || []).filter((s) => !editingSource || s.id !== editingSource.id);
  select.innerHTML = options.length
    ? options.map((s) => `<option value="${s.id}">${s.nome}</option>`).join("")
    : `<option value="">— nenhuma outra fonte cadastrada —</option>`;
  refreshCustomSelect(select);
}

async function submitIncomeSource(wrap) {
  const nome = wrap.querySelector("#ism-nome").value.trim();
  const valor = Number(wrap.querySelector("#ism-valor").value);
  const frequencia = wrap.querySelector("#ism-frequencia").value;
  if (!nome || !valor) { showErrorModal("preenche nome e valor.", "atenção"); return; }

  const payload = {
    nome,
    valor,
    frequencia,
    conta_id: wrap.querySelector("#ism-conta").value || null,
    categoria: wrap.querySelector("#ism-categoria").value.trim() || null,
    active: wrap.querySelector("#ism-active").checked,
    tipo_data: null,
    dia_mes: null,
    nth_dia_util: null,
    intervalo_dias: null,
    data_base: null,
    fonte_referencia_id: null,
    offset_dias_uteis: null,
    data_avulsa: null,
  };

  if (frequencia === "avulsa") {
    const dataAvulsa = wrap.querySelector("#ism-data-avulsa").value;
    if (!dataAvulsa) { showErrorModal("informa a data dessa renda avulsa.", "atenção"); return; }
    payload.data_avulsa = dataAvulsa;
  } else {
    const tipoData = wrap.querySelector("#ism-tipo-data").value;
    payload.tipo_data = tipoData;

    if (tipoData === "dia_fixo") {
      const diaMes = Number(wrap.querySelector("#ism-dia-mes").value);
      if (!diaMes) { showErrorModal("informa o dia do mês.", "atenção"); return; }
      payload.dia_mes = diaMes;
    } else if (tipoData === "dia_util") {
      const nth = Number(wrap.querySelector("#ism-nth-dia-util").value);
      if (!nth) { showErrorModal("informa o N-ésimo dia útil.", "atenção"); return; }
      payload.nth_dia_util = nth;
    } else if (tipoData === "intervalo_dias") {
      const intervalo = Number(wrap.querySelector("#ism-intervalo-dias").value);
      const dataBase = wrap.querySelector("#ism-data-base").value;
      if (!intervalo || !dataBase) { showErrorModal("informa o intervalo em dias e a data-base.", "atenção"); return; }
      payload.intervalo_dias = intervalo;
      payload.data_base = dataBase;
    } else if (tipoData === "offset_fonte") {
      const fonteRef = wrap.querySelector("#ism-fonte-referencia").value;
      const offsetDias = wrap.querySelector("#ism-offset-dias").value;
      if (!fonteRef || offsetDias === "") { showErrorModal("escolhe de qual fonte essa depende e quantos dias úteis depois.", "atenção"); return; }
      payload.fonte_referencia_id = fonteRef;
      payload.offset_dias_uteis = Number(offsetDias);
    }
  }

  try {
    if (editingSource) {
      await financasApi.updateIncomeSource(editingSource.id, payload);
    } else {
      await financasApi.createIncomeSource(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingSource ? "erro ao salvar fonte de renda" : "erro ao criar fonte de renda");
    return;
  }
  closeFonteRendaModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeFonteRendaModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeFonteRendaModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitIncomeSource(wrap));
  wrap.querySelector("#ism-frequencia").addEventListener("change", () => updateTipoDataOptions(wrap));
  wrap.querySelector("#ism-tipo-data").addEventListener("change", (e) => updateFieldVisibility(wrap, e.target.value));
}

/**
 * @param {{ source?: object, sources?: Array, accounts?: Array, onSaved: () => Promise<void>|void }} opts
 *   `source` — se informado, o modal abre em modo edição (PUT em vez de
 *   POST) pré-preenchido com os dados da fonte.
 *   `sources` — todas as fontes já cadastradas, pro select "depende de"
 *   (exclui a própria fonte quando em edição).
 *   `accounts` — contas já achatadas (com bankNome), mesmo formato usado
 *   em fixed-bill-modal.js.
 */
export function openFonteRendaModal({ source = null, sources = [], accounts = [], onSaved } = {}) {
  modalEl = modalEl || buildModal();
  onSavedCb = onSaved;
  editingSource = source || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingSource ? "editar fonte de renda" : "nova fonte de renda";
  saveBtn.textContent = editingSource ? "salvar alterações" : "+ adicionar";

  modalEl.querySelector("#ism-nome").value = editingSource?.nome || "";
  modalEl.querySelector("#ism-valor").value = editingSource?.valor ?? "";
  modalEl.querySelector("#ism-frequencia").value = editingSource?.frequencia || "mensal";
  refreshCustomSelect(modalEl.querySelector("#ism-frequencia"));
  modalEl.querySelector("#ism-categoria").value = editingSource?.categoria || "";
  modalEl.querySelector("#ism-active").checked = editingSource ? !!editingSource.active : true;

  modalEl.querySelector("#ism-dia-mes").value = editingSource?.dia_mes ?? "";
  modalEl.querySelector("#ism-nth-dia-util").value = editingSource?.nth_dia_util ?? "";
  modalEl.querySelector("#ism-intervalo-dias").value = editingSource?.intervalo_dias ?? "";
  modalEl.querySelector("#ism-data-base").value = editingSource?.data_base || "";
  modalEl.querySelector("#ism-offset-dias").value = editingSource?.offset_dias_uteis ?? "";
  modalEl.querySelector("#ism-data-avulsa").value = editingSource?.data_avulsa || "";

  populateFonteReferenciaOptions(modalEl, sources);
  modalEl.querySelector("#ism-fonte-referencia").value = editingSource?.fonte_referencia_id || "";

  updateTipoDataOptions(modalEl, { keepValue: editingSource?.tipo_data });

  modalEl.querySelector("#ism-conta").innerHTML =
    `<option value="">— nenhuma, só lembrete —</option>` +
    (accounts || []).map((a) => `<option value="${a.id}">${a.bankNome} — ${a.nome}</option>`).join("");
  modalEl.querySelector("#ism-conta").value = editingSource?.conta_id || "";
  refreshCustomSelect(modalEl.querySelector("#ism-conta"));

  modalEl.classList.add("open");
}

export function closeFonteRendaModal() {
  modalEl?.classList.remove("open");
}