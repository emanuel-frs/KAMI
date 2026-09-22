/**
 * Acessibilidade por teclado dos elementos "clicáveis" que não são
 * <button> — centralizada aqui, no mesmo espírito de modal-accessibility.js
 * e modal-escape.js.
 *
 * ── O problema ───────────────────────────────────────────────────────────
 * Boa parte dos widgets e páginas monta o HTML por template e usa <span> ou
 * <div> com listener de clique: o "x" de remover, o lápis de editar, o nome
 * do item que abre a edição, abas, chips de filtro etc. O Tab não chega neles
 * e, mesmo que chegasse, Enter/Espaço não fazem nada (só <button> nativo
 * dispara "click" pelo teclado). Trocar a tag em ~60 lugares mexeria no
 * layout de cada um (os estilos foram escritos pra <span>), então aqui o
 * elemento continua como está e ganha, em runtime, o que falta:
 *   role, tabindex, nome acessível, estado (aria-pressed/selected/expanded)
 *   e ativação por Enter/Espaço.
 *
 * ── Como funciona ────────────────────────────────────────────────────────
 *  - RULES (abaixo) lista os seletores clicáveis. É uma lista explícita, de
 *    propósito: cada regra diz o papel do elemento (botão, aba, link…) e, se
 *    for o caso, de onde vem o estado. Nada de adivinhar por `cursor:pointer`
 *    (herdado, pegaria filhos que não são controles).
 *  - Um MutationObserver aplica as regras em tudo que entra no DOM — as
 *    listas são refeitas por innerHTML o tempo todo — e reaplica o estado
 *    quando a classe de um elemento muda (aba selecionada, chip ligado…).
 *  - Um único listener de keydown no document ativa o elemento com
 *    Enter/Espaço chamando .click(): o clique sobe pela árvore, então os
 *    handlers existentes (diretos ou delegados) continuam funcionando sem
 *    nenhuma mudança.
 *  - Elementos que só são "clicáveis" por terem um listener e não constam em
 *    RULES ficam de fora. Pra achar um esquecido: no console,
 *    `__kamiA11yAudit()` lista o que parece clicável e não é focável.
 *
 * ── Contêiner com controles dentro (proxy) ───────────────────────────────
 * role="button" torna os filhos "apresentacionais" pro leitor de tela — um
 * botão dentro de outro fica inacessível. Por isso um contêiner clicável que
 * tem outros controles dentro (cabeçalho de banco com lápis e "x", chip de
 * conta com a estrela) não vira controle: a regra aponta um `proxy`, um
 * filho que representa o contêiner. O Enter no proxy dispara o clique, que
 * sobe até o handler do contêiner.
 *
 * ── Foco depois que a lista é redesenhada ────────────────────────────────
 * Ao remover ou editar um item, o widget refaz o innerHTML e o elemento
 * focado some: o foco cai no <body> e quem usa teclado volta pro começo da
 * página. Guardamos uma "assinatura" do último controle focado (atributos
 * data-*, escopo e posição entre os irmãos) e, se o foco se perder logo
 * depois de um redesenho, devolvemos pro mesmo controle — ou, se ele foi
 * removido, pro que ocupou o lugar dele. Um clique de mouse cancela isso
 * (o mouse não tem foco a preservar). modal-accessibility.js também usa
 * restoreFocusFor() quando o elemento que abriu o modal já foi redesenhado.
 */

// ── nomes de linha (pra rótulos como "remover dívida — Cartão X") ────────
const NAME_SEL = [
  ".cp-nome", ".cp-role", ".cs-amount", ".cf-name", ".divida-desc", ".sub-name",
  ".renda-label", ".ce-curso", ".goal-title", ".lr-title", ".bank-name",
  ".ba-name", ".rc-name", ".org-account-info b", ".nbell-subject",
].join(", ");

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rowName(el) {
  let anc = el.parentElement;
  for (let i = 0; i < 4 && anc; i += 1, anc = anc.parentElement) {
    const found = [...anc.querySelectorAll(NAME_SEL)].find((n) => n !== el && !el.contains(n));
    if (found) return clip(clean(found.textContent));
  }
  return "";
}

const isOn = (el) => el.classList.contains("on");

/**
 * Regras.
 *  sel     seletor do elemento clicável
 *  role    papel ARIA (padrão "button")
 *  label   nome acessível: string ou (elemento) => string. Sem `label`, usa
 *          aria-label / data-tooltip do próprio elemento, ou o texto dele.
 *  ctx     true = acrescenta o nome da linha ("remover — Netflix"); função =
 *          texto de contexto próprio. Só vale pra controle sem texto (ícone).
 *  proxy   seletor de um filho que faz o papel do contêiner (ver acima)
 *  state   { attr, get(alvo, contêiner) } — atributo ARIA reaplicado quando
 *          a classe muda
 *  tablist seletor do pai que vira role="tablist" (só pra role "tab")
 */
