import { ApiError, get, post } from "../api/client.js";
import { showToast } from "./toast.js";
import { copyText } from "./clipboard.js";
import { watchdogHandlesConnection } from "./backend-watchdog.js";
import { estaNoDocumento } from "./no-documento.js";
import { t } from "../i18n.js";

/**
 * Aviso de erro global (CONF-01) — nenhum erro sem aviso.
 *
 * Duas fontes:
 *   1. `kami:api-error` (api/client.js): erro INESPERADO da API — backend
 *      fora (status 0) ou falha do servidor (5xx). Vira um toast vermelho
 *      que só some no ✕, com a mensagem do backend (que já traz o código
 *      `#k7f2a9`, o mesmo do kami-backend.log) e o botão "copiar
 *      detalhes". Erros esperados (4xx: valor inválido, não encontrado)
 *      NÃO passam por aqui: quem chamou mostra perto do campo, como
 *      sempre (decisão do Emanuel: 4xx no formulário, 5xx em toast).
 *   2. erro de JavaScript da própria tela (`error` /
 *      `unhandledrejection`): vai pro kami-backend.log via
 *      POST /api/sistema/erro-frontend (só mensagem e arquivo:linha,
 *      nunca dado digitado) e aparece um toast discreto. É o que permite
 *      investigar um problema que só acontece no Windows/WebView2 sem ter
 *      a máquina na mão.
 *
 * Repetição: enquanto um aviso de erro estiver aberto na tela, o mesmo
 * erro (mesmo tipo + mesma mensagem) não abre outro — e, depois de
 * fechado, só volta a aparecer passados REPEAT_WINDOW_MS. Com o backend
 * fora, cada widget da tela e cada rotina de fundo (lembretes do
 * calendário, sync de e-mail) falha junto e de novo a cada ciclo; como
 * o aviso de erro não some sozinho, sem isso a pilha encheria.
 */

const REPEAT_WINDOW_MS = 10000;
// erro de JS: no máximo um toast a cada SCRIPT_TOAST_GAP_MS (o log recebe todos)
const SCRIPT_TOAST_GAP_MS = 30000;
// janela em que o err-modal antigo deixa de abrir se o toast já mostrou o mesmo texto
const MODAL_DEDUPE_MS = 3000;

// erros do navegador que não são bug do Kami e não ajudam ninguém no log
const IGNORED_SCRIPT_ERRORS = [/^ResizeObserver loop/i, /^Script error\.?$/i];

const recent = new Map(); // chave → instante do último aviso
const openToasts = new Map(); // chave → elemento do aviso ainda na tela
let lastScriptToastAt = 0;
let telaAtual = "";
let wiredWindow = null; // em que window os listeners estão (testes trocam de jsdom)

/** app.js avisa a tela atual — entra no "copiar detalhes" e no log de erro da tela. */
export function setTelaAtual(name) {
  telaAtual = name || "";
}

/** A tela aberta agora — pra quem espera algo assíncrono conferir que ainda está nela. */
export const getTelaAtual = () => telaAtual;

/**
 * Pra err-modal.js: o toast de erro já mostrou exatamente esta mensagem
 * agora há pouco? (aí o modal não abre por cima com o mesmo texto)
 */
export function recentlyNotified(message) {
  const at = recent.get(`api:${message}`);
  return at !== undefined && Date.now() - at < MODAL_DEDUPE_MS;
}

