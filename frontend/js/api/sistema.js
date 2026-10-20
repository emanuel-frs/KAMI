import { get, post } from "./client.js";

// Backup completo, importação e reset dos
// dados do usuário. Ver app/routers/sistema.py: import/reset exigem a
// palavra de confirmação exata no corpo da requisição, mesmo que o
// modal já tenha validado isso do lado do frontend (defesa em
// profundidade pra uma ação irreversível).
export const exportData = () => get("/api/sistema/export");
// SEG-03: backup com senha — o backend cifra (scrypt + AES-GCM) e devolve o
// arquivo pronto em `arquivo`; na importação, um arquivo protegido vai
// inteiro em `cifrado` junto com a senha (ver app/backup_cifrado.py)
export const exportProtegido = (senha) => post("/api/sistema/export-protegido", { senha });
export const importData = (confirmation, tables) => post("/api/sistema/import", { confirmation, tables });
export const importProtegido = (confirmation, cifrado, senha) =>
  post("/api/sistema/import", { confirmation, cifrado, senha });
export const resetData = (confirmation) => post("/api/sistema/reset", { confirmation });
// CONF-06: texto pra relato de problema, já sem dado pessoal. O `t` fura o
// cache de GET do client (20 s) — o fim do log muda a cada segundo.
export const getDiagnostico = () => get(`/api/sistema/diagnostico?t=${Date.now()}`);