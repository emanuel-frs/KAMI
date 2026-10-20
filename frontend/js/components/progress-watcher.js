import { getAchievements, getAttributes, getLog, getMissoes, getPlayer, getRecompensas } from "../api/nucleo.js";
import { ICON_BY_CATEGORY } from "../widgets/achievements.js";
import { showAchievementPopup } from "./achievement-popup.js";
import { playSound } from "./sound.js";
import { showToast } from "./toast.js";
import { navigateTo } from "./navigate.js";
import { escapeHtml } from "./format.js";
import { effectsMode } from "./visual-effects.js";
import { showLevelUp } from "./level-up.js";
import { estaNoDocumento } from "./no-documento.js";

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
 *   - toast quando uma missão é concluída (GAM-07) e linha apagada quando
 *     um estorno a devolve pra pendente
 *   - bônus de xp (GAM-08) numa linha própria cada um ("+5 xp · primeira
 *     ação do dia"), descontados da linha do atributo — achados nos logs
 *     novos de source 'bonus' (os últimos RECENT_LOG do /log)
 * e dispara `kami:action-registered` pros widgets do Núcleo/Perfil se
 * atualizarem — antes só o formulário do Núcleo e o modal de transação
 * disparavam esse evento, e o xp ganho nos outros módulos só aparecia
 * depois de recarregar a tela.
 */

// escritas que nunca mexem em xp — nem vale a pena tirar foto (o "visto"
// do aviso de sequência salva, GAM-06, e da retrospectiva, GAM-12, também não)
const IGNORED_PREFIXES = ["/api/dashboard", "/api/perfil", "/api/nucleo/streak-saved", "/api/nucleo/retrospectivas"];
// escritas que trocam o banco inteiro (import/reset de backup, revisão
// de xp): a foto é atualizada em silêncio, sem comemorar nem lamentar
// xp/conquistas que mudaram de uma vez só
const SILENT_PREFIXES = ["/api/sistema", "/api/nucleo/xp-review"];

const DEBOUNCE_MS = 200;
// logs recentes olhados pra achar os bônus novos — uma ação gera no
// máximo 3 bônus (+ missões), então isso sobra com folga
const RECENT_LOG = 20;
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
  const [player, attributes, achievements, missoes, log] = await Promise.all([
    getPlayer(),
    getAttributes(),
    getAchievements(),
    getMissoes(),
    getLog({ limit: RECENT_LOG }),
  ]);
  const recent = Array.isArray(log) ? log : [];
  const allMissions = [...(missoes?.diarias ?? []), ...(missoes?.semanal ? [missoes.semanal] : [])];
  return {
    player,
    attrs: new Map(attributes.map((a) => [a.name, a])),
    unlocked: new Map(achievements.filter((a) => a.unlocked).map((a) => [a.id, a])),
    missionsDone: new Map(allMissions.filter((m) => m.concluida).map((m) => [m.id, m])),
    recentLog: recent,
    logIds: new Set(recent.map((e) => e.id)),
  };
}

function ensureFeed() {
  if (estaNoDocumento(feedEl)) return feedEl;
  feedEl = document.createElement("div");
  feedEl.className = "xp-feed";
  feedEl.setAttribute("role", "status");
  feedEl.setAttribute("aria-live", "polite");
  document.body.appendChild(feedEl);
  return feedEl;
}

function showFeedLine(label, detail, negative, extraClass = "") {
  const feed = ensureFeed();
  const item = document.createElement("div");
  item.className = `xp-feed-item${negative ? " neg" : ""}${extraClass ? ` ${extraClass}` : ""}`;
  item.innerHTML = `<b>${escapeHtml(label)}</b><span>· ${escapeHtml(detail)}</span>`;
  feed.appendChild(item);
  setTimeout(() => item.remove(), XP_FEED_MS);
}

function showXpLine(delta, attribute) {
  const sign = delta > 0 ? "+" : "−";
  showFeedLine(`${sign}${Math.abs(delta)} xp`, attribute, delta < 0);
}

/**
 * Subida do nível geral: tela cheia (efeitos "completo") ou toast, com o
 * que acabou de ser liberado (GAM-10: títulos e temas de terminal entre o
 * nível anterior e o novo). Assíncrona só pra buscar o catálogo — se ele
 * falhar, comemora do mesmo jeito, sem a linha de "desbloqueado".
 */
