// js/widgets/achievements.js
import { getAchievements } from "../api/nucleo.js";
import { escapeHtml, fmtRelDate } from "./format.js";

/** Galeria estilo steam — reaproveitada em perfil e núcleo, mesma fonte de dados. */
export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando conquistas…</div>';
  let achievements;
  try {
    achievements = await getAchievements();
  } catch (err) {
    el.innerHTML = `<div class="empty-state">erro ao carregar conquistas: ${err.message}</div>`;
    return;
  }

  if (!achievements.length) {
    el.innerHTML = '<div class="empty-state">nenhuma conquista cadastrada ainda.</div>';
    return;
  }

  el.innerHTML = `
    <div class="ach-grid">
      ${achievements
        .map(
          (a) => `
        <div class="ach${a.unlocked ? " unlocked" : ""}">
          <div class="ach-icon-wrap">
            <span class="ach-icon">★</span>
            ${!a.unlocked ? '<span class="ach-lock">[x]</span>' : ""}
          </div>
          <div class="a-title">${escapeHtml(a.title)}</div>
          <div class="a-desc">${escapeHtml(a.description ?? "")}</div>
          ${
            a.unlocked
              ? `<div class="a-date">desbloqueada ${fmtRelDate(a.unlocked_at)}</div>`
              : '<div class="a-status">bloqueada</div>'
          }
        </div>`
        )
        .join("")}
    </div>
  `;
}