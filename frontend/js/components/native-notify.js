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

