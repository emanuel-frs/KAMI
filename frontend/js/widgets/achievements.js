// js/widgets/achievements.js
import { deleteCustomAchievement, getAchievements } from "../api/nucleo.js";
import { openConquistaModal } from "../modals/conquista-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { escapeHtml, fmtRelDate } from "../components/format.js";
import { icon } from "../components/icons.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { descricaoConquista, nomeAtributo, tituloConquista } from "../components/textos-sistema.js";
import { t } from "../i18n.js";

const BAR_CELLS = 10;

// área -> rótulo do filtro + ícone (assets/icons/) do card
// (rótulo pelo idioma na hora de desenhar: núcleo é área só daqui, o resto
// são os nomes dos atributos)
const CATEGORIES = [
  { id: "nucleo", icon: "zap" },
  { id: "financas", icon: "credit-card" },
  { id: "aprendizado", icon: "star" },
  { id: "carreira", icon: "trending-up" },
  { id: "metas", icon: "target" },
  { id: "organizacao", icon: "calendar-days" },
];
const rotuloArea = (id) => (id === "nucleo" ? t("conquistas.area.nucleo") : nomeAtributo(id));
// exportado: o aviso de conquista (components/achievement-popup.js, via
// progress-watcher) usa o mesmo ícone do card da galeria
export const ICON_BY_CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon]));

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
  if (a.progress_target <= 1) return `<div class="a-status">${t("conquistas.bloqueada")}</div>`;
  return `
    <div class="a-status a-progress" aria-label="${t("conquistas.progresso_aria", { atual: a.progress_current, alvo: a.progress_target })}">
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
    return frac(b) - frac(a) || tituloConquista(a).localeCompare(tituloConquista(b));
  });
}

/**
 * Filtro de várias áreas ao mesmo tempo: cada área liga/desliga sozinha;
 * "todas" aparece ligada quando nenhuma área está selecionada e, ao
 * clicar, limpa a seleção. `selected` é um Set de ids de área.
 */
function filterButtons(achievements, selected) {
  const count = (list) => `${list.filter((a) => a.unlocked).length}/${list.length}`;
  const buttons = [{ id: "all", label: t("conquistas.todas"), list: achievements }].concat(
    CATEGORIES.map((c) => ({ ...c, label: rotuloArea(c.id), list: achievements.filter((a) => a.category === c.id) }))
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
    ? `<span class="ach-tier" data-tooltip="${t(`conquistas.tier.${a.tier}`)}" aria-label="${t("conquistas.nivel_aria", { nivel: t(`conquistas.tier.${a.tier}`) })}">${TIER_MARK[a.tier]}</span>`
    : "";
  // GAM-14: conquista criada pelo usuário — marca "sua" e botão de remover
  const custom = a.rule_type === "custom";
  const mine = custom
    ? `<span class="ach-mine" data-tooltip="${t("conquistas.sua_dica")}">${t("conquistas.sua")}</span>
       <button type="button" class="ach-remove" data-remove-custom="${escapeHtml(a.id)}" data-tooltip="${t("conquistas.remover")}" aria-label="${escapeHtml(t("conquistas.remover_aria", { titulo: tituloConquista(a) }))}">${icon("x", { size: 10 })}</button>`
    : "";
  return `
    <div class="ach${a.unlocked ? " unlocked" : ""}${a.secret && !a.unlocked ? " secret" : ""}${custom ? " custom" : ""}" data-ach-id="${escapeHtml(a.id)}">
      <div class="ach-icon-wrap">
        <span class="ach-icon">${icon(ICON_BY_CATEGORY[a.category] ?? "star", { size: 24 })}</span>
        ${!a.unlocked ? '<span class="ach-lock">[x]</span>' : ""}
        ${tier}
        ${mine}
      </div>
      <div class="a-title">${escapeHtml(tituloConquista(a))}</div>
      <div class="a-desc">${escapeHtml(descricaoConquista(a))}</div>
      ${a.unlocked ? `<div class="a-date">${t("conquistas.desbloqueada", { quando: fmtRelDate(a.unlocked_at) })}</div>` : lockedStatus(a)}
    </div>`;
}

/**
 * Galeria estilo steam — reaproveitada em perfil e núcleo, mesma fonte de dados.
 * Filtro por área com várias áreas ao mesmo tempo (GAM-03), ícone por área, marca de nível (I/II/III) e
 * secretas mascaradas pelo próprio backend ("???"). Bloqueadas mostram
 * quanto falta; a galeria se atualiza sozinha quando o progress-watcher
 * avisa que algo mudou (as áreas escolhidas são mantidas).
 * GAM-14: "+ criar conquista" abre modals/conquista-modal.js; as criadas
 * pelo usuário têm a marca "sua" e podem ser removidas.
 */
export async function render(el, widget) {
  el.innerHTML = `<div class="empty-state">${t("conquistas.carregando")}</div>`;
  let selected = new Set();
  let achievements = [];

  function draw() {
    const visible = selected.size === 0
      ? achievements
      : achievements.filter((a) => selected.has(a.category));
    el.innerHTML = `
      <div class="ach-filters" role="group" aria-label="${t("conquistas.filtrar_aria")}">
        ${filterButtons(achievements, selected)}
        <button type="button" class="ach-create" data-create-custom>${t("conquistas.criar")}</button>
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
      el.innerHTML = `<div class="empty-state">${escapeHtml(t("conquistas.erro", { erro: err.message }))}</div>`;
      return;
    }
    if (!achievements.length) {
      el.innerHTML = `<div class="empty-state">${t("conquistas.nenhuma")}</div>`;
      return;
    }
    // área que deixou de existir na lista (ex: banco restaurado) sai da seleção
    selected = new Set([...selected].filter((id) => achievements.some((a) => a.category === id)));
    draw();
  }

  el.addEventListener("click", async (e) => {
    // GAM-14: criar / remover conquista personalizada
    if (e.target.closest("[data-create-custom]")) {
      openConquistaModal({ onSaved: load });
      return;
    }
    const remove = e.target.closest("[data-remove-custom]");
    if (remove) {
      const ok = await showConfirmModal(t("conquistas.remover_confirma"), {
        title: t("conquistas.remover"),
        confirmText: t("conquistas.remover_botao"),
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteCustomAchievement(remove.dataset.removeCustom);
      } catch (err) {
        showErrorModal(err.message, t("conquistas.erro_remover"));
        return;
      }
      await load();
      return;
    }
    const btn = e.target.closest(".ach-filter");
    if (!btn) return;
    const id = btn.dataset.category;
    selected = toggleCategory(selected, id);
    draw();
    el.querySelector(`.ach-filter[data-category="${id}"]`)?.focus();
  });

  await load();
  // ORG-03: conquista escolhida na busca (Ctrl+K)
  const pedido = consumePendingFocus("conquista");
  if (pedido) focusRow(el.querySelector(`[data-ach-id="${CSS.escape(pedido)}"]`), "conquista");
  listenWhileConnected(el, "kami:action-registered", load);
}
