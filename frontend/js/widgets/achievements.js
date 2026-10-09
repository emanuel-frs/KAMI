// js/widgets/achievements.js
import { getAchievements } from "../api/nucleo.js";
import { escapeHtml, fmtRelDate } from "../components/format.js";
import { icon } from "../components/icons.js";
import { listenWhileConnected } from "../components/window-listener.js";

const BAR_CELLS = 10;

/** "[####------]" — progresso em blocos de texto, mesmo estilo de terminal do resto do app. */
function asciiBar(current, target) {
  const filled = target > 0 ? Math.round((current / target) * BAR_CELLS) : 0;
  return `[${"#".repeat(filled)}${"-".repeat(BAR_CELLS - filled)}]`;
}

function lockedStatus(a) {
  // conquista de "tem ou não tem" (alvo 1) não ganha barra — 0/1 não diz nada
  if (a.progress_target <= 1) return '<div class="a-status">bloqueada</div>';
  return `
    <div class="a-status a-progress" aria-label="progresso ${a.progress_current} de ${a.progress_target}">
      <span class="a-bar" aria-hidden="true">${asciiBar(a.progress_current, a.progress_target)}</span>
      <span>${a.progress_current}/${a.progress_target}</span>
    </div>`;
}

/**
 * Galeria estilo steam — reaproveitada em perfil e núcleo, mesma fonte de dados.
 * Bloqueadas mostram quanto falta (progress_current/progress_target, ver
 * GET /api/nucleo/achievements); a galeria se atualiza sozinha quando o
 * progress-watcher avisa que algo mudou.
 */
export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando conquistas…</div>';

  async function load() {
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
              <span class="ach-icon">${icon("star", { size: 24, fill: true })}</span>
              ${!a.unlocked ? '<span class="ach-lock">[x]</span>' : ""}
            </div>
            <div class="a-title">${escapeHtml(a.title)}</div>
            <div class="a-desc">${escapeHtml(a.description ?? "")}</div>
            ${
              a.unlocked
                ? `<div class="a-date">desbloqueada ${fmtRelDate(a.unlocked_at)}</div>`
                : lockedStatus(a)
            }
          </div>`
          )
          .join("")}
      </div>
    `;
  }

  await load();
  listenWhileConnected(el, "kami:action-registered", load);
}
