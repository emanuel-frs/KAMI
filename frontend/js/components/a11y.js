/**
 * Helpers pequenos de acessibilidade compartilhados pelas páginas.
 *
 * makeFocusable(el, opts)
 *   Vários elementos do app são <span>/<div> com listener de clique — o
 *   Tab não chega neles e, mesmo que chegasse, Enter/Espaço não fazem
 *   nada (só <button> nativo dispara "click" com o teclado). Esta função
 *   dá ao elemento o que falta: role, tabindex="0", nome acessível e
 *   ativação por Enter/Espaço. É o mesmo padrão que já existia à mão em
 *   tip-sequence.js (.tip-skip) e toast.js.
 *
 *   Quando o elemento for só um botão de verdade escondido atrás de um
 *   estilo, prefira trocar a tag por <button> (como foi feito com o X dos
 *   modais). makeFocusable é pra quando trocar a tag mexeria demais no
 *   layout/CSS existente.
 *
 * announce(text)
 *   Anuncia um texto pra leitores de tela numa região `aria-live` global
 *   e discreta (sr-only). Serve pra mudanças que não movem o foco nem
 *   mostram nada novo na tela — ex.: "trilha movida para a posição 2 de 5"
 *   depois de reordenar por teclado.
 */

/**
 * prefersReducedMotion()
 *   Espelha o `prefers-reduced-motion: reduce` do SO/navegador pro lado
 *   JS — animações puramente CSS já respeitam isso via @media, mas
 *   coisas como scrollIntoView({behavior:"smooth"}) ou o scramble em
 *   setTimeout do boot-splash não têm equivalente em CSS, então quem
 *   dispara esse tipo de movimento consulta esta função antes.
 */
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function makeFocusable(el, { label, role = "button", onActivate, expanded } = {}) {
  if (!el) return el;
  if (role) el.setAttribute("role", role);
  el.setAttribute("tabindex", "0");
  if (label) el.setAttribute("aria-label", label);
  if (expanded !== undefined) el.setAttribute("aria-expanded", String(Boolean(expanded)));

  el.addEventListener("keydown", (e) => {
    if (e.target !== el) return; // não intercepta teclas de elementos filhos
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); // Espaço não rola a página
    if (onActivate) onActivate(e);
    else el.click();
  });
  return el;
}

let announcerEl = null;

function ensureAnnouncer() {
  if (announcerEl) return announcerEl;
  announcerEl = document.createElement("div");
  announcerEl.className = "sr-only";
  announcerEl.id = "kami-announcer";
  announcerEl.setAttribute("role", "status");
  announcerEl.setAttribute("aria-live", "polite");
  announcerEl.setAttribute("aria-atomic", "true");
  document.body.appendChild(announcerEl);
  return announcerEl;
}

// A região precisa existir antes da primeira mudança de texto pra ser
// anunciada (mesmo motivo do toast-stack em toast.js).
if (typeof document !== "undefined" && document.body) ensureAnnouncer();

export function announce(text) {
  const el = ensureAnnouncer();
  // limpa antes: repetir exatamente o mesmo texto não dispararia um
  // novo anúncio (ex.: mover duas vezes seguidas pra "posição 2 de 5").
  el.textContent = "";
  setTimeout(() => {
    el.textContent = text;
  }, 30);
}
