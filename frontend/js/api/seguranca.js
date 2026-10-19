import { get, post } from "./client.js";

// SEG-01: onde está a chave que protege as senhas salvas (cofre do
// sistema, arquivo ou indisponível) e a saída de quando o cofre a perdeu.
// Ver app/routers/seguranca.py e app/crypto.py. O `t` fura o cache de GET
// do client: depois de redefinir, o estado tem que vir novo.
export const getChave = () => get(`/api/seguranca/chave?t=${Date.now()}`);
export const redefinirChave = (confirmation) => post("/api/seguranca/chave/redefinir", { confirmation });
