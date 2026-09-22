/**
 * Registro central de atalhos de teclado — globais e por tela.
 *
 * Mesmo desenho de screen-tips-registry.js: cada página registra seus
 * atalhos ao montar (registerScreenShortcuts) e desregistra ao desmontar
 * (clearScreenShortcuts). O modal de ajuda (modals/shortcuts-help-modal.js)
 * lê daqui, então a lista mostrada ao usuário é sempre a MESMA que está
 * de fato ligada — não existe texto de ajuda separado pra ficar
 * desatualizado.
 *
 * ── Convenção: todos os atalhos de AÇÃO são Alt + tecla ───────────────
 *  - WCAG 2.1.4 (atalhos de tecla de caractere) só se aplica a atalhos
 *    de uma tecla imprimível SEM modificador. Com Alt, a regra não
 *    incide — não precisa de opção pra desligar/remapear.
 *  - Não colide com leitores de tela: NVDA/JAWS usam Insert/CapsLock
 *    como tecla de comando, e o Orca usa Insert/CapsLock também.
 *  - Casamos por `event.code` (posição física da tecla: "KeyN"), não por
 *    `event.key`. No macOS, Option+N gera "˜" em `key`, e em layouts
 *    diferentes de QWERTY a letra muda de lugar; `code` é estável.
 *  - AltGr NÃO conta. No teclado ABNT2 (e outros), AltGr é o Alt da
 *    direita e digita caracteres (AltGr+Q = "/"). No Windows ele chega
 *    como Ctrl+Alt; no Linux, como getModifierState("AltGraph"). Os dois
 *    casos são ignorados pra nunca roubar digitação.
 *  - Alt+Setas ficam de fora de propósito (Alt+← / Alt+→ = voltar/avançar
 *    em navegadores). Navegação por setas dentro de listas usa as setas
 *    puras e Shift+setas, sem Alt (ver páginas).
 *
 * Os atalhos NÃO disparam com modal, apresentação ou tour abertos — a
 * página por baixo não deveria reagir enquanto o usuário está em outro
 * contexto (mesma ideia do focus trap em modal-accessibility.js).
 */

const globalActions = [];
let currentScreen = null; // { name, actions, hints }
let wired = false;

/**
 * @param {Array<{ code: string, shift?: boolean, label: string, run: (e: KeyboardEvent) => void, when?: () => boolean }>} list
 */
export function registerGlobalShortcuts(list) {
  for (const item of list) {
    if (!globalActions.some((a) => a.code === item.code && !!a.shift === !!item.shift)) {
      globalActions.push(item);
    }
  }
}

/**
 * Registra os atalhos da tela montada.
 * `actions`: atalhos Alt + tecla (executáveis).
 * `hints`: só informativos — teclas que já funcionam dentro de um
 *   componente focado (setas numa lista etc.) e valem aparecer na ajuda.
 *   `combos` é uma lista de alternativas; cada alternativa, uma lista de
 *   teclas: [["Shift","↑"],["Shift","↓"]] => "Shift + ↑ ou Shift + ↓".
 * Retorna um token pra passar a clearScreenShortcuts().
 */
export function registerScreenShortcuts({ name, actions = [], hints = [] }) {
  const token = { name, actions, hints };
  currentScreen = token;
  return token;
}

/** Só limpa se o token ainda for o atual — evita que o unmount de uma
 * página antiga apague o registro de uma nova que já montou por cima. */
export function clearScreenShortcuts(token) {
  if (currentScreen === token) currentScreen = null;
}

export function getShortcuts() {
  return { screen: currentScreen, global: globalActions };
}

/** ["Alt", "N"] / ["Alt", "Shift", "N"] — pra exibir em <kbd>. */
export function comboParts(action) {
  const parts = ["Alt"];
  if (action.shift) parts.push("Shift");
  parts.push(keyName(action.code));
  return parts;
}

function keyName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}

function contextIsBusy() {
  return !!document.querySelector(".modal-backdrop.open, .ki-backdrop.open, .tip-seq-root");
}

function onKeydown(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.repeat || e.isComposing) return;
  // AltGr (Alt da direita): no Windows chega como Ctrl+Alt (já barrado
  // acima); no Linux/macOS aparece como modificador "AltGraph".
  if (e.getModifierState && e.getModifierState("AltGraph")) return;

  // atalhos da tela primeiro: numa colisão, a tela ganha do global
  const candidates = [...(currentScreen ? currentScreen.actions : []), ...globalActions];
  const match = candidates.find((a) => a.code === e.code && !!a.shift === e.shiftKey);
  if (!match) return;

  if (contextIsBusy()) return;
  if (match.when && !match.when()) return;

  e.preventDefault(); // também evita o Alt "acordar" o menu do navegador/webview
  e.stopPropagation();
  match.run(e);
}

/** Liga o listener global. Chamar uma vez no boot (app.js). */
export function wireShortcuts() {
  if (wired) return;
  wired = true;
  document.addEventListener("keydown", onKeydown);
}
