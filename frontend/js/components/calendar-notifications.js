import { listEvents } from "../api/calendario.js";
import { isPendingAlertEvent } from "./event-types.js";
import { showToast } from "./toast.js";
import { sendNativeNotification } from "./native-notify.js";

/**
 * Agendador global de notificações do calendário — iniciado uma vez em
 * app.js (boot()), independente de qual tela está aberta (diferente do
 * badge/modal de alertas de pages/calendario.js, que só existe enquanto
 * essa tela está montada). Dois tipos de notificação:
 *
 *   1. lembrete de evento manual: dispara na hora exata configurada
 *      (data + hora do evento, menos `reminder_minutes_before`) — só
 *      funciona pra eventos COM hora definida, já que sem hora não tem
 *      instante preciso pra disparar (o evento continua aparecendo
 *      normal na grade, só não gera notificação puxada por horário).
 *   2. resumo diário: uma vez por dia (na primeira checagem após meia-
 *      noite), avisa se tem algo "vencendo hoje" entre conta
 *      fixa/dívida/assinatura/meta pendente — mesma regra de
 *      isPendingAlertEvent usada no badge da tela de calendário.
 *
 * Cada disparo vira toast in-app (sempre) + notificação nativa do SO
 * quando o Tauri/plugin estiver disponível (ver native-notify.js — vira
 * no-op silencioso fora do Tauri, então isso funciona igual em dev).
 *
 * Deduplicação via localStorage (não é dado sensível do usuário nem
 * artifact sandboxado — é o app desktop de verdade rodando local) pra
 * sobreviver a reload de página/restart do app sem repetir o mesmo
 * lembrete. Podado pra só manter os últimos 2 dias, então não cresce
 * pra sempre.
 */

const CHECK_INTERVAL_MS = 30_000; // 30s — granularidade aceitável pra lembrete "na hora"
const FIRE_TOLERANCE_MS = 3 * 60_000; // não dispara lembrete com mais de 3min de atraso (ex: app estava fechado)
const FIRED_STORAGE_KEY = "kami-cal-notif-fired-v1";
const DAILY_DIGEST_STORAGE_KEY = "kami-cal-notif-daily-digest-v1";

let intervalId = null;
let navigateToModuleCb = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function loadFiredSet() {
  try {
    const raw = localStorage.getItem(FIRED_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const today = todayStr();
    // poda: só mantém disparos de hoje/ontem (formato dos itens: "id@YYYY-MM-DD HH:MM")
    return new Set(arr.filter((entry) => entry.slice(-16, -6) >= addDaysStr(today, -1)));
  } catch {
    return new Set();
  }
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function saveFiredSet(set) {
  try {
    localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify([...set]));
  } catch (err) {
    console.error("calendar-notifications: falha ao salvar dedupe local:", err);
  }
}

async function fetchRelevantEvents() {
  const now = new Date();
  const months = new Set([monthStr(now)]);
  // perto da virada do mês, o mês seguinte também pode ter lembretes
  // "hoje" relevantes (evento no dia 1 às 00:xx, por exemplo).
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  months.add(monthStr(next));

  const results = await Promise.all([...months].map((m) => listEvents(m).catch(() => [])));
  return results.flat();
}

function checkEventoReminders(events, firedSet) {
  const now = Date.now();
  const eventos = events.filter((e) => e.type === "evento" && e.time && e.reminder_minutes_before != null);

  for (const e of eventos) {
    const triggerAt = new Date(`${e.date}T${e.time}:00`).getTime() - e.reminder_minutes_before * 60_000;
    if (Number.isNaN(triggerAt)) continue;

    const key = `${e.id}@${e.date} ${e.time}`;
    if (firedSet.has(key)) continue;
    if (now < triggerAt || now - triggerAt > FIRE_TOLERANCE_MS) continue;

    firedSet.add(key);
    const dueLabel = e.reminder_minutes_before === 0 ? "agora" : `em ${e.reminder_minutes_before} min`;
    showToast({
      title: e.title,
      message: `evento às ${e.time} — ${dueLabel}`,
      iconName: "calendar-days",
      onClick: () => navigateToModuleCb?.("calendario"),
    });
    sendNativeNotification({ title: `kami — ${e.title}`, body: `evento às ${e.time}` });
  }
}

function checkDailyDigest(events) {
  const today = todayStr();
  if (localStorage.getItem(DAILY_DIGEST_STORAGE_KEY) === today) return; // já mostrado hoje

  const dueToday = events.filter((e) => e.date === today && isPendingAlertEvent(e));
  localStorage.setItem(DAILY_DIGEST_STORAGE_KEY, today);
  if (!dueToday.length) return;

  const first = dueToday[0];
  const message = dueToday.length === 1
    ? first.title
    : `${first.title} e mais ${dueToday.length - 1}`;

  showToast({
    title: `${dueToday.length === 1 ? "vence hoje" : `${dueToday.length} itens vencem hoje`}`,
    message,
    iconName: "bell-ring",
    duration: 12000,
    onClick: () => navigateToModuleCb?.("calendario"),
  });
  sendNativeNotification({
    title: dueToday.length === 1 ? "kami — vence hoje" : `kami — ${dueToday.length} itens vencem hoje`,
    body: message,
  });
}

async function runCheck() {
  let events;
  try {
    events = await fetchRelevantEvents();
  } catch (err) {
    console.error("calendar-notifications: falha ao buscar eventos:", err);
    return;
  }

  const firedSet = loadFiredSet();
  checkEventoReminders(events, firedSet);
  saveFiredSet(firedSet);
  checkDailyDigest(events);
}

/**
 * @param {{ onNavigate?: (module: string) => void }} opts
 *   `onNavigate` — chamado quando o usuário clica num toast; recebe o
 *   nome do módulo (sempre "calendario" aqui) pra quem chamou decidir
 *   como trocar de tela (mesmo padrão de onSelect do modal de alertas).
 */
export function startCalendarNotifications({ onNavigate } = {}) {
  if (intervalId) return; // já rodando — startCalendarNotifications é idempotente
  navigateToModuleCb = onNavigate || null;
  runCheck();
  intervalId = setInterval(runCheck, CHECK_INTERVAL_MS);
}
