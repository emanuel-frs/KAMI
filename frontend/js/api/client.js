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

// TODO: tornar configurável se a porta do backend precisar mudar em
// produção (ex: lido de uma env var injetada pelo Tauri no build).
const BASE_URL = "http://127.0.0.1:8000";

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
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
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
export const del = (path) => request(path, { method: "DELETE" });
