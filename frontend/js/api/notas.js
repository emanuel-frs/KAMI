import { get, post, put, del } from "./client.js";

// notas da Organização (ORG-01) — ver backend/app/routers/notas.py
const BASE = "/api/organizacao/notas";

function qs(params = {}) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const listNotas = (filtros) => get(`${BASE}${qs(filtros)}`);
export const listTagsNotas = () => get(`${BASE}/tags`);
export const listAlvosNota = (tipo) => get(`${BASE}/alvos${qs({ tipo })}`);
export const contarNotasPorVinculo = (vinculoTipo) => get(`${BASE}/contagem${qs({ vinculo_tipo: vinculoTipo })}`);
export const getNota = (id) => get(`${BASE}/${id}`);
export const createNota = (data) => post(BASE, data);
export const updateNota = (id, data) => put(`${BASE}/${id}`, data);
export const deleteNota = (id, chave) => del(`${BASE}/${id}${qs({ chave })}`);
export const abrirNota = (id, pin) => post(`${BASE}/${id}/abrir`, { pin });
export const trancarNota = (id) => post(`${BASE}/${id}/trancar`, {});
export const destrancarNota = (id, pin) => post(`${BASE}/${id}/destrancar`, { pin });
