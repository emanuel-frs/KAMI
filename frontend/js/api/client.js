/**
 * Cliente HTTP central pra API do Kami (FastAPI local).
 *
 * Todo módulo de api/*.js importa daqui em vez de usar fetch direto —
 * isso centraliza base URL, headers e tratamento de erro num único
 * lugar. Erros 4xx/5xx viram ApiError (com .status e .detail já
 * parseados do formato de validação do FastAPI: HTTPValidationError /
 * ValidationError, ver schemas do Swagger), então quem chama pode
 * decidir como mostrar isso na UI sem reimplementar o parsing.
 */
import { t } from "../i18n.js";

/**
 * Porta do backend (ver ALINHAMENTO.md 2.5): o sidecar empacotado sobe
 * numa porta livre escolhida pelo SO (não mais fixa em 8000), grava
 * essa porta num arquivo (ver backend/app/paths.py + run_server.py) e
 * o lado Rust do Tauri expõe um comando `get_backend_port` que lê
 * esse arquivo. Em dev/web (frontend servido via
 * `python3 -m http.server`, backend rodado manualmente com
 * `uvicorn --port 8000`) não existe `window.__TAURI__`, então cai
 * direto no fallback fixo — continua igual ao fluxo de dev de sempre.
 *
 * Resolvida uma vez e cacheada: todo `request()` reaproveita a mesma
 * promise em vez de invocar o comando Tauri a cada chamada de API.
 */
let _baseUrlPromise = null;

/**
 * Token de sessão do backend (ver backend/app/security.py). No app
 * empacotado o sidecar gera um segredo por execução e o Tauri o entrega
 * via `get_backend_token`; ele vai em todo request no header
 * `X-Kami-Token`. Sem `window.__TAURI__` (dev/web) fica vazio e nenhum
 * header é enviado — o backend de dev também não exige token.
 */
let _sessionToken = "";

async function resolveBaseUrl() {
  if (typeof window !== "undefined" && window.__TAURI__?.core?.invoke) {
    try {
      const port = await window.__TAURI__.core.invoke("get_backend_port");
      _sessionToken = (await window.__TAURI__.core.invoke("get_backend_token")) || "";
      return `http://127.0.0.1:${port}`;
    } catch (err) {
      // No app empacotado, cair silenciosamente na porta 8000 (o que
      // este código fazia antes) só esconde o problema real: o backend
      // não subiu, ninguém escuta na 8000, e o usuário via widgets
      // vazios e telas quebradas sem nenhuma explicação. Agora o erro
      // do lado Rust (que já traz o motivo e o caminho do
      // kami-backend.log) sobe até a UI — ver doFetch e loadProfile em
      // app.js. O fallback de 8000 continua só pro fluxo de dev/web,
      // onde não existe window.__TAURI__.
      const reason = typeof err === "string" ? err : err?.message || String(err);
      throw new Error(reason);
    }
  }
  return "http://127.0.0.1:8000";
}

function getBaseUrl() {
  if (!_baseUrlPromise) {
    // não cacheia falha: se o backend demorou e o app tentar de novo
    // (ou o usuário navegar pra outra tela), a próxima chamada
    // resolve de novo em vez de ficar preso ao erro pra sempre
    _baseUrlPromise = resolveBaseUrl().catch((err) => {
      _baseUrlPromise = null;
      throw err;
    });
  }
  return _baseUrlPromise;
}

/**
 * CONF-02 (components/backend-watchdog.js): depois de reiniciar o
 * backend, porta e token mudam — esquece os antigos (e o cache de GET)
 * pra próxima chamada perguntar ao Tauri de novo.
 */
export function resetBackendConnection() {
  _baseUrlPromise = null;
  _sessionToken = "";
  _getCache.clear();
}

/**
 * CONF-02: o backend está respondendo? GET /health com limite de tempo,
 * sem cache, sem token (a rota é aberta) e SEM avisar ninguém — quem
 * chama (o vigia) decide o que mostrar. Nunca lança: devolve true/false.
 */
