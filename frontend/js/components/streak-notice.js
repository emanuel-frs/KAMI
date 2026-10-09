import { getPlayer, markStreakSavedSeen } from "../api/nucleo.js";
import { showToast } from "./toast.js";

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
const TOAST_MS = 9000;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function noticeText(player, days) {
  const left = player.streak_protections;
  const rest = left === 0 ? "nenhuma proteção sobrando" : `${left === 1 ? "resta" : "restam"} ${plural(left, "proteção", "proteções")}`;
  const covered =
    days.length === 1
      ? "um dia ficou em branco e uma proteção segurou"
      : `${days.length} dias ficaram em branco e as proteções seguraram`;
  return `${covered} sua sequência de ${plural(player.streak_current, "dia", "dias")} · ${rest}`;
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
  showToast({ title: "sequência salva!", message: noticeText(player, days), iconName: "shield", duration: TOAST_MS });
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