const RULES = [
  // ícones de ação (lápis, x, sincronizar, silenciar…)
  { sel: ".icon-btn", ctx: true },
  { sel: ".ba-edit, .ba-remove, .bank-edit, .bank-remove", ctx: true },
  { sel: ".cp-remove, .cf-remove, .divida-remove, .sub-remove, .ce-remove, .cs-remove", ctx: true },
  { sel: ".ci-tag-remove", ctx: (el) => clip(clean(el.parentElement?.textContent)) },
  { sel: ".lr-edit", ctx: true },
  { sel: ".lr-delete", label: "remover link", ctx: true },
  { sel: ".lr-go", label: "abrir link no navegador", role: "link", ctx: true },
  { sel: ".link-btn", role: "link" },

  // nome do item que abre a edição ao clicar
  {
    sel: ".cp-nome, .cp-role, .cs-amount, .cf-name, .divida-desc, .sub-name, .renda-label, .ce-curso",
    label: (el) => `editar ${clip(clean(el.textContent))}`,
  },
  { sel: ".lr-title", role: "link" },

  // abas
  {
    sel: ".tab",
    role: "tab",
    tablist: ".tabs",
    state: { attr: "aria-selected", get: isOn },
  },
  {
    sel: ".modal-tab",
    role: "tab",
    tablist: ".modal-tabs",
    state: { attr: "aria-selected", get: isOn },
  },

  // filtros e seletores de opção (ligado/desligado)
  { sel: ".email-filter-opt", state: { attr: "aria-pressed", get: isOn } },
  { sel: ".pg-label", state: { attr: "aria-pressed", get: isOn } },
  { sel: ".bank-pick-item", state: { attr: "aria-pressed", get: isOn } },
  { sel: ".email-account-star", state: { attr: "aria-pressed", get: isOn } },

  // contêineres com controles dentro → proxy
  {
    sel: ".email-account-chip",
    proxy: ".email-account-chip-label",
    state: { attr: "aria-pressed", get: (t, c) => isOn(c) },
  },
  {
    sel: ".bank-head",
    proxy: ".bank-name",
    label: (t) => clip(clean(t.textContent)),
    state: { attr: "aria-expanded", get: (t, c) => !!c.closest(".bank-item")?.classList.contains("expanded") },
  },
  {
    sel: ".notif-email-summary",
    proxy: ".notif-email-summary-label",
    state: { attr: "aria-expanded", get: (t, c) => !c.parentElement?.querySelector("#notif-email-list.collapsed") },
  },
  { sel: ".nbell-item", proxy: ".nbell-main" },

  // linhas inteiras clicáveis
  { sel: ".email-item" },
  { sel: ".pw-avatar-btn" },
  // qualquer outro trecho de texto que abre um endereço externo (ex.: o
  // link "tavily.com" dentro dos modais de chave de busca)
  { sel: "[data-open-link]", role: "link" },
  {
    sel: ".search-result-item",
    role: "link",
    label: (el) => clean(el.querySelector(".search-result-title")?.textContent),
  },

  // linha de evento do Calendário: abre a edição (eventos "evento") ou leva
  // pro módulo dono do registro. Sem `label`: o texto da própria linha
  // (tipo + hora + título) já serve de nome acessível.
  { sel: ".cal-event-row" },
];

const ALL_SEL = RULES.map((r) => r.sel).join(", ");
const NATIVE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "OPTION"]);
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-kb]';

function ruleFor(el) {
  return RULES.find((r) => el.matches(r.sel)) || null;
}

// alvo (elemento que recebe foco) -> { rule, container }
const info = new WeakMap();

function syncState(target) {
  const meta = info.get(target);
  if (!meta?.rule.state) return;
  const { attr, get } = meta.rule.state;
  target.setAttribute(attr, String(!!get(target, meta.container)));
  if (meta.rule.role === "tab") {
    // tabindex "móvel" (roving): só a aba selecionada entra na ordem de Tab;
    // as outras são alcançadas pelas setas (ver onKeydown).
    target.tabIndex = target.getAttribute("aria-selected") === "true" ? 0 : -1;
  }
}

function applyName(target, rule) {
  if (target.hasAttribute("aria-labelledby")) return;
  const text = clean(target.textContent);
  const fromRule = typeof rule.label === "function" ? rule.label(target) : rule.label;
  let base =
    fromRule ||
    target.getAttribute("aria-label") ||
    (!text ? target.getAttribute("data-tooltip") || target.getAttribute("title") : "");
  if (!base) return; // o nome acessível já vem do texto do elemento
  if (rule.ctx && !text) {
    const ctx = typeof rule.ctx === "function" ? rule.ctx(target) : rowName(target);
    if (ctx && !base.includes(ctx)) base = `${base} — ${ctx}`;
  }
  target.setAttribute("aria-label", base);
}

