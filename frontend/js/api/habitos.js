import { get, post, put, del } from "./client.js";

// ORG-04: hábitos — backend/app/routers/habitos.py
const BASE = "/api/habitos";
export const listHabitos = ({ arquivados = false } = {}) => get(`${BASE}${arquivados ? "?arquivados=true" : ""}`);
export const createHabito = (dados) => post(BASE, dados);
export const updateHabito = (id, dados) => put(`${BASE}/${id}`, dados);
export const deleteHabito = (id) => del(`${BASE}/${id}`);
/** `dia` ISO (sem = hoje). Devolve o hábito atualizado. */
export const marcarHabito = (id, dia) => post(`${BASE}/${id}/marcar`, dia ? { dia } : {});
export const desmarcarHabito = (id, dia) => del(`${BASE}/${id}/marcar${dia ? `?dia=${encodeURIComponent(dia)}` : ""}`);
