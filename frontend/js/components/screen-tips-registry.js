/**
 * Registro global de "replay de dicas da tela atual" (etapa 6,
 * plano-onboarding-kami.md — opção "rever dicas desta tela" do botão de
 * ajuda).
 *
 * O botão de ajuda vive na sidebar (fora do container de qualquer
 * página — ver index.html/app.js), então não tem acesso direto ao
 * `grid` da página montada no momento. Em vez disso, cada página que
 * tiver uma sequência de dicas (hoje só nucleo.js) registra sua própria
 * função de replay ao montar e desregistra ao desmontar; o botão de
 * ajuda só chama o que estiver registrado nesse momento.
 *
 * Sem registro nenhum (telas que ainda não ganharam dicas contextuais,
 * ver seção 8 do plano) => getScreenTipsReplay() volta null, e quem
 * consome isso (help-menu.js) desabilita a opção em vez de tentar
 * chamar algo que não existe.
 */
let currentReplay = null;

export function registerScreenTipsReplay(fn) {
  currentReplay = fn;
}

/** Só limpa se `fn` ainda for quem está registrado — evita que o
 * unmount de uma página antiga apague o registro de uma nova que já
 * montou por cima (troca rápida de tela). */
export function clearScreenTipsReplay(fn) {
  if (currentReplay === fn) currentReplay = null;
}

export function getScreenTipsReplay() {
  return currentReplay;
}
