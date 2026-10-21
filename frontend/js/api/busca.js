import { get } from "./client.js";

// ORG-03: busca global (paleta Ctrl+K) — backend/app/busca.py
export const buscar = (q, tipos) =>
  get(`/api/busca?q=${encodeURIComponent(q)}${tipos ? `&tipos=${encodeURIComponent(tipos)}` : ""}`);
