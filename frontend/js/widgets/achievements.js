// js/widgets/achievements.js
import { getAchievements } from "../api/nucleo.js";
import { escapeHtml, fmtRelDate } from "../components/format.js";
import { icon } from "../components/icons.js";
import { listenWhileConnected } from "../components/window-listener.js";

const BAR_CELLS = 10;

// área -> rótulo do filtro + ícone (assets/icons/) do card
const CATEGORIES = [
  { id: "nucleo", label: "núcleo", icon: "zap" },
  { id: "financas", label: "finanças", icon: "credit-card" },
  { id: "aprendizado", label: "aprendizado", icon: "star" },
  { id: "carreira", label: "carreira", icon: "trending-up" },
  { id: "metas", label: "metas", icon: "target" },
  { id: "organizacao", label: "organização", icon: "calendar-days" },
];
const ICON_BY_CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon]));

// degraus da mesma regra (GAM-01) — marca em texto, sem cor nova:
// o visual continua em uma cor de destaque só
const TIER_MARK = { bronze: "I", prata: "II", ouro: "III" };

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
 * Ordem da galeria: desbloqueadas primeiro (mais recente no topo), depois
 * bloqueadas pela fração de progresso (mais perto de destravar primeiro),
 * e por fim pelo título — assim o que dá pra conquistar logo fica à vista.
 */
export function sortAchievements(list) {
  const frac = (a) => (a.progress_target ? a.progress_current / a.progress_target : 0);
  return [...list].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked) return (b.unlocked_at ?? "").localeCompare(a.unlocked_at ?? "");
    return frac(b) - frac(a) || a.title.localeCompare(b.title);
  });
}

/**
 * Filtro de várias áreas ao mesmo tempo: cada área liga/desliga sozinha;
 * "todas" aparece ligada quando nenhuma área está selecionada e, ao
 * clicar, limpa a seleção. `selected` é um Set de ids de área.
 */
function filterButtons(achievements, selected) {
  const count = (list) => `${list.filter((a) => a.unlocked).length}/${list.length}`;
  const buttons = [{ id: "all", label: "todas", list: achievements }].concat(
    CATEGORIES.map((c) => ({ ...c, list: achievements.filter((a) => a.category === c.id) }))
  );
  return buttons
    .filter((b) => b.list.length)
    .map((b) => {
      const on = b.id === "all" ? selected.size === 0 : selected.has(b.id);
      return `<button type="button" class="ach-filter${on ? " on" : ""}" data-category="${b.id}" aria-pressed="${on}">${b.label} <span class="ach-filter-count">${count(b.list)}</span></button>`;
    })
    .join("");
}

/** Próxima seleção ao clicar numa área (ou em "todas"). */
export function toggleCategory(selected, id) {
  if (id === "all") return new Set();
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function card(a) {
  const tier = a.tier && TIER_MARK[a.tier]
    ? `<span class="ach-tier" data-tooltip="${a.tier}" aria-label="nível ${a.tier}">${TIER_MARK[a.tier]}</span>`
    : "";
  return `
    <div class="ach${a.unlocked ? " unlocked" : ""}${a.secret && !a.unlocked ? " secret" : ""}">
      <div class="ach-icon-wrap">
        <span class="ach-icon">${icon(ICON_BY_CATEGORY[a.category] ?? "star", { size: 24 })}</span>
        ${!a.unlocked ? '<span class="ach-lock">[x]</span>' : ""}
        ${tier}
      </div>
      <div class="a-title">${escapeHtml(a.title)}</div>
      <div class="a-desc">${escapeHtml(a.description ?? "")}</div>
      ${a.unlocked ? `<div class="a-date">desbloqueada ${fmtRelDate(a.unlocked_at)}</div>` : lockedStatus(a)}
    </div>`;
}

/**
 * Galeria estilo steam — reaproveitada em perfil e núcleo, mesma fonte de dados.
 * Filtro por área com várias áreas ao mesmo tempo (GAM-03), ícone por área, marca de nível (I/II/III) e
 * secretas mascaradas pelo próprio backend ("???"). Bloqueadas mostram
 * quanto falta; a galeria se atualiza sozinha quando o progress-watcher
 * avisa que algo mudou (as áreas escolhidas são mantidas).
 */
export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando conquistas…</div>';
  let selected = new Set();
  let achievements = [];

  function draw() {
    const visible = selected.size === 0
      ? achievements
      : achievements.filter((a) => selected.has(a.category));
    el.innerHTML = `
      <div class="ach-filters" role="group" aria-label="filtrar conquistas por área (dá pra escolher mais de uma)">
        ${filterButtons(achievements, selected)}
      </div>
      <div class="ach-grid">
        ${sortAchievements(visible).map(card).join("")}
      </div>
    `;
  }

  async function load() {
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
    // área que deixou de existir na lista (ex: banco restaurado) sai da seleção
    selected = new Set([...selected].filter((id) => achievements.some((a) => a.category === id)));
    draw();
  }

  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".ach-filter");
    if (!btn) return;
    const id = btn.dataset.category;
    selected = toggleCategory(selected, id);
    draw();
    el.querySelector(`.ach-filter[data-category="${id}"]`)?.focus();
  });

  await load();
  listenWhileConnected(el, "kami:action-registered", load);
}
