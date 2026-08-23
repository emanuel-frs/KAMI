import { listEvents } from "../api/calendario.js";
import { isPendingAlertEvent } from "./event-types.js";

/**
 * Busca dos alertas "vencendo em breve" do Calendário — extraído de
 * pages/calendario.js (era só `loadAlerts`, local à tela) pra também
 * alimentar modals/notifications-modal.js, que precisa da mesma lista
 * fora da tela de calendário (sino da sidebar, item 3 do plano de
 * notificações v2.1). Mesma janela/filtro/ordenação de sempre — só
 * mudou de dono, o comportamento é idêntico.
 */
const ALERT_WINDOW_DAYS = 7;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthStr(year, month) {
  return `${year}-${pad2(month)}`;
}

function todayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export function todayStr() {
  const t = todayParts();
  return `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
}

/** Lista (ordenada por data) os eventos "vencendo em breve" a partir de hoje. */
export async function fetchPendingAlerts() {
  const t = todayParts();
  const windowEndDate = new Date(Date.UTC(t.year, t.month - 1, t.day + ALERT_WINDOW_DAYS));
  const windowEndStr = `${windowEndDate.getUTCFullYear()}-${pad2(windowEndDate.getUTCMonth() + 1)}-${pad2(windowEndDate.getUTCDate())}`;

  const months = new Set([
    monthStr(t.year, t.month),
    monthStr(windowEndDate.getUTCFullYear(), windowEndDate.getUTCMonth() + 1),
  ]);

  const results = await Promise.all([...months].map((m) => listEvents(m).catch(() => [])));
  const events = results.flat();

  return events
    .filter((e) => isPendingAlertEvent(e) && e.date <= windowEndStr)
    .sort((a, b) => a.date.localeCompare(b.date));
}