function enhance(el, rule) {
  if (NATIVE_TAGS.has(el.tagName)) return; // <button> nativo já é focável
  if (el.hasAttribute("data-kb-ignore") || el.closest("[data-kb-ignore]")) return;

  const target = rule.proxy ? el.querySelector(rule.proxy) : el;
  if (!target || target.hasAttribute("data-kb")) return;
  // já focável por outro caminho (ex.: aprendizado.js usa makeFocusable)
  if (target.matches('[tabindex]:not([tabindex="-1"])')) return;
  // contêiner com controles dentro e sem proxy: não vira controle (ver topo)
  if (!rule.proxy && el.querySelector(INTERACTIVE)) {
    console.warn("[a11y] elemento clicável com controles dentro e sem `proxy` em RULES:", el);
    return;
  }

  target.setAttribute("data-kb", "1");
  target.setAttribute("role", rule.role || "button");
  if (rule.role !== "tab") target.tabIndex = 0;
  info.set(target, { rule, container: el });
  if (rule.state) target.setAttribute("data-kb-state", "1");
  applyName(target, rule);
  syncState(target);

  if (rule.tablist) {
    const list = el.closest(rule.tablist);
    if (list && !list.hasAttribute("role")) list.setAttribute("role", "tablist");
  }
  if (rule.role === "tab" && el.dataset.tab) {
    const panel = document.getElementById(`org-panel-${el.dataset.tab}`);
    if (panel) target.setAttribute("aria-controls", panel.id);
  }
}

function enhanceTree(root) {
  if (root.nodeType !== 1) return;
  const list = [];
  if (root.matches(ALL_SEL)) list.push(root);
  root.querySelectorAll(ALL_SEL).forEach((n) => list.push(n));
  list.forEach((n) => {
    const rule = ruleFor(n);
    if (rule) enhance(n, rule);
  });
}

// ── teclado ──────────────────────────────────────────────────────────────

function onKeydown(e) {
  const t = e.target;
  pointerActive = false; // a última entrada foi de teclado
  if (e.defaultPrevented) return; // outro handler (ex.: modo teclado do grid) já tratou a tecla
  if (!(t instanceof Element) || !t.hasAttribute("data-kb")) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
  const role = t.getAttribute("role");

  if (role === "tab" && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    const tabs = [...(t.parentElement?.querySelectorAll('[role="tab"][data-kb]') || [])];
    const i = tabs.indexOf(t);
    if (i === -1) return;
    let next = null;
    if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
    else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else next = tabs[tabs.length - 1];
    if (next && next !== t) {
      e.preventDefault();
      next.click(); // seleciona (o handler troca o painel e a classe "on")…
      next.tabIndex = 0;
      next.focus(); // …e leva o foco junto
    }
    return;
  }

  const isEnter = e.key === "Enter";
  const isSpace = e.key === " " || e.key === "Spacebar";
  if (!isEnter && !(isSpace && role !== "link")) return; // link só ativa com Enter
  if (e.shiftKey) return;
  e.preventDefault(); // Espaço não rola a página
  markActivation(t);
  t.click();
}

// ── foco perdido depois de um redesenho ──────────────────────────────────

const FRESH_MS = 3000;
let last = null; // { sig, ts }
// true entre um pointerdown e a próxima tecla. Clicar com o mouse num
// controle também o foca (tabindex=0), mas isso não é foco "de teclado" pra
// preservar — só a assinatura é guardada (pro modal), sem armar a restauração.
let pointerActive = false;
const focusInfo = new WeakMap(); // alvo (mesmo desconectado) -> assinatura

