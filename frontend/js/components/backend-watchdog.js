import { pingBackend, resetBackendConnection } from "../api/client.js";
import { icon } from "./icons.js";
import { showToast } from "./toast.js";
import { playSound } from "./sound.js";
import { estaNoDocumento } from "./no-documento.js";
import { t } from "../i18n.js";

/**
 * Vigia do backend (CONF-02): o backend caiu → avisa e reinicia.
 *
 * Como funciona:
 *   - testa o GET /health a cada timing.checkInterval (15 s, combinado com o
 *     Emanuel) e também logo depois de qualquer erro "sem conexão" da API
 *     (kami:api-error com status 0);
 *   - uma falha isolada não conta (pode ser um soluço): confirma com um
 *     segundo teste timing.confirmDelay depois;
 *   - confirmado que caiu: no app empacotado tenta REINICIAR SOZINHO uma
 *     vez (decisão do Emanuel), com a faixa "reiniciando o backend…". Se
 *     voltar, a faixa some, aparece um aviso curto e a tela atual é
 *     recarregada (onRecovered). Se não voltar, a faixa fica com o motivo
 *     e os botões [reiniciar] e [abrir pasta do log];
 *   - modo dev (sem Tauri, ou KAMI_DEV_NO_SIDECAR): não há o que
 *     reiniciar daqui — a faixa diz pra subir o uvicorn de novo e some
 *     sozinha quando ele voltar.
 *
 * Enquanto o vigia está ligado, o aviso genérico "sem conexão" do
 * error-notice.js (CONF-01) não aparece: a faixa é o aviso dessa situação
 * (ver watchdogHandlesConnection).
 *
 * A faixa fica fixa logo abaixo da barra de título, por cima do conteúdo
 * (não empurra o layout — a altura da tela é calculada sem ela), com
 * role="alert" pra leitores de tela anunciarem na hora.
 */

const timing = {
  checkInterval: 15000,
  confirmDelay: 1500,
  // depois que o Rust publicou a porta nova, quanto esperar o /health
  // responder (a espera pela PORTA fica com o get_backend_port do Rust,
  // que aguenta até 60 s no primeiro start do Windows e devolve o erro na
  // hora se o processo não subiu)
  restartWait: 15000,
  // intervalo entre os testes enquanto espera o backend novo
  restartPoll: 1000,
};

/** Só pra testes: encurta os tempos. */
export function _setWatchdogTimingForTests(overrides) {
  Object.assign(timing, overrides);
}

let state = "ok"; // ok | verificando | reiniciando | fora
let autoRestartTried = false;
let timer = null;
let bannerEl = null;
let onRecoveredCb = null;
let checking = null;
let active = false;
let listenerWindow = null; // onde o listener foi registrado (testes trocam de jsdom)

function onApiError(e) {
  if (e.detail?.status === 0) check();
}

const tauri = () => (typeof window !== "undefined" ? window.__TAURI__?.core : null);

/** error-notice.js pergunta isso pra não duplicar o aviso de "sem conexão". */
export function watchdogHandlesConnection() {
  return active;
}

/** Só pra testes: estado atual do vigia. */
export function watchdogState() {
  return state;
}

function ensureBanner() {
  if (estaNoDocumento(bannerEl)) return bannerEl;
  bannerEl = document.createElement("div");
  bannerEl.className = "backend-banner";
  bannerEl.id = "backend-banner";
  bannerEl.setAttribute("role", "alert");
  bannerEl.hidden = true;
  document.body.appendChild(bannerEl);
  return bannerEl;
}

function renderBanner({ title, message = "", buttons = false, busy = false }) {
  const el = ensureBanner();
  el.hidden = false;
  el.classList.toggle("busy", busy);
  el.innerHTML = `
    <span class="backend-banner-icon">${busy ? "…" : icon("x", { size: 13 })}</span>
    <div class="backend-banner-body">
      <div class="backend-banner-title"></div>
      ${message ? `<div class="backend-banner-message"></div>` : ""}
    </div>
    ${buttons ? `
      <div class="backend-banner-actions">
        <button type="button" class="btn sm" data-action="restart">${t("backend_watchdog.reiniciar")}</button>
        <button type="button" class="btn sm" data-action="open-log">${t("backend_watchdog.abrir_pasta_do_log")}</button>
      </div>` : ""}
  `;
  // textContent: a mensagem vem do Rust (motivo + caminho do log) — nunca vira HTML
  el.querySelector(".backend-banner-title").textContent = title;
  if (message) el.querySelector(".backend-banner-message").textContent = message;
  el.querySelector('[data-action="restart"]')?.addEventListener("click", () => restart({ manual: true }));
  el.querySelector('[data-action="open-log"]')?.addEventListener("click", openLogFolder);
}

