/**
 * Um elemento guardado numa variável do módulo (pilha de toasts, faixa do
 * vigia, modal reaproveitado…) ainda está NESTA tela?
 *
 * No app só existe um documento, mas nos testes cada caso monta um jsdom
 * novo; desde o jsdom 30 um elemento de um documento já fechado continua
 * com `isConnected` verdadeiro — sem conferir o `ownerDocument`, o módulo
 * reaproveitava o elemento da tela velha e o teste não o achava.
 */
export function estaNoDocumento(el) {
  return Boolean(el?.isConnected) && el.ownerDocument === document;
}