const esc = (v) => (window.CSS?.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&"));

function baseOf(target) {
  return info.get(target)?.container || target;
}

function signature(target) {
  const base = baseOf(target);
  const parts = [];
  for (const a of base.attributes) {
    if (!a.name.startsWith("data-") || a.name === "data-tooltip" || a.name.startsWith("data-kb")) continue;
    parts.push(`[${a.name}="${esc(a.value)}"]`);
  }
  const cls = [...base.classList].find((c) => c !== "on") || "";
  const scope = base.closest("[id]");
  const scopeId = scope && scope !== base ? scope.id : "";
  const pool = (scopeId ? document.getElementById(scopeId) : document).querySelectorAll(
    cls ? `.${esc(cls)}[data-kb], .${esc(cls)} [data-kb]` : "[data-kb]"
  );
  return {
    selector: parts.join("") ? `${base.tagName.toLowerCase()}${parts.join("")}` : "",
    cls,
    scopeId,
    index: Math.max(0, [...pool].indexOf(target)),
  };
}

function pickTarget(base) {
  return base.matches("[data-kb]") ? base : base.querySelector("[data-kb]");
}

function findReplacement(sig) {
  const scope = sig.scopeId ? document.getElementById(sig.scopeId) : document;
  if (!scope) return null;
  if (sig.selector) {
    const base = scope.querySelector(sig.selector);
    const t = base && pickTarget(base);
    if (t) return t;
  }
  if (sig.cls) {
    const same = [...scope.querySelectorAll(`.${esc(sig.cls)}[data-kb], .${esc(sig.cls)} [data-kb]`)];
    if (same.length) return same[Math.min(sig.index, same.length - 1)];
  }
  return null;
}

function markActivation(target) {
  const sig = focusInfo.get(target) || signature(target);
  focusInfo.set(target, sig);
  last = { sig, ts: Date.now() };
}

function onFocusIn(e) {
  const t = e.target;
  if (!(t instanceof Element) || !t.hasAttribute("data-kb")) return;
  const sig = signature(t);
  focusInfo.set(t, sig);
  if (!pointerActive) last = { sig, ts: Date.now() };
}

function modalIsOpen() {
  return !!document.querySelector(".modal-backdrop.open, .ki-backdrop.open, .tip-seq-root");
}

function focusLost() {
  const a = document.activeElement;
  return !a || a === document.body || !a.isConnected;
}

function maybeRestore() {
  if (!last || Date.now() - last.ts > FRESH_MS) return;
  if (!focusLost() || modalIsOpen()) return;
  const target = findReplacement(last.sig);
  last = null;
  target?.focus({ preventScroll: true });
}

/**
 * Devolve o foco pro controle que substituiu `oldEl` (já removido do DOM).
 * Usado por modal-accessibility.js: o elemento que abriu o modal pode ter
 * sido redesenhado enquanto o modal estava aberto.
 * @returns {boolean} true se achou algo pra focar
 */
export function restoreFocusFor(oldEl) {
  const sig = focusInfo.get(oldEl);
  if (!sig) return false;
  const target = findReplacement(sig);
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

// ── observer ─────────────────────────────────────────────────────────────

let wired = false;

function onMutations(mutations) {
  let added = false;
  for (const m of mutations) {
    if (m.type === "childList") {
      m.addedNodes.forEach((n) => enhanceTree(n));
      if (m.addedNodes.length || m.removedNodes.length) added = true;
    } else if (m.type === "attributes" && m.target instanceof Element) {
      const el = m.target;
      if (info.has(el)) syncState(el);
      if (el.querySelector) el.querySelectorAll("[data-kb-state]").forEach(syncState);
      if (el.hasAttribute("data-kb-state")) syncState(el);
    }
  }
  if (added && last) requestAnimationFrame(maybeRestore);
}

/**
 * Lista o que parece clicável mas não é focável — pra achar quem faltou em
 * RULES. Uso: `__kamiA11yAudit()` no console (DevTools do Tauri: botão
 * direito → inspecionar).
 */
export function auditClickables() {
  const found = [];
  document.querySelectorAll("body *").forEach((el) => {
    // <label> ligado a um input é clicável de forma nativa (e o input é focável)
    if (NATIVE_TAGS.has(el.tagName) || el.closest(`${INTERACTIVE}, label`)) return;
    // já tem role (deste módulo ou de código próprio, ex.: o roving
    // tabindex da grade do Calendário em pages/calendario.js) — mesmo com
    // tabindex="-1" no momento (só um item do grupo é focável por vez).
    if (el.hasAttribute("role")) return;
    // .csel-list: dropdown do custom-select.js, que tem navegação por teclado própria
    if (el.closest(".tooltip-portal, .sr-only, .csel-list, [data-kb-ignore]")) return;
    // contêiner cujos controles já são focáveis (proxy ou filhos com data-kb)
    if (el.querySelector("[data-kb]")) return;
    const cs = getComputedStyle(el);
    if (cs.cursor !== "pointer" || cs.display === "none" || cs.visibility === "hidden") return;
    // cursor é herdado: só interessa o mais externo de cada região "clicável"
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") return;
    found.push(el);
  });
  console.table(found.map((el) => ({ tag: el.tagName.toLowerCase(), classe: el.className, texto: clip(clean(el.textContent), 40) })));
  return found;
}

/** Chamar uma vez no boot (app.js, ao lado de wireModalAccessibility). */
export function wireClickableA11y() {
  if (wired) return;
  wired = true;
  enhanceTree(document.body);
  new MutationObserver(onMutations).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("pointerdown", () => {
    pointerActive = true;
    last = null; // o mouse assumiu: não há foco de teclado pra preservar
  }, true);
  window.__kamiA11yAudit = auditClickables;
}
