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

async function resolveBaseUrl() {
  if (typeof window !== "undefined" && window.__TAURI__?.core?.invoke) {
    try {
      const port = await window.__TAURI__.core.invoke("get_backend_port");
      return `http://127.0.0.1:${port}`;
    } catch (err) {
      // não deve acontecer em produção (o comando só existe pra travar
      // até o sidecar escrever a porta) — mas não trava o app por isso
      console.error("falha ao obter a porta do backend via Tauri, caindo no padrão de dev:", err);
    }
  }
  return "http://127.0.0.1:8000";
}

function getBaseUrl() {
  if (!_baseUrlPromise) _baseUrlPromise = resolveBaseUrl();
  return _baseUrlPromise;
}

export class ApiError extends Error {
  constructor(status, body) {
    const msg = ApiError._extractMessage(body) ?? `Erro HTTP ${status}`;
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** Extrai uma mensagem legível de HTTPValidationError/ValidationError ou {detail: str}. */
  static _extractMessage(body) {
    if (!body) return null;
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail.length > 0) {
      // formato HTTPValidationError do FastAPI: detail é uma lista de {loc, msg, type}
      return body.detail.map((e) => e.msg).join("; ");
    }
    return null;
  }
}

async function request(path, options = {}) {
  const baseUrl = await getBaseUrl();
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
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
      cache: "no-store",
      ...options,
    });
  } catch (networkErr) {
    // backend fora do ar / ainda subindo — caso comum logo após abrir o app
    throw new ApiError(0, { detail: "não foi possível conectar ao backend do Kami" });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const get = (path) => request(path);
export const post = (path, data) => request(path, { method: "POST", body: JSON.stringify(data) });
export const put = (path, data) => request(path, { method: "PUT", body: JSON.stringify(data) });
export const patch = (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) });
export const del = (path) => request(path, { method: "DELETE" });