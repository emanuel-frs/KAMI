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
import { icon } from "./components/icons.js";

const isTauri = Boolean(window.__TAURI__);

// index.html deixa os 3 botões sem conteúdo (só title="" pra tooltip/
// acessibilidade) — os ícones (minus/square/x, ver icons.js) entram
// aqui via innerHTML em vez de ficar embutidos como glifo unicode cru
// (—, □, ✕) direto no HTML estático, seguindo o mesmo padrão do resto
// do app (item "sem emoji/glifo cru").
document.getElementById("win-minimize")?.insertAdjacentHTML("beforeend", icon("minus", { size: 14 }));
document.getElementById("win-maximize")?.insertAdjacentHTML("beforeend", icon("square", { size: 13 }));
document.getElementById("win-close")?.insertAdjacentHTML("beforeend", icon("x", { size: 14 }));

// Fora do Tauri (rodando no navegador durante o dev/teste) a titlebar
// custom não faz sentido — é só referência visual de como vai ficar
// quando o app for empacotado de verdade. Em vez de comentar/remover
// o HTML manualmente (e esquecer de voltar depois), ela some sozinha
// aqui em runtime e o --titlebar-h é zerado pra o layout ocupar 100%
// da tela. Quando o Tauri entrar (window.__TAURI__ passa a existir de
// verdade), este bloco não roda e a titlebar volta a aparecer normal,
// sem precisar tocar em index.html/base.css de novo (ver decisão 22).
if (!isTauri) {
  document.querySelector(".titlebar")?.remove();
  document.documentElement.style.setProperty("--titlebar-h", "0px");
}

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