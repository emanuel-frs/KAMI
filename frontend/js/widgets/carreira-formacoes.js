import * as carreiraApi from "../api/carreira.js";
import { escapeHtml, fmtData } from "../components/format.js";
import { openFormacaoModal } from "../modals/formacao-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { icon } from "../components/icons.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { t } from "../i18n.js";

/**
 * Widget "formação acadêmica" (seção 4 do documento de regras de
 * negócio, Parte 3 do módulo Carreira) — mesmo padrão simples de
 * carreira-posicoes.js (sem paginação/filtro, lista tudo que vem de
 * GET /formacoes), mas sem o traço de linha do tempo (formações não
 * têm uma ordem cronológica tão relevante quanto posições — várias
 * podem estar "em andamento" ao mesmo tempo). Criar SÓ credita XP se
 * já nascer com status='concluido' (cadastro retroativo); o caminho
 * comum é editar depois pra marcar como concluída, que é quando o XP
 * escalonado por nível entra — ver routers/carreira.py.
 */

const nivelLabels = () => ({
  certificacao: t("carreira_formacoes.certificacao"),
  tecnico: t("carreira_formacoes.tecnico"),
  pos_graduacao: t("carreira_formacoes.pos_graduacao"),
  graduacao: t("carreira_formacoes.graduacao"),
  mestrado: "mestrado",
  doutorado: "doutorado",
});

const statusLabels = () => ({
  em_andamento: t("carreira_formacoes.em_andamento"),
  concluido: t("carreira_formacoes.concluido"),
  trancado: "trancado",
});

function formatDate(iso) {
  if (!iso) return null;
  return fmtData(iso); // ORG-07: formatador único
}

export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("carreira_formacoes.carregando_formacoes")}</div>`;
  let educations = [];

  async function reload() {
    try {
      educations = await carreiraApi.listCareerEducations();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("erro.erro_ao_carregar_formacoes", { erro: err.message }))}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-education">${t("carreira_formacoes.formacao")}</button>
      </div>
      <div class="ce-list">
        ${educations.length ? educations.map((e) => `
          <div class="ce-row status-${e.status}" data-education-id="${e.id}">
            <div class="ce-top">
              <span class="ce-curso" data-edit-education="${e.id}" data-tooltip="${escapeHtml(e.curso)}">${escapeHtml(e.curso)}</span>
              <span class="ce-status-tag ce-status-${e.status}">${statusLabels()[e.status] || e.status}</span>
              <span class="ce-remove" data-remove-education="${e.id}" data-tooltip="${t("carreira_formacoes.remover_formacao")}" aria-label="${t("carreira_formacoes.remover_formacao")}">${icon("x", { size: 11 })}</span>
            </div>
            <div class="ce-instituicao">${escapeHtml(e.instituicao)} · ${nivelLabels()[e.nivel] || e.nivel}</div>
            ${e.previsao_conclusao && e.status === "em_andamento"
              ? `<div class="ce-previsao">previsão de conclusão: ${formatDate(e.previsao_conclusao)}</div>`
              : ""}
          </div>`).join("") : `<div class="wallet-empty">${t("carreira_formacoes.nenhuma_formacao_registrada_ainda")}</div>`}
      </div>
    `;

    el.querySelectorAll("[data-edit-education]").forEach((el2) => {
      el2.addEventListener("click", () => {
        const id = el2.getAttribute("data-edit-education");
        const education = educations.find((e) => e.id === id);
        if (education) openFormacaoModal({ education, onSaved: reload });
      });
    });

    el.querySelectorAll("[data-remove-education]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal(t("carreira_formacoes.remover_essa_formacao"), { title: t("carreira_formacoes.remover_formacao"), confirmText: "remover", danger: true }))) return;
        await carreiraApi.deleteCareerEducation(btn.getAttribute("data-remove-education"));
        await reload();
      });
    });

    el.querySelector('[data-action="add-education"]').addEventListener("click", () => {
      openFormacaoModal({ onSaved: reload });
    });
  }

  await reload();
  // ORG-03: item escolhido na busca (Ctrl+K)
  const pedido = consumePendingFocus("formacao");
  if (pedido) focusRow(el.querySelector(`[data-education-id="${CSS.escape(pedido)}"]`), "formacao");
}
