import { get, post, put, del } from "./client.js";

// IA-06: avisos proativos — backend/app/routers/avisos.py
const BASE = "/api/avisos";
/** roda as regras no backend e devolve os avisos ativos */
export const listAvisos = () => get(BASE);
export const dispensarAviso = (id) => post(`${BASE}/${id}/dispensar`, {});
export const avisoNotificado = (id) => post(`${BASE}/${id}/notificado`, {});
export const silenciarAviso = (id) => post(`${BASE}/${id}/silenciar`, {});
export const configAvisos = () => get(`${BASE}/config`);
/** `regra` "*" = todos os avisos */
export const definirRegraAviso = (regra, ligada) => put(`${BASE}/regras/${encodeURIComponent(regra)}`, { ligada });
export const voltarAAvisar = (regra, alvoId) => del(`${BASE}/silenciados/${encodeURIComponent(regra)}/${encodeURIComponent(alvoId)}`);
