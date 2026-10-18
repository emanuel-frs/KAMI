import { get, post } from "./client.js";

// Backup completo, importação e reset dos
// dados do usuário. Ver app/routers/sistema.py: import/reset exigem a
// palavra de confirmação exata no corpo da requisição, mesmo que o
// modal já tenha validado isso do lado do frontend (defesa em
// profundidade pra uma ação irreversível).
export const exportData = () => get("/api/sistema/export");
export const importData = (confirmation, tables) => post("/api/sistema/import", { confirmation, tables });
export const resetData = (confirmation) => post("/api/sistema/reset", { confirmation });
// CONF-06: texto pra relato de problema, já sem dado pessoal. O `t` fura o
// cache de GET do client (20 s) — o fim do log muda a cada segundo.
export const getDiagnostico = () => get(`/api/sistema/diagnostico?t=${Date.now()}`);