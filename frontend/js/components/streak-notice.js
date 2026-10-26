import { getPlayer, markStreakSavedSeen } from "../api/nucleo.js";
import { showAchievementPopup } from "./achievement-popup.js";
import { t } from "../i18n.js";

/**
 * Aviso "sequência salva" (GAM-06). A proteção de sequência é gasta no
 * cálculo da leitura (backend/app/sequencia.py), não depois de uma ação
 * — então o progress-watcher nunca vê esse momento acontecer. Este módulo
 * olha `/player.streak_saved_days` (dias protegidos da sequência atual
 * cujo aviso ainda não foi visto) ao abrir o app e depois de cada ação,
 * mostra um toast e marca os dias como vistos no backend, pra não repetir
 * nem depois de recarregar.
 *
 * Iniciado em app.js depois do splash (senão o toast nasceria escondido
 * atrás dele). `shown` evita toast duplicado se duas checagens correrem
 * juntas antes do POST de "visto" voltar.
 */

const shown = new Set();

export function noticeText(player, days) {
  const dias = t("streak_notice.dias", { n: player.streak_current });
  const coberto = t("streak_notice.coberto", { n: days.length, dias });
  return `${coberto} · ${t("streak_notice.restam", { n: player.streak_protections })}`;
}

async function check() {
  let player;
  try {
    player = await getPlayer();
  } catch {
    return; // backend fora do ar — a próxima ação tenta de novo
  }
  const days = (player.streak_saved_days ?? []).filter((d) => !shown.has(d));
  if (days.length === 0) return;
  days.forEach((d) => shown.add(d));
  // GAM-15: mesmo aviso "estilo Steam" das conquistas, tamanho menor
  showAchievementPopup({
    label: t("streak_notice.sequencia_salva"),
    title: noticeText(player, days),
    iconName: "shield",
    small: true,
    kind: "sequencia",
  });
  try {
    await markStreakSavedSeen(days);
  } catch {
    // não marcou: o aviso pode voltar na próxima abertura, sem problema
  }
}

export function startStreakNotice() {
  window.addEventListener("kami:action-registered", check);
  return check();
}
