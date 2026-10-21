import { get, post, del } from "./client.js";

// ORG-02: caixa de entrada da captura rápida — backend/app/routers/entrada.py
const BASE = "/api/organizacao/entrada";
export const listEntrada = () => get(BASE);
export const guardarEntrada = (texto) => post(BASE, { texto });
export const descartarEntrada = (id) => del(`${BASE}/${id}`);
export const virarTarefa = (id) => post(`${BASE}/${id}/tarefa`, {});
