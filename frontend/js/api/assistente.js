import { get, post, put, del, postStream } from "./client.js";

// IA-01: assistente de IA (backend/app/routers/assistente.py). A chave da
// API vai na criação/edição e nunca volta (o backend devolve `tem_chave`).
export const getAssistente = () => get(`/api/assistente?t=${Date.now()}`);
export const getCatalogo = () => get("/api/assistente/catalogo");
export const salvarConfigAssistente = (campos) => put("/api/assistente/config", campos);
export const getProvedores = () => get(`/api/assistente/provedores?t=${Date.now()}`);
export const criarProvedor = (dados) => post("/api/assistente/provedores", dados);
export const editarProvedor = (id, dados) => put(`/api/assistente/provedores/${encodeURIComponent(id)}`, dados);
export const apagarProvedor = (id) => del(`/api/assistente/provedores/${encodeURIComponent(id)}`);
export const usarProvedor = (id) => post(`/api/assistente/provedores/${encodeURIComponent(id)}/usar`, {});
export const testarProvedor = (id) => post(`/api/assistente/provedores/${encodeURIComponent(id)}/testar`, {});
export const listarModelos = (dados) => post("/api/assistente/modelos", dados);

// IA-02: chat. A resposta chega em eventos (inicio, texto, fim, erro —
// backend/app/assistente/chat.py) por `onEvento`; `signal` é o botão parar.
export const enviarMensagem = (dados, { signal, onEvento }) => postStream("/api/assistente/mensagens", dados, { signal, onEvento });
export const getConversas = () => get(`/api/assistente/conversas?t=${Date.now()}`);
export const getConversa = (id) => get(`/api/assistente/conversas/${encodeURIComponent(id)}?t=${Date.now()}`);
export const apagarConversa = (id) => del(`/api/assistente/conversas/${encodeURIComponent(id)}`);
export const apagarTodasConversas = () => del("/api/assistente/conversas");
export const getEnvios = () => get(`/api/assistente/envios?t=${Date.now()}`);
export const apagarEnvios = () => del("/api/assistente/envios");
