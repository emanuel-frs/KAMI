import * as carteiraApi from "../api/carteira.js";
import { showErrorModal } from "./err-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { escapeHtml, fmtMesAno, formatoData, lerMesAno } from "../components/format.js";
import { noIdiomaAtual, t } from "../i18n.js";

/**
 * Modal "nova compra parcelada" / "editar compra parcelada" — mesmo
 * padrão dual singleton de fixed-bill-modal.js/subscription-modal.js:
 * passar `compra` faz o modal virar edição (PUT em vez de POST),
 * pré-preenchido com os dados da compra. A reconciliação da reserva no
 * limite (desfazer o valor antigo antes de aplicar o novo) é feita
 * inteira no backend (ver update_compra_parcelada em wallet.py) — o
 * modal só manda os dados novos.
 *
 * Conta é opcional (referência visual + destino da aplicação automática
 * na fatura, se preenchida).
 */

let modalEl = null;
let onSavedCb = null;
let editingCompra = null;

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "compra-parcelada-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("compra_parcelada.nova_compra_parcelada")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field"><label for="cpm-nome">${t("compra_parcelada.nome")}</label><input type="text" id="cpm-nome" placeholder="${t("compra_parcelada.ex_notebook_geladeira")}"></div>
        <div class="field-row">
          <div class="field"><label for="cpm-valor">${t("compra_parcelada.valor_total")}</label><input type="number" id="cpm-valor" placeholder="0.00"></div>
          <div class="field"><label for="cpm-parcelas">${t("compra_parcelada.numero_de_parcelas")}</label><input type="number" id="cpm-parcelas" min="1" placeholder="12"></div>
        </div>
        <div class="field">
          <label for="cpm-mes">${t("compra_parcelada.mes_da_1a_parcela")}</label>
          <input type="text" id="cpm-mes" inputmode="numeric" autocomplete="off">
        </div>
        <div class="field">
          <label for="cpm-conta">${t("compra_parcelada.conta_opcional_soma_a_parcela")}</label>
          <select id="cpm-conta"><option value="">${t("compra_parcelada.nenhuma")}</option></select>
        </div>
        <div class="form-actions">
          <button class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="save">${t("compra_parcelada.adicionar")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

async function submitCompraParcelada(wrap) {
  const nome = wrap.querySelector("#cpm-nome").value.trim();
  const valorTotal = Number(wrap.querySelector("#cpm-valor").value);
  const numParcelas = Number(wrap.querySelector("#cpm-parcelas").value);
  // ORG-07: o mês aparece no formato escolhido (mm/aaaa ou aaaa-mm) — o
  // campo nativo de mês sai quebrado no WebKitGTK, por isso é texto
  const mesTexto = wrap.querySelector("#cpm-mes").value.trim();
  if (!nome || !valorTotal || !numParcelas || !mesTexto) {
    showErrorModal(t("compra_parcelada.preenche_nome_valor_total_numero"), t("geral.atencao"));
    return;
  }
  const mes = lerMesAno(mesTexto);
  if (!mes) {
    showErrorModal(t("compra_parcelada.mes_invalido", { exemplo: fmtMesAno("2026-10") }), t("geral.atencao"));
    return;
  }
  const contaId = wrap.querySelector("#cpm-conta").value || null;

  const payload = {
    nome,
    valor_total: valorTotal,
    num_parcelas: numParcelas,
    conta_id: contaId,
    mes_primeira_parcela: mes,
  };

  try {
    if (editingCompra) {
      await carteiraApi.updateCompraParcelada(editingCompra.id, payload);
    } else {
      await carteiraApi.createCompraParcelada(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingCompra ? t("compra_parcelada.erro_ao_salvar_compra_parcelada") : t("compra_parcelada.erro_ao_criar_compra_parcelada"));
    return;
  }
  closeCompraParceladaModal();
  window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeCompraParceladaModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeCompraParceladaModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitCompraParcelada(wrap));
}

/**
 * @param {{ compra?: object, accounts?: Array, onSaved: () => Promise<void>|void }} opts
 *   `compra` — se informado, o modal abre em modo edição (PUT em vez de
 *   POST) pré-preenchido com os dados da compra parcelada. Note que
 *   `ajuste_parcelas` NÃO é editável aqui — isso continua sendo só pelos
 *   botões de ajuste (setas) do widget (ver compras-parceladas.js/item 7).
 */
export function openCompraParceladaModal({ compra = null, accounts = [], onSaved } = {}) {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  onSavedCb = onSaved;
  editingCompra = compra || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingCompra ? t("compra_parcelada.editar_compra_parcelada") : t("compra_parcelada.nova_compra_parcelada");
  saveBtn.textContent = editingCompra ? t("compra_parcelada.salvar_alteracoes") : "+ adicionar";

  modalEl.querySelector("#cpm-nome").value = editingCompra?.nome || "";
  modalEl.querySelector("#cpm-valor").value = editingCompra?.valor_total ?? "";
  modalEl.querySelector("#cpm-parcelas").value = editingCompra?.num_parcelas ?? "";
  modalEl.querySelector("#cpm-mes").value = fmtMesAno(editingCompra?.mes_primeira_parcela || currentMonthStr());
  modalEl.querySelector("#cpm-mes").placeholder = formatoData() === "iso" ? t("geral.formato_mes_iso") : t("geral.formato_mes");
  modalEl.querySelector("#cpm-conta").innerHTML =
    `<option value="">${t("compra_parcelada.nenhuma")}</option>` +
    (accounts || []).map((a) => `<option value="${a.id}">${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}</option>`).join("");
  modalEl.querySelector("#cpm-conta").value = editingCompra?.conta_id || "";
  refreshCustomSelect(modalEl.querySelector("#cpm-conta"));
  modalEl.classList.add("open");
}

export function closeCompraParceladaModal() {
  modalEl?.classList.remove("open");
}
