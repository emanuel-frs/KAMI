import { getPlayer } from "../api/nucleo.js";
import { setXpBar } from "./xp-bar.js";
import { rollNumber } from "./fx.js";
import { flameOptions, flameSvg, protectionsSummary, protectionsText } from "./streak-flame.js";

/**
 * Linha "nv 3 [####------]" na barra lateral, acima do avatar (GAM-05).
 * Iniciada uma vez em app.js depois do perfil (backend já de pé) e
 * atualizada a cada `kami:action-registered` (disparado pelo
 * progress-watcher depois de qualquer escrita que mexeu no progresso).
 * A barra lateral nunca é desmontada, então o listener é global e único.
 *
 * Ao subir de nível a barra recomeça do zero (o xp do nível novo), por
 * isso a animação parte de 0 quando o nível muda.
 *
 * GAM-06: chama da sequência (SVG em pixel art, components/streak-flame.js) à
 * esquerda, e embaixo do nível a linha "12d ◆◇" (dias + proteções), com
 * tooltip próprio.
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
  const xp = el.querySelector(".sl-xp");
  xp.dataset.tooltip = `${player.current_level_xp}/${player.xp_for_next_level} xp · faltam ${missing} pro nível ${player.level + 1}`;
  xp.setAttribute("aria-label", `nível ${player.level}, ${player.pct}% do caminho pro nível ${player.level + 1}`);
  rollNumber(el.querySelector(".sl-level"), player.level, { key: "sidebar-level", format: (n) => `nv ${n}` });
  const from = last == null ? null : last.level === player.level ? last.pct : 0;
  setXpBar(el.querySelector(".sl-bar"), player.pct, { from });
  last = { level: player.level, pct: player.pct };

  const streak = el.querySelector(".sl-streak");
  el.querySelector(".sl-flame").innerHTML = flameSvg(player.streak_current, flameOptions(player));
  rollNumber(streak.querySelector(".sl-days"), player.streak_current, { key: "sidebar-days", format: (n) => `${n}d` });
  streak.querySelector(".sl-protections").textContent = protectionsText(
    player.streak_protections,
    player.streak_protections_max
  );
  const summary = `sequência de ${player.streak_current} ${player.streak_current === 1 ? "dia" : "dias"} · ${protectionsSummary(player)}`;
  streak.dataset.tooltip = summary;
  streak.setAttribute("aria-label", summary);
}

export function startSidebarLevel() {
  const el = document.getElementById("sidebar-level");
  if (!el) return;
  el.innerHTML = `
    <div class="sl-row">
      <span class="sl-flame"></span>
      <div class="sl-col">
        <div class="sl-xp" role="img"><span class="sl-level"></span> <span class="sl-bar" aria-hidden="true"></span></div>
        <div class="sl-streak" role="img"><span class="sl-days"></span> <span class="sl-protections"></span></div>
      </div>
    </div>`;
  window.addEventListener("kami:action-registered", refresh);
  refresh();
}
