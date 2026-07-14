// js/widgets/priorities.js
import { getAttributes } from "../api/nucleo.js";
import { listGoals } from "../api/metas.js";
import { escapeHtml, fmtDateBR } from "./format.js";

/** "Atenção agora": atributo mais atrasado + meta com prazo mais próximo. */
export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando prioridades…</div>';

  async function load() {
    let attributes, goals;
    try {
      [attributes, goals] = await Promise.all([getAttributes(), listGoals()]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar prioridades: ${err.message}</div>`;
      return;
    }

    const rows = [];
    const lowest = [...attributes].sort((a, b) => a.current_level - b.current_level)[0];
    if (lowest) {
      rows.push(`
        <div class="log-item">
          <span class="desc">atributo mais atrasado: <b style="color:var(--amber);">${escapeHtml(lowest.name)}</b> (lvl ${lowest.current_level})</span>
        </div>`);
    }

    const upcoming = goals
      .filter((g) => g.deadline && g.status !== "concluida")
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    if (upcoming.length) {
      const g = upcoming[0];
      rows.push(`
        <div class="log-item">
          <span class="desc">meta mais próxima do prazo: <b style="color:var(--accent);">${escapeHtml(g.title)}</b></span>
          <span class="meta">${fmtDateBR(g.deadline)}</span>
        </div>`);
    }

    rows.push(`
      <div class="log-item">
        <span class="desc">sem decaimento de xp no v1 — cálculo simplificado (decisão 10)</span>
      </div>`);

    el.innerHTML = rows.join("");
  }

  await load();
  window.addEventListener("kami:action-registered", load);
}