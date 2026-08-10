import { get, post } from "./client.js";

// /health já existia pra checar se o backend subiu; agora também carrega
// a versão atual do Kami (lida do arquivo VERSION na raiz do repo — ver
// backend/app/version.py). Usado pelo widget de perfil pra mostrar o
// selo "vX.Y.Z" ao lado do avatar.
export const getHealth = () => get("/health");

// ALINHAMENTO.md 4.3/4.4 — backup completo, importação e reset dos
// dados do usuário. Ver app/routers/system.py: import/reset exigem a
// palavra de confirmação exata no corpo da requisição, mesmo que o
// modal já tenha validado isso do lado do frontend (defesa em
// profundidade pra uma ação irreversível).
export const exportData = () => get("/api/system/export");
export const importData = (confirmation, tables) => post("/api/system/import", { confirmation, tables });
export const resetData = (confirmation) => post("/api/system/reset", { confirmation });