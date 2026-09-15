import { listEmailAccounts, syncEmailAccount, listEmailCache } from "../api/organizacao.js";
import { refreshNotificationBell } from "./notification-bell.js";
import { showToast } from "./toast.js";
import { sendNativeNotification } from "./native-notify.js";

/**
 * Agendador global de sync de e-mail (notificações v2) — mesmo molde de
 * calendar-notifications.js: `setInterval` global iniciado uma vez em
 * app.js (boot()), independente da tela aberta. Antes disso, sync de
 * e-mail era 100% manual (clique em Organização).
 *
 * A cada tick (incluindo o imediato, ao iniciar): lista as contas de
 * e-mail cadastradas e sincroniza todas em paralelo. Se alguma trouxe
 * mensagem nova, dispara um refresh no sino de notificações
 * (notification-bell.js) e, quando o total agregado de e-mails novos
 * de remetentes NÃO silenciados (somando todas as contas) for maior
 * que 1, também um toast + notificação nativa resumindo quantas
 * chegaram — 1 e-mail novo sozinho só atualiza o badge
 * silenciosamente, sem toast (decisão fechada do plano).
 *
 * O endpoint de sync só devolve a CONTAGEM bruta de mensagens novas
 * por conta, sem detalhe de quais/remetente — pra contar só as não
 * silenciadas de verdade (e não inflar o toast com algo que o badge já
 * ignora), este módulo compara os ids de GET /email-cache?exclude_muted=true
 * antes e depois do sync, em vez de confiar na contagem bruta.
 *
 * Sem nenhuma conta cadastrada, o tick não faz nada (sem custo). Roda
 * só enquanto o app está aberto — mesma limitação que já existe pros
 * lembretes de calendário, não é regressão.
 *
 * Cada sync daqui passa `automatic: true` pra
 * api/organizacao.js:syncEmailAccount() — o backend usa essa flag pra
 * NÃO creditar XP nem gravar action_log (ver sync_email_account em
 * routers/organizacao.py): um tick a cada 5min o dia inteiro não é
 * uma ação do usuário, e inflava tanto o nível quanto o "log recente"
 * (widgets/log.js) com dezenas de "sincronizou e-mail" repetidos. Sync
 * manual (organização, aba chaves de configurações) continua sem essa
 * flag e conta normalmente.
 */

const CHECK_INTERVAL_MS = 5 * 60_000; // 5min

let intervalId = null;
let navigateToModuleCb = null;

// redesign da aba e-mail: a tela
// de Organização precisa saber se o sync global está rodando pra
// nascer com o botão "sincronizar" já travado/girando quando o app
// acabou de abrir (sem isso, tudo bem pra sempre teve, mas dava pra
// disparar um sync manual duplicado logo na entrada). isRunning +
// subscribeSyncState seguem o mesmo padrão de qualquer outro
// subscribe*/unsubscribe* já usado no app (ex: store.subscribe).
let isRunning = false;
const syncStateListeners = new Set();

function setRunning(value) {
  isRunning = value;
  syncStateListeners.forEach((cb) => {
    try {
      cb(value);
    } catch (err) {
      console.error("email-sync-scheduler: listener de subscribeSyncState falhou:", err);
    }
  });
}

/** @returns {boolean} true enquanto um tick (automático ou manual) está em andamento. */
export function isSyncRunning() {
  return isRunning;
}

/**
 * @param {(running: boolean) => void} cb - chamado com o novo valor
 *   sempre que o estado muda (início/fim de um tick do scheduler).
 * @returns {() => void} função de unsubscribe.
 */
export function subscribeSyncState(cb) {
  syncStateListeners.add(cb);
  return () => syncStateListeners.delete(cb);
}

async function nonMutedIdSet() {
  try {
    const cache = await listEmailCache({ exclude_muted: true });
    return new Set(cache.map((e) => e.id));
  } catch (err) {
    console.error("email-sync-scheduler: falha ao consultar cache não-silenciado:", err);
    return null; // sinaliza "não sei" pro chamador, em vez de fingir que é vazio
  }
}

async function runCheck() {
  setRunning(true);
  try {
    let accounts;
    try {
      accounts = await listEmailAccounts();
    } catch (err) {
      console.error("email-sync-scheduler: falha ao listar contas:", err);
      return;
    }
    if (!accounts.length) return; // nenhuma conta cadastrada — tick sem custo

    const before = await nonMutedIdSet();

    const results = await Promise.all(
      accounts.map((acc) =>
        syncEmailAccount(acc.id, { automatic: true }).catch((err) => {
          console.error(`email-sync-scheduler: falha ao sincronizar conta ${acc.label}:`, err);
          return null;
        })
      )
    );

    const totalNew = results.reduce((sum, r) => sum + (r?.new_messages || 0), 0);
    if (totalNew <= 0) return;

    await refreshNotificationBell();

    // conta só as novas de remetentes NÃO silenciados (diff de ids contra
    // o snapshot de antes do sync) — se não deu pra tirar o snapshot
    // "antes" ou o "depois", cai pro total bruto como aproximação segura
    // (melhor mostrar um toast a mais do que silenciar um errado).
    const after = before ? await nonMutedIdSet() : null;
    const effectiveNew = before && after
      ? [...after].filter((id) => !before.has(id)).length
      : totalNew;

    if (effectiveNew <= 1) return; // decisão fechada: 1 sozinho não gera toast

    const message = `${effectiveNew} novos e-mails`;
    showToast({
      title: "e-mails sincronizados",
      message,
      iconName: "bell-ring",
      onClick: () => navigateToModuleCb?.("organizacao"),
    });
    sendNativeNotification({ title: "kami — e-mails sincronizados", body: message });
  } finally {
    setRunning(false);
  }
}

/**
 * @param {{ onNavigate?: (module: string) => void }} opts — chamado
 *   quando o usuário clica no toast; mesmo padrão de onNavigate de
 *   calendar-notifications.js.
 */
export function startEmailSyncScheduler({ onNavigate } = {}) {
  if (intervalId) return; // já rodando — idempotente, mesmo padrão de startCalendarNotifications
  navigateToModuleCb = onNavigate || null;
  runCheck();
  intervalId = setInterval(runCheck, CHECK_INTERVAL_MS);
}
