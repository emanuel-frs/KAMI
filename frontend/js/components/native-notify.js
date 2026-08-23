/**
 * Ponte pra notificação nativa do SO via plugin oficial do Tauri
 * (@tauri-apps/plugin-notification). Mesma filosofia de titlebar.js:
 * usa window.__TAURI__ direto (zero bundler), então some sozinha fora
 * do Tauri (dev no navegador) — sendNativeNotification() vira no-op
 * silencioso nesse caso, e quem chama não precisa checar `isTauri` toda
 * vez.
 *
 * IMPORTANTE — requer trabalho do lado Rust que este pacote (frontend/
 * + backend/) não inclui, porque src-tauri/ não faz parte deste repo:
 *   1. `cargo add tauri-plugin-notification` dentro de src-tauri/
 *   2. registrar o plugin em src-tauri/src/main.rs (ou lib.rs):
 *        .plugin(tauri_plugin_notification::init())
 *   3. adicionar a permissão em src-tauri/capabilities/default.json:
 *        "notification:default"
 *   4. confirmar que tauri.conf.json mantém app.withGlobalTauri = true
 *      (já é o caso — ver titlebar.js — então window.__TAURI__.notification
 *      aparece automaticamente depois do passo 2, sem import npm).
 * Sem esses 4 passos, window.__TAURI__.notification simplesmente não
 * existe e o app cai no toast in-app (ver calendar-notifications.js) —
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

export function isNativeNotificationAvailable() {
  return Boolean(api());
}
