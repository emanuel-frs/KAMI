import * as carreiraApi from "../api/carreira.js";
import { escapeHtml } from "../components/format.js";
import { openEducationModal } from "../modals/education-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { icon } from "../components/icons.js";

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

const NIVEL_LABELS = {
  certificacao: "certificação",
  tecnico: "técnico",
  pos_graduacao: "pós-graduação",
  graduacao: "graduação",
  mestrado: "mestrado",
  doutorado: "doutorado",
};

const STATUS_LABELS = {
  em_andamento: "em andamento",
  concluido: "concluído",
  trancado: "trancado",
};

function formatDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando formações…</div>';
  let educations = [];

  async function reload() {
    try {
      educations = await carreiraApi.listCareerEducations();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar formações: ${err.message}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-education">+ formação</button>
      </div>
      <div class="ce-list">
        ${educations.length ? educations.map((e) => `
          <div class="ce-row status-${e.status}" data-education-id="${e.id}">
            <div class="ce-top">
              <span class="ce-curso" data-edit-education="${e.id}">${escapeHtml(e.curso)}</span>
              <span class="ce-status-tag ce-status-${e.status}">${STATUS_LABELS[e.status] || e.status}</span>
              <span class="ce-remove" data-remove-education="${e.id}" data-tooltip="remover formação">${icon("x", { size: 11 })}</span>
            </div>
            <div class="ce-instituicao">${escapeHtml(e.instituicao)} · ${NIVEL_LABELS[e.nivel] || e.nivel}</div>
            ${e.previsao_conclusao && e.status === "em_andamento"
              ? `<div class="ce-previsao">previsão de conclusão: ${formatDate(e.previsao_conclusao)}</div>`
              : ""}
          </div>`).join("") : `<div class="wallet-empty">nenhuma formação registrada ainda.</div>`}
      </div>
    `;

    el.querySelectorAll("[data-edit-education]").forEach((el2) => {
      el2.addEventListener("click", () => {
        const id = el2.getAttribute("data-edit-education");
        const education = educations.find((e) => e.id === id);
        if (education) openEducationModal({ education, onSaved: reload });
      });
    });

    el.querySelectorAll("[data-remove-education]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal("remover essa formação?", { title: "remover formação", confirmText: "remover", danger: true }))) return;
        await carreiraApi.deleteCareerEducation(btn.getAttribute("data-remove-education"));
        await reload();
      });
    });

    el.querySelector('[data-action="add-education"]').addEventListener("click", () => {
      openEducationModal({ onSaved: reload });
    });
  }

  await reload();
}
