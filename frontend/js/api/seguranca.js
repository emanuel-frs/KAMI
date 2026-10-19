import { get, post, put } from "./client.js";

// SEG-01: onde está a chave que protege as senhas salvas (cofre do
// sistema, arquivo ou indisponível) e a saída de quando o cofre a perdeu.
// Ver app/routers/seguranca.py e app/crypto.py. O `t` fura o cache de GET
// do client: depois de redefinir, o estado tem que vir novo.
export const getChave = () => get(`/api/seguranca/chave?t=${Date.now()}`);
export const redefinirChave = (confirmation) => post("/api/seguranca/chave/redefinir", { confirmation });

// SEG-02: PIN pra abrir o app (app/pin.py). O estado vem sempre novo (`t`):
// bloqueado/espera mudam a cada tentativa.
export const getPin = () => get(`/api/seguranca/pin?t=${Date.now()}`);
export const ativarPin = (pin) => post("/api/seguranca/pin", { pin });
export const trocarPin = (pinAtual, pinNovo) => put("/api/seguranca/pin", { pin_atual: pinAtual, pin_novo: pinNovo });
export const desativarPin = (pinAtual) => post("/api/seguranca/pin/desativar", { pin_atual: pinAtual });
export const desbloquearPin = (pin) => post("/api/seguranca/pin/desbloquear", { pin });
export const recuperarPin = (codigo, pinNovo) => post("/api/seguranca/pin/recuperar", { codigo, pin_novo: pinNovo });
export const bloquearPin = () => post("/api/seguranca/pin/bloquear", {});
export const definirInatividade = (minutos) => put("/api/seguranca/pin/inatividade", { minutos });
