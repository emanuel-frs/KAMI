/**
 * Ponte pra notificação nativa do SO via plugin oficial do Tauri
 * (@tauri-apps/plugin-notification). Mesma filosofia de titlebar.js:
 * usa window.__TAURI__ direto (zero bundler), então some sozinha fora
 * do Tauri (dev no navegador) — sendNativeNotification() vira no-op
 * silencioso nesse caso, e quem chama não precisa checar `isTauri` toda
 * vez.
 *
 * Lado Rust (src-tauri/) já está com tudo que isso precisa:
 *   1. tauri-plugin-notification adicionado em src-tauri/Cargo.toml
 *   2. plugin registrado em src-tauri/src/main.rs:
 *        .plugin(tauri_plugin_notification::init())
 *   3. permissão "notification:default" em src-tauri/capabilities/default.json
 *   4. tauri.conf.json com app.withGlobalTauri = true (ver titlebar.js) —
 *      é o que faz window.__TAURI__.notification aparecer sozinho depois
 *      do passo 2, sem import npm.
 * Se algum dia window.__TAURI__.notification não existir mesmo assim
 * (build sem algum desses passos, ou versão do plugin desalinhada), o
 * app cai sozinho no toast in-app (ver calendar-notifications.js) —
 * funciona igual, só sem o popup do SO.
 */

let permissionPromise = null;

function api() {
  return typeof window !== "undefined" ? window.__TAURI__?.notification : null;
}

async function ensurePermission() {
  const notif = api();
  if (!notif) return false;
  if (!permissionPromise) {
    permissionPromise = (async () => {
      try {
        let granted = await notif.isPermissionGranted();
        if (!granted) {
          const result = await notif.requestPermission();
          granted = result === "granted";
        }
        return granted;
      } catch (err) {
        console.error("native-notify: falha ao checar/pedir permissão:", err);
        return false;
      }
    })();
  }
  return permissionPromise;
}

/** @param {{ title: string, body?: string }} opts */
export async function sendNativeNotification({ title, body = "" } = {}) {
  const notif = api();
  if (!notif) return false; // fora do Tauri, ou plugin não registrado — no-op

  const granted = await ensurePermission();
  if (!granted) return false;

  try {
    notif.sendNotification({ title, body });
    return true;
  } catch (err) {
    console.error("native-notify: falha ao enviar notificação:", err);
    return false;
  }
}


// ── ORG-05 (P-61/P-70): o que pode sair do app ─────────────────────────
// Cada aviso tem um tipo; configurações › notificações escolhe quais viram
// notificação do SISTEMA (dentro do app — aviso e sino — tudo continua).
// Com "esconder o texto" (liga sozinho ao ativar o PIN), a notificação diz
// só que tem algo no kami: ela aparece na tela de bloqueio do sistema.
const COLUNA_POR_TIPO = {
  lembretes: "notif_fora_lembretes",
  vencimentos: "notif_fora_vencimentos",
  eventos: "notif_fora_eventos",
};
const TEXTO_OCULTO = {
  lembretes: "você tem um lembrete — abra o kami pra ver",
  vencimentos: "tem coisa vencendo — abra o kami pra ver",
  eventos: "você tem um evento — abra o kami pra ver",
};

/**
 * Notificação do sistema conforme as preferências do perfil.
 * @param {"lembretes"|"vencimentos"|"eventos"} tipo
 * @param {{ title: string, body?: string }} msg
 * @param {object|null} perfil — store.get("profile") (null = tudo ligado)
 */
export function notificarFora(tipo, { title, body = "" }, perfil) {
  if (perfil && perfil[COLUNA_POR_TIPO[tipo]] === false) return Promise.resolve(false);
  if (perfil?.notif_ocultar_texto) {
    return sendNativeNotification({ title: "kami", body: TEXTO_OCULTO[tipo] });
  }
  return sendNativeNotification({ title, body });
}
