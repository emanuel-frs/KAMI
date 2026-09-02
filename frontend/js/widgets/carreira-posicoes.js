import * as carreiraApi from "../api/carreira.js";
import { escapeHtml } from "../components/format.js";
import { openPosicaoModal } from "../modals/posicao-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { icon } from "../components/icons.js";

/**
 * Widget "linha do tempo de posições" (seção 3 do documento de regras
 * de negócio, Parte 2 do módulo Carreira) — mesmo padrão simples de
 * dividas.js (sem paginação/filtro, lista tudo que vem de GET
 * /posicoes), mas com um traço vertical conectando os cards pra dar
 * a leitura de linha do tempo. Criar é a única ação que credita XP
 * (ver routers/carreira.py); editar/remover passam pelo mesmo modal
 * de criação (posicao-modal.js) sem mexer em XP.
 *
 * Ordenação fina "estilo LinkedIn" (posições atuais sempre no topo,
 * agrupamento por empresa etc.) fica pro polish da Parte 5 — aqui é
 * só o que já vem do backend (mais recente primeiro por start_date).
 */

function formatDate(iso) {
  if (!iso) return "atual";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando linha do tempo…</div>';
  let positions = [];

  async function reload() {
    try {
      positions = await carreiraApi.listCareerPositions();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar posições: ${err.message}</div>`;
      return;
    }
    draw();
  }

  function draw() {
    el.innerHTML = `
      <div class="widget-inline-toolbar">
        <button type="button" class="btn sm" data-action="add-position">+ posição</button>
      </div>
      <div class="cp-timeline">
        ${positions.length ? positions.map((p) => `
          <div class="cp-row${p.end_date ? "" : " atual"}" data-position-id="${p.id}">
            <div class="cp-dot"></div>
            <div class="cp-content">
              <div class="cp-top">
                <span class="cp-role" data-edit-position="${p.id}">${escapeHtml(p.role)}</span>
                <span class="cp-remove" data-remove-position="${p.id}" data-tooltip="remover posição">${icon("x", { size: 11 })}</span>
              </div>
              <div class="cp-company">${escapeHtml(p.company)}${p.area ? ` · ${escapeHtml(p.area)}` : ""}${p.employment_type ? ` · ${escapeHtml(p.employment_type)}` : ""}</div>
              <div class="cp-dates">${formatDate(p.start_date)} — ${p.end_date ? formatDate(p.end_date) : "atual"}</div>
            </div>
          </div>`).join("") : `<div class="wallet-empty">nenhuma posição registrada ainda.</div>`}
      </div>
    `;

    el.querySelectorAll("[data-edit-position]").forEach((el2) => {
      el2.addEventListener("click", () => {
        const id = el2.getAttribute("data-edit-position");
        const position = positions.find((p) => p.id === id);
        if (position) openPosicaoModal({ position, onSaved: reload });
      });
    });

    el.querySelectorAll("[data-remove-position]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!(await showConfirmModal("remover essa posição?", { title: "remover posição", confirmText: "remover", danger: true }))) return;
        await carreiraApi.deleteCareerPosition(btn.getAttribute("data-remove-position"));
        await reload();
      });
    });

    el.querySelector('[data-action="add-position"]').addEventListener("click", () => {
      openPosicaoModal({ onSaved: reload });
    });
  }

  await reload();
}
