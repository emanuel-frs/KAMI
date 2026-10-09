import { getAchievements, getAttributes, getPlayer } from "../api/nucleo.js";
import { showToast } from "./toast.js";
import { navigateTo } from "./navigate.js";
import { escapeHtml } from "./format.js";
import { effectsMode } from "./visual-effects.js";
import { showLevelUp } from "./level-up.js";

/**
 * Feedback de progresso — iniciado uma vez em app.js (boot()), igual
 * aos outros agendadores globais (calendar-notifications.js,
 * email-sync-scheduler.js).
 *
 * Quase todo xp do Kami nasce como efeito colateral de outro módulo
 * (pagar uma conta, concluir um marco, contribuir com uma meta...), e
 * cada um desses endpoints devolve o seu próprio recurso, não o xp que
 * rendeu. Em vez de mudar a resposta de cada rota, o watcher tira uma
 * "foto" do progresso (xp/nível por atributo, nível geral, conquistas
 * desbloqueadas) e compara com a anterior depois de cada escrita
 * (evento `kami:data-changed`, disparado por api/client.js). A
 * diferença vira feedback:
 *   - "+20 xp · aprendizado" subindo no canto da tela (ou "−20 xp",
 *     apagado, quando algo foi desfeito e o xp estornado)
 *   - toast quando um atributo sobe de nível; quando o nível GERAL sobe,
 *     a tela cheia de components/level-up.js (efeitos "completo") ou um
 *     toast (efeitos "sutil"/"desligado")
 *   - toast quando uma conquista é desbloqueada (clicar leva ao perfil)
 *   - linha apagada quando um estorno volta a bloquear uma conquista
 * e dispara `kami:action-registered` pros widgets do Núcleo/Perfil se
 * atualizarem — antes só o formulário do Núcleo e o modal de transação
 * disparavam esse evento, e o xp ganho nos outros módulos só aparecia
 * depois de recarregar a tela.
 */

// escritas que nunca mexem em xp — nem vale a pena tirar foto (o "visto"
// do aviso de sequência salva, GAM-06, também não)
const IGNORED_PREFIXES = ["/api/dashboard", "/api/perfil", "/api/nucleo/streak-saved"];
// escritas que trocam o banco inteiro (import/reset de backup, revisão
// de xp): a foto é atualizada em silêncio, sem comemorar nem lamentar
// xp/conquistas que mudaram de uma vez só
const SILENT_PREFIXES = ["/api/sistema", "/api/nucleo/xp-review"];

const DEBOUNCE_MS = 200;
const XP_FEED_MS = 2600;
const TOAST_MS = 6000;

let baseline = null;
let timer = null;
let running = false;
let rerun = false;
let silentPending = false;
let feedEl = null;

function isAutomatic(path) {
  // sync automático de e-mail (email-sync-scheduler.js) — nunca rende xp
  return path.includes("automatic=true");
}

async function takeSnapshot() {
  const [player, attributes, achievements] = await Promise.all([
    getPlayer(),
    getAttributes(),
    getAchievements(),
  ]);
  return {
    player,
    attrs: new Map(attributes.map((a) => [a.name, a])),
    unlocked: new Map(achievements.filter((a) => a.unlocked).map((a) => [a.id, a])),
  };
}

function ensureFeed() {
  if (feedEl) return feedEl;
  feedEl = document.createElement("div");
  feedEl.className = "xp-feed";
  feedEl.setAttribute("role", "status");
  feedEl.setAttribute("aria-live", "polite");
  document.body.appendChild(feedEl);
  return feedEl;
}

function showFeedLine(label, detail, negative) {
  const feed = ensureFeed();
  const item = document.createElement("div");
  item.className = `xp-feed-item${negative ? " neg" : ""}`;
  item.innerHTML = `<b>${escapeHtml(label)}</b><span>· ${escapeHtml(detail)}</span>`;
  feed.appendChild(item);
  setTimeout(() => item.remove(), XP_FEED_MS);
}

function showXpLine(delta, attribute) {
  const sign = delta > 0 ? "+" : "−";
  showFeedLine(`${sign}${Math.abs(delta)} xp`, attribute, delta < 0);
}

function diffAndCelebrate(before, after) {
  let changed = false;

  for (const [name, attr] of after.attrs) {
    const prev = before.attrs.get(name);
    if (!prev) continue;
    const delta = attr.current_xp - prev.current_xp;
    if (delta === 0) continue;
    changed = true;
    showXpLine(delta, name);
    if (attr.current_level > prev.current_level) {
      showToast({
        title: `${name} subiu pro nível ${attr.current_level}`,
        message: `nível ${prev.current_level} → ${attr.current_level}`,
        iconName: "trending-up",
        duration: TOAST_MS,
      });
    }
  }

  if (after.player.level > before.player.level && effectsMode() === "completo") {
    showLevelUp({
      level: after.player.level,
      previousLevel: before.player.level,
      totalXp: after.player.total_xp,
    });
  } else if (after.player.level > before.player.level) {
    showToast({
      title: `nível ${after.player.level} alcançado`,
      message: `${after.player.total_xp.toLocaleString("pt-BR")} xp no total`,
      iconName: "zap",
      duration: TOAST_MS,
    });
  }

  for (const [id, ach] of after.unlocked) {
    if (before.unlocked.has(id)) continue;
    changed = true;
    showToast({
      title: `conquista desbloqueada: ${ach.title}`,
      message: ach.description ?? "",
      iconName: "star",
      duration: TOAST_MS + 2000,
      onClick: () => navigateTo("perfil"),
    });
  }

  for (const [id, ach] of before.unlocked) {
    if (after.unlocked.has(id)) continue;
    changed = true;
    showFeedLine("conquista bloqueada", ach.title, true);
  }

  return changed;
}

async function check() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  const silent = silentPending;
  silentPending = false;
  try {
    const snap = await takeSnapshot();
    const changed = baseline && !silent ? diffAndCelebrate(baseline, snap) : false;
    baseline = snap;
    if (changed || silent) {
      window.dispatchEvent(new CustomEvent("kami:action-registered", { detail: { source: "progress" } }));
    }
  } catch {
    // backend fora do ar ou ainda subindo — a próxima escrita tenta de novo
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      check();
    }
  }
}

function onDataChanged(e) {
  const path = e.detail?.path ?? "";
  if (IGNORED_PREFIXES.some((p) => path.startsWith(p)) || isAutomatic(path)) return;
  if (SILENT_PREFIXES.some((p) => path.startsWith(p))) silentPending = true;
  clearTimeout(timer);
  timer = setTimeout(check, DEBOUNCE_MS);
}

export function startProgressWatcher() {
  window.addEventListener("kami:data-changed", onDataChanged);
  // foto inicial — sem ela a primeira escrita não teria com o que comparar
  check();
}
