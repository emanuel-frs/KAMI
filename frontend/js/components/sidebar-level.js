import { getPlayer } from "../api/nucleo.js";
import { setXpBar } from "./xp-bar.js";

/**
 * Linha "nv 3 [####------]" na barra lateral, acima do avatar (GAM-05).
 * Iniciada uma vez em app.js depois do perfil (backend já de pé) e
 * atualizada a cada `kami:action-registered` (disparado pelo
 * progress-watcher depois de qualquer escrita que mexeu no progresso).
 * A barra lateral nunca é desmontada, então o listener é global e único.
 *
 * Ao subir de nível a barra recomeça do zero (o xp do nível novo), por
 * isso a animação parte de 0 quando o nível muda.
 */

let last = null;

async function refresh() {
  const el = document.getElementById("sidebar-level");
  if (!el) return;
  let player;
  try {
    player = await getPlayer();
  } catch {
    return; // backend fora do ar — a próxima ação tenta de novo
  }
  const missing = player.xp_for_next_level - player.current_level_xp;
  el.hidden = false;
  el.dataset.tooltip = `${player.current_level_xp}/${player.xp_for_next_level} xp · faltam ${missing} pro nível ${player.level + 1}`;
  el.setAttribute("aria-label", `nível ${player.level}, ${player.pct}% do caminho pro nível ${player.level + 1}`);
  el.querySelector(".sl-level").textContent = `nv ${player.level}`;
  const from = last == null ? null : last.level === player.level ? last.pct : 0;
  setXpBar(el.querySelector(".sl-bar"), player.pct, { from });
  last = { level: player.level, pct: player.pct };
}

export function startSidebarLevel() {
  const el = document.getElementById("sidebar-level");
  if (!el) return;
  el.innerHTML = '<span class="sl-level"></span> <span class="sl-bar" aria-hidden="true"></span>';
  window.addEventListener("kami:action-registered", refresh);
  refresh();
}