function isRepeat(key) {
  if (estaNoDocumento(openToasts.get(key))) return true;
  const now = Date.now();
  const at = recent.get(key);
  recent.set(key, now);
  return at !== undefined && now - at < REPEAT_WINDOW_MS;
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function appVersion() {
  try {
    return (await get("/health")).version || "?";
  } catch {
    return "?"; // backend fora: o resto do diagnóstico ainda serve
  }
}

/** Texto do "copiar detalhes" — pra colar num relato de problema. Sem dado do
 * usuário; fica em português (quem lê é quem mantém o kami). */
export async function buildDetails({ method, path, status, codigo, errorId, message }) {
  const lines = [
    `Kami v${await appVersion()} — ${stamp()}`,
    `ação: ${method} ${String(path).split("?")[0]}`,
    `erro: ${status || "sem conexão"}${codigo ? ` ${codigo}` : ""}${errorId ? ` #${errorId}` : ""}`,
    `mensagem: ${message}`,
  ];
  if (telaAtual) lines.push(`tela: ${telaAtual}`);
  if (typeof navigator !== "undefined" && navigator.userAgent) lines.push(`sistema: ${navigator.userAgent}`);
  return lines.join("\n");
}


// Problema de AMBIENTE (banco travado, disco cheio, backend fora): uma
// causa só, que derruba várias chamadas ao mesmo tempo — um aviso por
// tipo. Visto no teste real com o banco travado: cada widget e cada
// rotina de fundo falhou com um código #id diferente e, com a chave
// antiga (mensagem, que inclui o código), apareceram 6 avisos iguais.
const ENVIRONMENT_CODES = new Set(["sem_conexao", "banco_ocupado", "sem_espaco", "banco_inacessivel", "banco_corrompido"]);

/** Chave de repetição: por tipo, se for ambiente; senão por ação (método + caminho). */
function noticeKey({ codigo, method, path, status }) {
  if (ENVIRONMENT_CODES.has(codigo) || status === 0) return `toast:${codigo || "sem_conexao"}`;
  return `toast:${codigo}:${method} ${String(path).split("?")[0]}`;
}

function titleFor({ status, method }) {
  if (status === 0) return t("error_notice.sem_conexao_com_o_backend");
  return method === "GET" ? t("error_notice.algo_deu_errado_ao_carregar") : t("error_notice.algo_deu_errado_ao_salvar");
}

function onApiError(e) {
  const detail = e.detail;
  // sem conexão com o vigia ligado (CONF-02): a faixa do vigia é o aviso
  // dessa situação — ele testa, reinicia e explica; um toast a mais só
  // repetiria "sem conexão"
  if (detail.status === 0 && watchdogHandlesConnection()) return;
  // status 0 fica de fora: na abertura do app, o modal "o backend do Kami
  // não iniciou" (app.js) tem a mensagem longa com o motivo e o caminho
  // do log — ele precisa abrir mesmo com o toast genérico na tela
  if (detail.status !== 0) recent.set(`api:${detail.message}`, Date.now());
  const key = noticeKey(detail);
  if (isRepeat(key)) return;
  showToast({
    variant: "erro",
    iconName: "x",
    title: titleFor(detail),
    message:
      detail.status === 0
        ? t("error_notice.o_app_nao_esta_conseguindo")
        : detail.message,
    duration: 0,
    actions: [
      {
        label: t("error_notice.copiar_detalhes"),
        onClick(btn) {
          buildDetails(detail)
            .then(copyText)
            .then((ok) => {
              btn.textContent = ok ? `${t("geral.copiado")} ✓` : t("error_notice.nao_deu_pra_copiar");
            });
        },
      },
    ],
  });
  // a pilha recebe o aviso novo por último — guarda pra saber se ainda está aberto
  const el = document.getElementById("toast-stack")?.lastElementChild;
  if (el) openToasts.set(key, el);
}

/** Caminho do arquivo relativo ao app (sem host/porta): `js/widgets/log.js`. */
function relativeSource(url) {
  if (!url) return "";
  try {
    const u = new URL(url, window.location.href);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return String(url).slice(0, 300);
  }
}

function reportScriptError({ tipo, mensagem, origem, linha, coluna, pilha }) {
  if (IGNORED_SCRIPT_ERRORS.some((re) => re.test(mensagem))) return;
  // o log recebe sempre; se o próprio envio falhar (backend fora), o
  // client já avisa "sem conexão" — não há o que fazer a mais aqui
  post("/api/sistema/erro-frontend", {
    tipo,
    mensagem: String(mensagem).slice(0, 500),
    origem: relativeSource(origem),
    linha: Number.isFinite(linha) ? linha : null,
    coluna: Number.isFinite(coluna) ? coluna : null,
    pilha: String(pilha || "").slice(0, 2000),
    tela: telaAtual.slice(0, 60),
  }).catch(() => {});

  const now = Date.now();
  if (now - lastScriptToastAt < SCRIPT_TOAST_GAP_MS) return;
  lastScriptToastAt = now;
  showToast({
    variant: "erro",
    iconName: "x",
    title: t("error_notice.algo_deu_errado_nesta_tela"),
    message: t("error_notice.o_erro_foi_registrado_no"),
    duration: 0,
  });
}

function onWindowError(e) {
  const err = e.error;
  reportScriptError({
    tipo: "erro",
    mensagem: err?.message || e.message || "erro desconhecido",
    origem: e.filename,
    linha: e.lineno,
    coluna: e.colno,
    pilha: err?.stack,
  });
}

function onUnhandledRejection(e) {
  const reason = e.reason;
  if (reason instanceof ApiError) {
    // inesperado → já virou toast pelo kami:api-error. Esperado (4xx)
    // que ninguém tratou: pelo menos aparece, em vez de sumir
    if (!reason.inesperado && !isRepeat(`toast:4xx:${reason.message}`)) {
      showToast({ variant: "erro", iconName: "x", title: t("error_notice.nao_deu_certo"), message: reason.message, duration: 0 });
    }
    return;
  }
  reportScriptError({
    tipo: "promessa",
    mensagem: reason?.message || String(reason ?? "promessa rejeitada sem motivo"),
    pilha: reason?.stack,
  });
}

export function wireErrorNotice() {
  if (wiredWindow === window) return;
  wiredWindow = window;
  window.addEventListener("kami:api-error", onApiError);
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
}