function hideBanner() {
  if (bannerEl) {
    bannerEl.hidden = true;
    bannerEl.innerHTML = "";
  }
}

async function openLogFolder() {
  try {
    await tauri().invoke("open_log_folder");
  } catch (err) {
    showToast({ variant: "erro", iconName: "x", title: t("backend_watchdog.nao_deu_pra_abrir_a"), message: String(err), duration: 0 });
  }
}

/** Motivo que o Rust guardou (ex.: "encerrou inesperadamente (código 1)... Log completo: ..."). */
async function failureReason() {
  try {
    await tauri()?.invoke("get_backend_port");
    return "";
  } catch (err) {
    return typeof err === "string" ? err : err?.message || "";
  }
}

async function waitUntilBack(deadline) {
  while (Date.now() < deadline) {
    if (await pingBackend()) return true;
    await new Promise((r) => setTimeout(r, timing.restartPoll));
  }
  return false;
}

function recovered() {
  const wasDown = state !== "ok";
  state = "ok";
  autoRestartTried = false;
  hideBanner();
  if (wasDown) {
    showToast({ title: t("backend_watchdog.backend_do_kami_de_volta"), message: t("backend_watchdog.a_tela_foi_recarregada"), iconName: "check" });
    onRecoveredCb?.();
  }
}

function showDown(reason) {
  state = "fora";
  playSound("erro");
  if (!tauri()) {
    renderBanner({
      title: t("backend_watchdog.o_backend_do_kami_parou"),
      message: t("backend_watchdog.modo_dev_suba_o_backend"),
    });
    return;
  }
  renderBanner({
    title: t("backend_watchdog.o_backend_do_kami_parou"),
    message: reason || t("backend_watchdog.nao_reiniciou"),
    buttons: true,
  });
}

/** Reinicia pelo Rust e espera o backend novo responder. */
export async function restart({ manual = false } = {}) {
  if (!tauri() || state === "reiniciando") return false;
  state = "reiniciando";
  renderBanner({ title: t("backend_watchdog.reiniciando_o_backend_do_kami"), message: manual ? "" : t("backend_watchdog.tentando_de_novo"), busy: true });
  try {
    await tauri().invoke("restart_backend");
  } catch (err) {
    // ex.: modo dev com KAMI_DEV_NO_SIDECAR — a mensagem do Rust explica
    showDown(typeof err === "string" ? err : err?.message);
    return false;
  }
  resetBackendConnection();
  // espera a porta NOVA pelo Rust: se o processo nem subiu (antivírus,
  // arquivo sumiu), o erro volta na hora com o motivo e o caminho do log —
  // antes ficávamos testando o /health até o limite (visto no teste real:
  // a faixa ficou mais de 40 s em "reiniciando…" à toa)
  try {
    await tauri().invoke("get_backend_port");
  } catch (err) {
    showDown(typeof err === "string" ? err : err?.message);
    return false;
  }
  if (await waitUntilBack(Date.now() + timing.restartWait)) {
    recovered();
    return true;
  }
  showDown(await failureReason());
  return false;
}

/** Um ciclo do vigia. Nunca roda dois ao mesmo tempo. */
export function check() {
  if (checking) return checking;
  checking = (async () => {
    try {
      if (state === "reiniciando") return;
      if (await pingBackend()) {
        if (state !== "ok") recovered();
        return;
      }
      // soluço ou queda de verdade? confirma antes de assustar
      await new Promise((r) => setTimeout(r, timing.confirmDelay));
      if (await pingBackend()) {
        if (state !== "ok") recovered();
        return;
      }
      if (state === "fora") return; // já avisado; segue testando até voltar
      if (tauri() && !autoRestartTried) {
        autoRestartTried = true;
        await restart();
        return;
      }
      showDown(await failureReason());
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/**
 * Liga o vigia. `onRecovered` é chamado quando o backend volta depois de
 * uma queda (app.js recarrega o perfil e a tela atual).
 */
export function startBackendWatchdog({ onRecovered } = {}) {
  onRecoveredCb = onRecovered || null;
  if (active) return;
  active = true;
  listenerWindow = window;
  listenerWindow.addEventListener("kami:api-error", onApiError);
  timer = setInterval(check, timing.checkInterval);
}

/** Só pra testes. */
export function stopBackendWatchdog() {
  clearInterval(timer);
  timer = null;
  listenerWindow?.removeEventListener("kami:api-error", onApiError);
  listenerWindow = null;
  active = false;
  state = "ok";
  autoRestartTried = false;
  checking = null;
  hideBanner();
}
