import { get } from "./client.js";

// /health já existia pra checar se o backend subiu; agora também carrega
// a versão atual do Kami (lida do arquivo VERSION na raiz do repo — ver
// backend/app/version.py). Usado pelo widget de perfil pra mostrar o
// selo "vX.Y.Z" ao lado do avatar.
export const getHealth = () => get("/health");
