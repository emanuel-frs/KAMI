/**
 * EST-03 (P-181): tamanho da tela — Ctrl + / Ctrl − / Ctrl 0 em qualquer
 * tela (inclusive com modal aberto: é só o tamanho) e os botões em
 * configurações › aparência.
 *
 * No app, o zoom é o do próprio webview (`setZoom`, permissão
 * `core:webview:allow-set-webview-zoom`): o layout continua em pixels
 * CSS e a janela só "encolhe" — o encaixe dos widgets mede igual. No
 * navegador de desenvolvimento, `zoom` no <html> faz o papel.
 *
 * Fica nesta máquina (localStorage), como a largura do painel do
 * assistente: depende da tela, não dos dados, e não vai no backup.
 */
import { t } from "../i18n.js";
import { showToast } from "./toast.js";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const PASSO = 0.1;
const CHAVE = "kami-zoom";

let atual = 1;
let fecharAviso = null;

const limitar = (f) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, f)) * 10) / 10;

export function zoomAtual() {
  return atual;
}

function lerGuardado() {
  try {
    const f = Number(localStorage.getItem(CHAVE));
    return f ? limitar(f) : 1;
  } catch {
    return 1;
  }
}

function aplicar(f) {
  const webview = window.__TAURI__?.webview?.getCurrentWebview?.();
  if (webview?.setZoom) {
    webview.setZoom(f).catch((err) => console.error("zoom: o webview recusou", err));
  } else {
    document.documentElement.style.zoom = f === 1 ? "" : String(f);
  }
}

/** Define o zoom (limitado e arredondado em 10%), guarda e avisa a tela. */
export function definirZoom(f, { aviso = false } = {}) {
  atual = limitar(f);
  aplicar(atual);
  try {
    if (atual === 1) localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, String(atual));
  } catch {
    /* sem localStorage: vale só até fechar */
  }
  window.dispatchEvent(new CustomEvent("kami:zoom", { detail: atual }));
  if (aviso) {
    // apertar várias vezes troca o aviso em vez de empilhar um por passo
    fecharAviso?.();
    fecharAviso = showToast({ title: t("zoom.aviso", { pct: Math.round(atual * 100) }), iconName: "resize", duration: 1500, sound: false });
  }
  return atual;
}

export const aumentarZoom = (opts) => definirZoom(atual + PASSO, opts);
export const diminuirZoom = (opts) => definirZoom(atual - PASSO, opts);
export const restaurarZoom = (opts) => definirZoom(1, opts);

/** Qual ação a tecla pede: "+", "-", "0" ou null. Ctrl+= também aumenta (o + é Shift+= em vários teclados). */
export function acaoDaTecla(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") return "+";
  if (e.key === "-" || e.code === "NumpadSubtract") return "-";
  if (e.key === "0" || e.code === "Numpad0") return "0";
  return null;
}

let ligado = false;
/** Aplica o zoom guardado e liga os atalhos. Chamar uma vez no boot (app.js). */
export function wireZoom() {
  if (ligado) return;
  ligado = true;
  atual = lerGuardado();
  if (atual !== 1) aplicar(atual);
  document.addEventListener("keydown", (e) => {
    const acao = acaoDaTecla(e);
    if (!acao) return;
    e.preventDefault();
    if (acao === "+") aumentarZoom({ aviso: true });
    else if (acao === "-") diminuirZoom({ aviso: true });
    else restaurarZoom({ aviso: true });
  });
}
