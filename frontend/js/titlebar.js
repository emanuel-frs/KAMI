/**
 * Titlebar customizada (janela frameless) — liga os botões
 * minimizar/maximizar/fechar à API real da janela do Tauri.
 *
 * Depende de app.withGlobalTauri = true em tauri.conf.json, o que
 * expõe window.__TAURI__ sem precisar importar @tauri-apps/api como
 * pacote npm (mantém a decisão de zero bundler). Fora do Tauri (ex:
 * abrindo index.html direto num navegador durante o dev), os botões
 * ficam presentes mas inofensivos — window.__TAURI__ simplesmente
 * não existe, então cada handler vira no-op.
 *
 * Permissões necessárias em src-tauri/capabilities/default.json:
 *   core:window:allow-close
 *   core:window:allow-minimize
 *   core:window:allow-toggle-maximize
 *   core:window:allow-start-dragging   (drag da titlebar em Linux/X11
 *     às vezes precisa disso além do data-tauri-drag-region no HTML)
 */

const tauriWindow = window.__TAURI__?.window;
const appWindow = tauriWindow?.getCurrentWindow?.();

function wire(id, action) {
  document.getElementById(id)?.addEventListener("click", () => {
    if (!appWindow) return; // rodando fora do Tauri (dev no navegador) — no-op
    action(appWindow).catch((err) => console.error(`titlebar: falha em '${id}'`, err));
  });
}

wire("win-minimize", (w) => w.minimize());
wire("win-maximize", (w) => w.toggleMaximize());
wire("win-close", (w) => w.close());
