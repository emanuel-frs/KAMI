// js/components/pending-focus.js
//
// Mecanismo de "foco pendente" usado pelo drill-down do Calendário: ao
// clicar num evento, o Calendário não sabe (nem deveria saber) se o
// widget dono daquele registro está no dashboard configurável do
// usuário — então ele só deixa um pedido de foco aqui e navega pra
// tela certa. O widget/página dona do registro consome o pedido no
// fim do próprio render/reload e se destaca sozinho. Se nada consumir
// dentro do TTL (ex: widget não está no grid do usuário), o pedido
// expira sozinho e não deixa nada pendurado.

import { typeColor } from "./event-types.js";

let pending = null; // { type, id, ts }
const TTL_MS = 6000;

function isFresh(p) {
  return !!p && Date.now() - p.ts < TTL_MS;
}

export function setPendingFocus(type, id) {
  pending = { type, id, ts: Date.now() };
}

/** Consome (e limpa) o foco pendente se o tipo bater e ainda não expirou. */
export function consumePendingFocus(type) {
  if (isFresh(pending) && pending.type === type) {
    const id = pending.id;
    pending = null;
    return id;
  }
  if (pending && !isFresh(pending)) pending = null;
  return null;
}

/**
 * Rola até o elemento e aplica um flash de destaque temporário, na cor
 * do tipo do registro (a mesma cor da bolinha desse tipo no
 * Calendário — ver components/event-types.js). Sem `type` (ou tipo
 * desconhecido), cai no --accent do tema, como antes.
 */
export function focusRow(el, type) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.setProperty("--kami-focus-color", typeColor(type));
  el.classList.add("kami-focus-flash");
  setTimeout(() => {
    el.classList.remove("kami-focus-flash");
    el.style.removeProperty("--kami-focus-color");
  }, 2200);
}
