import { get } from "./client.js";

// eventos agregados do mês (renda, contas fixas, dívidas, assinaturas,
// parcelas e metas com prazo) — ver app/routers/calendario.py
export const listEvents = (month) => get(`/api/calendario/events?month=${month}`);