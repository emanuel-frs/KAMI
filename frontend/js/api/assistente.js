import { get, post, put, del } from "./client.js";

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
