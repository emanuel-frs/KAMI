import { listEvents } from "../api/calendario.js";
import { isPendingAlertEvent } from "./event-types.js";
import { showToast } from "./toast.js";
import { notificarFora } from "./native-notify.js";
import { store } from "../state/store.js";
import { t } from "../i18n.js";

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
 *   2. avisos de vencimento (ORG-05): uma vez por dia, na hora escolhida
 *      em configurações (padrão 9h), um aviso só com o que vence hoje e
 *      amanhã — ver checkDailyDigest.
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

  // rotina de fundo: um mês que falhou só não gera lembrete agora (tenta
  // de novo no próximo ciclo). Erro inesperado da API já virou aviso pelo
  // kami:api-error (CONF-01) — aqui não precisa avisar de novo.
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
    const dueLabel = e.reminder_minutes_before === 0 ? t("calendar_notifications.agora") : t("calendar_notifications.em_min", { n: e.reminder_minutes_before });
    showToast({
      title: e.title,
      message: t("calendar_notifications.evento_as", { hora: e.time, quando: dueLabel }),
      iconName: "calendar-days",
      onClick: () => navigateToModuleCb?.("calendario"),
    });
    notificarFora("eventos", { title: `kami — ${e.title}`, body: t("calendar_notifications.evento_as_curto", { hora: e.time }) }, store.get("profile"));
  }
}

/** "luz, internet" / "luz, internet e mais 3" */
function nomes(lista) {
  if (lista.length <= 3) return lista.map((e) => e.title).join(", ");
  return t("calendar_notifications.e_mais", { nomes: lista.slice(0, 2).map((e) => e.title).join(", "), n: lista.length - 2 });
}

/**
 * ORG-05 (P-47/P-66): avisos de vencimento — uma vez por dia, na hora de
 * configurações › notificações (padrão 9h), UM aviso agrupado com o que
 * vence hoje e amanhã (contas fixas, dívidas, assinaturas, parcelas,
 * metas com prazo…). App aberto depois da hora: avisa na primeira checagem.
 */
function checkDailyDigest(events) {
  const today = todayStr();
  if (localStorage.getItem(DAILY_DIGEST_STORAGE_KEY) === today) return; // já avisou hoje

  const perfil = store.get("profile");
  const [h, m] = (perfil?.avisos_hora || "09:00").split(":").map(Number);
  const agora = new Date();
  if (agora.getHours() * 60 + agora.getMinutes() < h * 60 + m) return; // ainda não deu a hora

  localStorage.setItem(DAILY_DIGEST_STORAGE_KEY, today);
  const vence = (dia) => events.filter((e) => e.date === dia && (isPendingAlertEvent(e) || e.type === "parcela"));
  const hoje = vence(today);
  const amanha = vence(addDaysStr(today, 1));
  if (!hoje.length && !amanha.length) return;

  const linhas = [hoje.length && t("calendar_notifications.hoje", { nomes: nomes(hoje) }), amanha.length && t("calendar_notifications.amanha", { nomes: nomes(amanha) })].filter(Boolean);
  const title = hoje.length
    ? hoje.length === 1 ? t("calendar_notifications.vence_hoje") : t("calendar_notifications.itens_hoje", { n: hoje.length })
    : amanha.length === 1 ? t("calendar_notifications.vence_amanha") : t("calendar_notifications.itens_amanha", { n: amanha.length });

  showToast({
    title,
    message: linhas.join(" · "),
    iconName: "bell-ring",
    duration: 12000,
    onClick: () => navigateToModuleCb?.("calendario"),
  });
  notificarFora("vencimentos", { title: `kami — ${title}`, body: linhas.join("\n") }, perfil);
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
