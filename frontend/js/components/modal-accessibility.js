/**
 * Acessibilidade genérica de modais — role="dialog", aria-modal,
 * aria-labelledby, focus trap (Tab/Shift+Tab não escapam do modal) e
 * devolução de foco pro elemento que abriu o modal quando ele fecha.
 *
 * Centralizado aqui em vez de duplicado nos ~23 arquivos de
 * frontend/js/modals/* (mesmo raciocínio de modal-escape.js): todos
 * seguem o mesmo padrão de markup da decisão 18 (ver base.css) —
 * `.modal-backdrop` com um `.modal` como filho direto — e o mesmo
 * padrão de abrir/fechar via `classList.add("open")` /
 * `classList.remove("open")`. Em vez de importar/chamar algo em cada
 * um desses arquivos, este módulo observa a mudança da classe "open"
 * (MutationObserver) e decora/trava o diálogo correspondente sem
 * precisar saber qual modal específico abriu.
 *
 * Backdrops cobertos:
 *  - `.modal-backdrop` → diálogo é o `.modal` filho direto. Cobre os
 *    modais de frontend/js/modals/* que usam esse padrão (todos exceto
 *    help-menu.js e kami-intro.js — ver abaixo) e, de brinde, os
 *    modais com o mesmo markup embutidos em pages/organizacao.js,
 *    pages/metas.js e pages/aprendizado.js.
 *  - `.ki-backdrop` (kami-intro.js) → diálogo é `.ki-box`. Usa a mesma
 *    convenção de classe "open", mas o markup já nasce com
 *    role="dialog" aria-modal="true" aria-label="kami" escrito direto
 *    no arquivo — aqui só entra o focus trap (ensureAria não mexe
 *    nele, ver `manageAria: false` abaixo). Também não faz sentido
 *    devolver foco a um "abridor": openKamiIntro() roda automaticamente
 *    no primeiro boot, não a partir de um clique — handleClose só
 *    devolve foco se havia um elemento realmente focado antes de abrir,
 *    então aqui isso vira no-op sozinho.
 *
 * Fora do escopo (estrutura diferente, tratados à parte — ver relatório
 * de mudança):
 *  - help-menu.js (`.help-menu-pop`) é um popover, não um modal (mesma
 *    nota em modal-escape.js) — não recebe role="dialog" nem focus
 *    trap.
 */

const BACKDROPS = [
  { backdrop: ".modal-backdrop", dialog: ":scope > .modal", manageAria: true },
  { backdrop: ".ki-backdrop", dialog: ".ki-box", manageAria: false },
];

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// backdrop element -> { opener } — guarda quem tinha foco antes do modal
// abrir, pra devolver quando fechar.
const openState = new WeakMap();

let titleIdSeq = 0;

function configFor(el) {
  return BACKDROPS.find((c) => el.matches(c.backdrop));
}

function dialogOf(backdropEl, config) {
  return backdropEl.querySelector(config.dialog);
}

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function focusableIn(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
}

/**
 * Garante role="dialog" + aria-modal="true" + aria-labelledby.
 * Idempotente (não sobrescreve o que o próprio modal já tiver definido
 * — ex.: onboarding-modal.js já escreve role/aria-modal no markup).
 *
 * Título: tenta, em ordem, `.modal-head-title` (padrão usado pela
 * maioria dos modais), um elemento com id dentro de `.modal-head`
 * (confirm-modal.js, err-modal.js, prompt-modal.js já nascem com
 * #cm-title/#em-title/#pm-title), um heading, e por fim o próprio
 * `.modal-head` como fallback pros ~5 modais cujo título é texto solto
 * sem elemento próprio (ex.: transacao-modal.js, registro-filter-modal.js)
 * — seguro porque o ícone de fechar ao lado é aria-hidden (ver
 * components/icons.js) e não injeta texto extra no nome acessível.
 */
function ensureAria(backdropEl, dialogEl) {
  if (!dialogEl.hasAttribute("role")) dialogEl.setAttribute("role", "dialog");
  if (!dialogEl.hasAttribute("aria-modal")) dialogEl.setAttribute("aria-modal", "true");
  if (dialogEl.hasAttribute("aria-labelledby") || dialogEl.hasAttribute("aria-label")) return;

  const titleEl =
    dialogEl.querySelector(".modal-head-title") ||
    dialogEl.querySelector(".modal-head [id]") ||
    dialogEl.querySelector(".modal-head h1, .modal-head h2, .modal-head h3") ||
    dialogEl.querySelector(".modal-head");
  if (!titleEl) return;

  if (!titleEl.id) {
    titleIdSeq += 1;
    titleEl.id = `${backdropEl.id || "modal"}-generated-title-${titleIdSeq}`;
  }
  dialogEl.setAttribute("aria-labelledby", titleEl.id);
}