export async function pingBackend(timeoutMs = 4000) {
  let baseUrl;
  try {
    baseUrl = await getBaseUrl();
  } catch {
    return false; // o Tauri já sabe que o backend não subiu/morreu
  }
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${baseUrl}/health`, { cache: "no-store", signal: ctrl?.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// erros que o backend classifica sozinho (app/erros.py::classificar)
const ERROS_DE_AMBIENTE = new Set(["erro_interno", "banco_ocupado", "sem_espaco", "banco_inacessivel", "banco_corrompido"]);

export class ApiError extends Error {
  constructor(status, body) {
    const msg = ApiError._extractMessage(body) ?? `Erro HTTP ${status}`;
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    // CONF-01: formato único de erro do backend (app/erros.py) —
    // `codigo` é o tipo (erro_interno, banco_ocupado, validacao...) e
    // `errorId` o código curto que também está no kami-backend.log
    this.codigo = body?.codigo ?? (status === 0 ? "sem_conexao" : null);
    this.errorId = body?.id ?? null;
  }

  /**
   * Erro que a pessoa não causou e não tem como corrigir no formulário:
   * backend fora (status 0) ou falha do lado do servidor (5xx). Esses
   * viram o toast de erro global (components/error-notice.js); os 4xx
   * (valor inválido, não encontrado...) continuam sendo mostrados por
   * quem chamou, perto do campo.
   */
  get inesperado() {
    return this.status === 0 || this.status >= 500;
  }

  /** Extrai uma mensagem legível de HTTPValidationError/ValidationError ou {detail: str}. */
  static _extractMessage(body) {
    if (!body) return null;
    // I18N-01: mensagem traduzível (backend/app/mensagens.py) no idioma da
    // pessoa; erro de ambiente (app/erros.py::classificar) pelo `codigo`.
    // Rota ainda sem chave: o `detail` em português de sempre.
    // Sem a tradução (dicionário que não carregou), t() devolve a própria
    // chave: aí fica o `detail`.
    if (body.chave && t(body.chave, body.vars || {}) !== body.chave) return t(body.chave, body.vars || {});
    const chaveAmbiente = `erro.${body.codigo}`;
    if (ERROS_DE_AMBIENTE.has(body.codigo) && t(chaveAmbiente) !== chaveAmbiente) {
      return t(chaveAmbiente) + (body.id ? ` ${t("erro.codigo", { id: body.id })}` : "");
    }
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail.length > 0) {
      // formato HTTPValidationError do FastAPI: detail é uma lista de {loc, msg, type}
      return body.detail.map((e) => e.msg).join("; ");
    }
    return null;
  }
}

async function doFetch(path, options) {
  let baseUrl;
  try {
    baseUrl = await getBaseUrl();
  } catch (startErr) {
    // backend não subiu (mensagem já vem pronta do Tauri, com o motivo
    // e o caminho do log) — status 0 = "sem conexão", igual ao caso
    // de rede abaixo, pra quem trata ApiError não precisar de um
    // tipo novo
    throw new ApiError(0, { detail: startErr.message });
  }
  let res;
  try {
    const headers = { "Content-Type": "application/json" };
    if (_sessionToken) headers["X-Kami-Token"] = _sessionToken;
    res = await fetch(`${baseUrl}${path}`, {
      headers,
      // `cache: "no-store"` em toda chamada (não só GET) — o webview do
      // Tauri (WebKit no linux/mac, WebView2 no windows) já demonstrou
      // servir uma resposta antiga em cache pra uma URL idêntica mesmo
      // sem o backend mandar Cache-Control algum (FastAPI não manda por
      // padrão em rotas JSON simples), reproduzido no cache de e-mail:
      // GET /email-cache?account_id=X ficava preso na primeira resposta
      // (vazia, de antes do primeiro sync) até algo — qualquer coisa —
      // "convencer" o webview a revalidar, ex: silenciar/dessilenciar
      // que dispara outra chamada de rede no meio. Sem isso o Kami
      // dependeria de sorte de cache do navegador pra ver dado fresco.
      // (isso é cache de HTTP/navegador — não tem nada a ver com o
      // _getCache abaixo, que é nosso, explícito, e some por completo a
      // qualquer escrita.)
      cache: "no-store",
      ...options,
    });
  } catch (networkErr) {
    // backend fora do ar / ainda subindo — caso comum logo após abrir o app
    throw new ApiError(0, { detail: "não foi possível conectar ao backend do Kami", chave: "erro.sem_conexao" });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return null;
  return res.json();
}

const GET_CACHE_TTL_MS = 20000;
const _getCache = new Map();

function clearGetCache() {
  _getCache.clear();
}

/**
 * CONF-01: avisa a tela inteira de um erro inesperado (ver
 * ApiError.inesperado). Quem mostra é components/error-notice.js — a
 * camada de API só conta que aconteceu, igual ao kami:data-changed.
 */
function announceUnexpected(err, method, path) {
  if (!(err instanceof ApiError) || !err.inesperado) return;
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(
      new CustomEvent("kami:api-error", {
        detail: { method, path, status: err.status, message: err.message, codigo: err.codigo, errorId: err.errorId },
      })
    );
  } catch {
    // o aviso nunca pode trocar o erro original por outro — quem chamou
    // continua recebendo o ApiError de verdade logo abaixo
  }
}

/**
 * SEG-02: 423 = o PIN está ligado e o backend bloqueado (ex.: o vigia
 * reiniciou o backend, que nasce bloqueado). components/lock-screen.js
 * escuta e mostra a tela do PIN.
 */
function announceLocked(err) {
  if (!(err instanceof ApiError) || err.status !== 423) return;
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent("kami:bloqueado"));
  } catch {
    // idem announceUnexpected: nunca troca o erro original
  }
}

async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  try {
    return await requestInner(path, options, method);
  } catch (err) {
    announceUnexpected(err, method, path);
    announceLocked(err);
    throw err;
  }
}

async function requestInner(path, options, method) {

  if (method !== "GET") {
    let result;
    try {
      result = await doFetch(path, options);
    } finally {
      clearGetCache();
    }
    // aviso genérico de "algo foi gravado" — quem precisa reagir a
    // escritas de qualquer módulo (ex: components/progress-watcher.js,
    // que confere se a escrita rendeu xp/nível/conquista) escuta isso
    // em vez de cada tela disparar o próprio evento. A camada de API
    // continua sem saber nada de gamificação.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kami:data-changed", { detail: { method, path } }));
    }
    return result;
  }

  const cached = _getCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = doFetch(path, options).catch((err) => {
    _getCache.delete(path);
    throw err;
  });
  _getCache.set(path, { expiresAt: Date.now() + GET_CACHE_TTL_MS, promise });
  return promise;
}

export const get = (path) => request(path);
export const post = (path, data) => request(path, { method: "POST", body: JSON.stringify(data) });
export const put = (path, data) => request(path, { method: "PUT", body: JSON.stringify(data) });
export const patch = (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) });
export const del = (path) => request(path, { method: "DELETE" });