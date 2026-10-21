import { get, post, put, del } from "./client.js";

// ORG-05: lembretes — backend/app/routers/lembretes.py
const BASE = "/api/lembretes";
export const listLembretes = () => get(BASE);
export const listPendentes = () => get(`${BASE}/pendentes`);
export const createLembrete = (dados) => post(BASE, dados);
export const updateLembrete = (id, dados) => put(`${BASE}/${id}`, dados);
export const deleteLembrete = (id) => del(`${BASE}/${id}`);
export const dispararLembretes = () => post(`${BASE}/disparar`, {});
/** `quanto`: {minutos: n} ou {amanha: true} */
export const adiarLembrete = (id, quanto) => post(`${BASE}/${id}/adiar`, quanto);
export const dispensarLembrete = (id) => post(`${BASE}/${id}/dispensar`, {});
