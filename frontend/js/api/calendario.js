import { get, post, put, del, patch } from "./client.js";

// eventos agregados do mês (renda, contas fixas, dívidas, assinaturas,
// parcelas, metas com prazo e eventos manuais) — ver app/routers/calendario.py
export const listEvents = (month) => get(`/api/calendario/events?month=${month}`);

// CRUD de eventos manuais ("evento") — único tipo com tabela própria.
export const createEvento = (payload) => post("/api/calendario/events/evento", payload);
export const updateEvento = (id, payload) => put(`/api/calendario/events/evento/${id}`, payload);
export const rescheduleEvento = (id, date) => patch(`/api/calendario/events/evento/${id}/date`, { date });
export const deleteEvento = (id) => del(`/api/calendario/events/evento/${id}`);