async function celebrateLevel(previousLevel, player) {
  let unlocked = [];
  try {
    const rewards = await getRecompensas();
    const fresh = (item) => item.level > previousLevel && item.level <= player.level;
    unlocked = [
      ...rewards.titulos.filter(fresh).map((t) => `título "${t.label}"`),
      ...rewards.temas.filter(fresh).map((t) => `tema ${t.label}`),
    ];
  } catch {
    // sem catálogo: comemora sem a linha de recompensas
  }
  playSound("levelup"); // GAM-13
  if (effectsMode() === "completo") {
    showLevelUp({ level: player.level, previousLevel, totalXp: player.total_xp, unlocked });
    return;
  }
  showToast({
    sound: false,
    title: `nível ${player.level} alcançado`,
    message: `${player.total_xp.toLocaleString("pt-BR")} xp no total${unlocked.length ? ` · desbloqueado: ${unlocked.join(", ")}` : ""}`,
    iconName: "zap",
    duration: TOAST_MS,
  });
}

function diffAndCelebrate(before, after) {
  let changed = false;

  // GAM-08: bônus novos desde a última foto — cada um vira sua própria
  // linha, e o xp deles sai da linha do atributo (que fica só com a ação)
  const newBonus = after.recentLog.filter((e) => e.source === "bonus" && !before.logIds.has(e.id));
  const bonusByAttr = new Map();
  for (const b of newBonus) {
    for (const cat of b.categories ?? []) bonusByAttr.set(cat, (bonusByAttr.get(cat) ?? 0) + b.xp_gained);
  }

  // GAM-13: um som por escrita (não um por atributo): o mais importante vence
  let sound = null;
  for (const [name, attr] of after.attrs) {
    const prev = before.attrs.get(name);
    if (!prev) continue;
    const delta = attr.current_xp - prev.current_xp;
    if (delta === 0) continue;
    changed = true;
    if (delta > 0) sound ??= "xp";
    const base = delta > 0 ? delta - (bonusByAttr.get(name) ?? 0) : delta;
    if (base !== 0) showXpLine(base, name);
    if (attr.current_level > prev.current_level) {
      sound = "nivel";
      showToast({
        title: `${name} subiu pro nível ${attr.current_level}`,
        message: `nível ${prev.current_level} → ${attr.current_level}`,
        iconName: "trending-up",
        duration: TOAST_MS,
        sound: false,
      });
    }
  }
  // subida do nível geral tem o som próprio (celebrateLevel)
  if (sound && !(after.player.level > before.player.level)) playSound(sound);

  for (const b of [...newBonus].reverse()) {
    showFeedLine(`+${b.xp_gained} xp`, b.description.replace(/^bônus · /, ""), false, "bonus");
  }

  if (after.player.level > before.player.level) {
    celebrateLevel(before.player.level, after.player);
  }

  for (const [id, ach] of after.unlocked) {
    if (before.unlocked.has(id)) continue;
    changed = true;
    // GAM-15: aviso "estilo Steam" (vira toast comum com efeitos desligados)
    showAchievementPopup({
      label: "conquista desbloqueada",
      title: ach.title,
      detail: ach.description ?? "",
      iconName: ICON_BY_CATEGORY[ach.category] ?? "star",
      onClick: () => navigateTo("perfil"),
    });
  }

  for (const [id, ach] of before.unlocked) {
    if (after.unlocked.has(id)) continue;
    changed = true;
    showFeedLine("conquista bloqueada", ach.title, true);
  }

  // GAM-07: o bônus já entrou no "+xp" do atributo acima; o toast diz de onde veio
  for (const [id, m] of after.missionsDone) {
    if (before.missionsDone.has(id)) continue;
    changed = true;
    showAchievementPopup({
      label: "missão concluída",
      title: m.titulo,
      detail: `+${m.xp_bonus} xp`,
      iconName: "target",
      small: true,
      kind: "missao",
      onClick: () => navigateTo("nucleo"),
    });
  }

  for (const [id, m] of before.missionsDone) {
    if (after.missionsDone.has(id)) continue;
    changed = true;
    showFeedLine("missão desfeita", m.titulo, true);
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
