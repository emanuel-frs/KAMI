import * as carteiraApi from "../api/carteira.js";
import { showErrorModal } from "./err-modal.js";
import { refreshCustomSelect } from "../components/custom-select.js";
import { icon } from "../components/icons.js";
import { escapeHtml } from "../components/format.js";
import { noIdiomaAtual, t } from "../i18n.js";

/**
 * Modal "nova assinatura" / "editar assinatura" — mesmo padrão dual
 * singleton de fixed-bill-modal.js: passar `subscription` faz o modal
 * virar edição (PUT em vez de POST), pré-preenchido com os dados da
 * assinatura, incluindo o checkbox "ativa" (antes só existia
 * implicitamente via `active` no backend, sem UI pra desativar sem
 * deletar — item 1).
 *
 * Conta é opcional — sem ela, a assinatura continua sendo só lembrete;
 * com ela, marcar como paga passa a poder gerar uma transação real (ver
 * widgets/financas-assinaturas.js e app/finance_utils.py — item 6). `categoria` alimenta essa transação quando
 * gerada.
 */

let modalEl = null;
let onSavedCb = null;
let editingSubscription = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "subscription-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><span class="modal-head-title">${t("assinatura.nova_assinatura")}</span> <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button></div>
      <div class="modal-body">
        <div class="field"><label for="sm-nome">${t("assinatura.nome")}</label><input type="text" id="sm-nome" placeholder="${t("assinatura.ex_streaming_academia")}"></div>
        <div class="field-row">
          <div class="field"><label for="sm-valor">${t("assinatura.valor_esperado")}</label><input type="number" id="sm-valor" placeholder="0.00"></div>
          <div class="field"><label for="sm-dia">${t("assinatura.dia_de_cobranca")}</label><input type="number" id="sm-dia" min="1" max="31" placeholder="10"></div>
        </div>
        <div class="field">
          <label for="sm-conta">${t("assinatura.conta_vinculada_opcional_habilita_descontar")}</label>
          <select id="sm-conta"><option value="">${t("assinatura.nenhuma_so_lembrete")}</option></select>
        </div>
        <div class="field"><label for="sm-categoria">${t("assinatura.categoria_opcional")}</label><input type="text" id="sm-categoria" placeholder="${t("assinatura.ex_streaming_assinaturas")}"></div>
        <label class="account-flag"><input type="checkbox" id="sm-active" checked> ${t("assinatura.ativa")}</label>
        <div class="form-actions">
          <button class="btn sm" data-action="close">${t("geral.cancelar")}</button>
          <button class="btn sm primary" data-action="save">${t("assinatura.adicionar")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

async function submitSubscription(wrap) {
  const nome = wrap.querySelector("#sm-nome").value.trim();
  const valor = Number(wrap.querySelector("#sm-valor").value);
  const dia = Number(wrap.querySelector("#sm-dia").value);
  if (!nome || !valor || !dia) { showErrorModal(t("assinatura.preenche_nome_valor_e_dia"), t("geral.atencao")); return; }

  const payload = {
    nome,
    valor_esperado: valor,
    dia_cobranca: dia,
    conta_id: wrap.querySelector("#sm-conta").value || null,
    categoria: wrap.querySelector("#sm-categoria").value.trim() || null,
    active: wrap.querySelector("#sm-active").checked,
  };

  try {
    if (editingSubscription) {
      await carteiraApi.updateSubscription(editingSubscription.id, payload);
    } else {
      await carteiraApi.createSubscription(payload);
    }
  } catch (err) {
    showErrorModal(err.message, editingSubscription ? t("assinatura.erro_ao_salvar_assinatura") : t("assinatura.erro_ao_criar_assinatura"));
    return;
  }
  closeAssinaturaModal();
  await onSavedCb?.();
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", closeAssinaturaModal));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeAssinaturaModal(); });
  wrap.querySelector('[data-action="save"]').addEventListener("click", () => submitSubscription(wrap));
}

/**
 * @param {{ subscription?: object, accounts?: Array, onSaved: () => Promise<void>|void }} opts
 *   `subscription` — se informado, o modal abre em modo edição (PUT em
 *   vez de POST) pré-preenchido com os dados da assinatura.
 *   `accounts` — contas já achatadas (com bankNome), mesmo formato usado
 *   em fixed-bill-modal.js.
 */
export function openAssinaturaModal({ subscription = null, accounts = [], onSaved } = {}) {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  onSavedCb = onSaved;
  editingSubscription = subscription || null;

  const titleEl = modalEl.querySelector(".modal-head-title");
  const saveBtn = modalEl.querySelector('[data-action="save"]');
  titleEl.textContent = editingSubscription ? t("assinatura.editar_assinatura") : t("assinatura.nova_assinatura");
  saveBtn.textContent = editingSubscription ? t("assinatura.salvar_alteracoes") : "+ adicionar";

  modalEl.querySelector("#sm-nome").value = editingSubscription?.nome || "";
  modalEl.querySelector("#sm-valor").value = editingSubscription?.valor_esperado ?? "";
  modalEl.querySelector("#sm-dia").value = editingSubscription?.dia_cobranca ?? "";
  modalEl.querySelector("#sm-categoria").value = editingSubscription?.categoria || "";
  modalEl.querySelector("#sm-active").checked = editingSubscription ? !!editingSubscription.active : true;

  modalEl.querySelector("#sm-conta").innerHTML =
    `<option value="">${t("assinatura.nenhuma_so_lembrete")}</option>` +
    (accounts || []).map((a) => `<option value="${a.id}">${escapeHtml(a.bankNome)} — ${escapeHtml(a.nome)}</option>`).join("");
  modalEl.querySelector("#sm-conta").value = editingSubscription?.conta_id || "";
  refreshCustomSelect(modalEl.querySelector("#sm-conta"));

  modalEl.classList.add("open");
}

export function closeAssinaturaModal() {
  modalEl?.classList.remove("open");
}