function moveFocusIn(dialogEl) {
  const [first] = focusableIn(dialogEl);
  if (first) {
    first.focus();
    return;
  }
  // sem nada focável dentro (raro, mas possível em modais só de leitura)
  // — foca o próprio diálogo pra não deixar o foco solto no <body>.
  if (!dialogEl.hasAttribute("tabindex")) dialogEl.setAttribute("tabindex", "-1");
  dialogEl.focus();
}

function handleOpen(backdropEl, config) {
  if (openState.has(backdropEl)) return;
  const dialogEl = dialogOf(backdropEl, config);
  if (!dialogEl) return;

  if (config.manageAria) ensureAria(backdropEl, dialogEl);

  const opener =
    document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  openState.set(backdropEl, { opener });

  // espera o próximo frame: alguns modais (ex.: transacao-modal.js)
  // ainda populam/resetam campos do formulário logo depois do
  // classList.add("open"); focar cedo demais podia perder o foco pro
  // reset de valor de um campo feito na sequência.
  requestAnimationFrame(() => {
    if (!backdropEl.classList.contains("open")) return;
    moveFocusIn(dialogEl);
  });
}

function handleClose(backdropEl) {
  const state = openState.get(backdropEl);
  openState.delete(backdropEl);
  const opener = state?.opener;
  if (opener && document.contains(opener) && typeof opener.focus === "function") {
    opener.focus();
  }
}

/**
 * Modal mais no topo entre todos os backdrops conhecidos — mesmo
 * critério de modal-escape.js (ordem de inserção no DOM decide quem
 * fica visualmente por cima, já que todos usam o mesmo z-index).
 */
function topmostOpenBackdrop() {
  let found = null;
  for (const config of BACKDROPS) {
    document.querySelectorAll(`${config.backdrop}.open`).forEach((el) => {
      found = { el, config };
    });
  }
  return found;
}

function onKeydown(e) {
  if (e.key !== "Tab") return;
  const top = topmostOpenBackdrop();
  if (!top) return;
  const dialogEl = dialogOf(top.el, top.config);
  if (!dialogEl) return;

  const focusables = focusableIn(dialogEl);
  if (!focusables.length) {
    e.preventDefault();
    moveFocusIn(dialogEl);
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const activeInsideDialog = dialogEl.contains(active);

  // dropdown de custom-select.js é fixed e vive fora do .modal (ver
  // components/custom-select.js), mas não move foco real pra ele (só
  // navega por teclado a partir do <button> trigger, que continua
  // dentro do diálogo) — então activeInsideDialog continua verdadeiro
  // com o dropdown aberto e este trap não interfere nele.
  if (e.shiftKey) {
    if (!activeInsideDialog || active === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (!activeInsideDialog || active === last) {
    e.preventDefault();
    first.focus();
  }
}

function onMutation(mutations) {
  for (const m of mutations) {
    if (m.type !== "attributes" || m.attributeName !== "class") continue;
    const el = m.target;
    if (!(el instanceof Element)) continue;
    const config = configFor(el);
    if (!config) continue;

    const wasOpen = (m.oldValue || "").split(/\s+/).includes("open");
    const isOpen = el.classList.contains("open");
    if (wasOpen === isOpen) continue;

    if (isOpen) handleOpen(el, config);
    else handleClose(el);
  }
}

let wired = false;

/**
 * Chamar uma vez no boot do app (ver app.js, ao lado de
 * wireModalEscapeClose()). Funciona tanto pros backdrops já presentes
 * no DOM quanto pros construídos sob demanda depois (avatar-modal.js,
 * err-modal.js, confirm-modal.js etc.), porque reage à mudança de
 * classe "open", não à criação do elemento.
 */
export function wireModalAccessibility() {
  if (wired) return;
  wired = true;

  const observer = new MutationObserver(onMutation);
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
    attributeOldValue: true,
  });

  document.addEventListener("keydown", onKeydown, { capture: true });

  // cobre o caso (não esperado no fluxo normal, mas barato de tratar)
  // de um backdrop já nascer com "open" antes desta função rodar.
  for (const config of BACKDROPS) {
    document.querySelectorAll(`${config.backdrop}.open`).forEach((el) => handleOpen(el, config));
  }
}
