// js/widgets/priorities.js
import { getAttributes } from "../api/nucleo.js";
import { listGoals } from "../api/metas.js";
import { escapeHtml, fmtDateBR } from "../components/format.js";
import { listenWhileConnected } from "../components/window-listener.js";

/** "Atenção agora": atributo mais atrasado + meta com prazo mais próximo. */
export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando prioridades…</div>';

  async function load() {
    let attributes, goals;
    try {
      [attributes, goals] = await Promise.all([getAttributes(), listGoals()]);
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar prioridades: ${escapeHtml(err.message)}</div>`;
      return;
    }

    const rows = [];
    // GAM-08: o backend diz qual atributo rende 2× (mesma regra do bônus,
    // app/bonus.py — com desempate por xp, e nenhum se todos empatados)
    const behind = attributes.find((a) => a.bonus_atrasado);
    const lowest = behind ?? [...attributes].sort((a, b) => a.current_level - b.current_level)[0];
    if (lowest) {
      rows.push(`
        <div class="log-item">
          <span class="desc">atributo mais atrasado: <b style="color:var(--amber);">${escapeHtml(lowest.name)}</b> (lvl ${lowest.current_level})</span>
          ${behind ? '<span class="meta">ações aqui rendem 2×</span>' : ""}
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

    el.innerHTML = rows.join("");
  }

  await load();
  listenWhileConnected(el, "kami:action-registered", load);
}