/**
 * Dropdown customizado no estilo do app, no lugar do <select> nativo do
 * SO (que não dá pra estilizar de verdade — a lista aberta é sempre
 * renderizada fora do controle do CSS).
 *
 * Estratégia: o <select> original CONTINUA no DOM, com o mesmo id,
 * mesmas <option>, mesmo .value — só fica escondido visualmente. Ele
 * segue sendo a fonte da verdade. Isso significa que TODO o código
 * existente que já lê `wrap.querySelector("#xx").value` ou escuta
 * `addEventListener("change", ...)` continua funcionando sem alteração
 * nenhuma — só a aparência muda. Ao lado dele é inserido um "trigger"
 * (botão); a LISTA de opções, porém, é anexada direto em <body>
 * ("portal") e posicionada via getBoundingClientRect() do trigger —
 * ver `positionList()`. Isso é necessário porque qualquer ancestral
 * com overflow:auto/hidden (ex: a lista rolável de um widget/card)
 * corta um filho position:absolute, não importa o z-index — só
 * escapar pra fora da árvore do card resolve isso de vez.
 *
 * O CSS do componente é injetado por este próprio arquivo (ensureStyles)
 * em vez de depender de um .css separado estar no lugar certo do
 * pipeline de build — funciona sozinho, onde quer que o .js esteja.
 *
 * Uso:
 *   enhanceSelect(wrap.querySelector("#tm-conta"));
 *
 *   // depois de repopular as <option> dinamicamente:
 *   refreshCustomSelect(wrap.querySelector("#tm-conta"));
 *
 *   // modo "tag" — trigger sem caixa/borda por padrão, parece texto
 *   // simples; só ganha aparência de campo de seleção quando aberto
 *   // (ver .divida-status em dividas.js):
 *   enhanceSelect(select, { compact: true });
 *
 * refreshCustomSelect reaproveita as opções passadas anteriormente se
 * nenhuma for passada de novo — então dá pra chamar só ele sempre,
 * tanto na primeira montagem quanto depois.
 */

const REGISTRY = new WeakMap(); // select -> { wrap, trigger, list, compact }

let globalListenersReady = false;
let stylesInjected = false;

const STYLE_ID = "csel-injected-styles";
const CSS = `
.csel-native { display: none !important; }

.csel { position: relative; width: 100%; box-sizing: border-box; font-family: var(--font); }

.csel-trigger {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--font);
  font-size: 12px;
  padding: 6px 8px;
  line-height: 1.4;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csel-trigger:hover { border-color: var(--accent-dim); color: var(--text-bright); }
.csel-trigger:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }

.csel-trigger::after {
  content: "";
  flex: 0 0 auto;
  width: 0;
  height: 0;
  margin-left: 8px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--text-faint);
  transition: transform .12s ease;
}
.csel.open .csel-trigger::after { transform: rotate(180deg); border-top-color: var(--accent); }
.csel.open .csel-trigger { border-color: var(--accent); color: var(--text-bright); }
.csel.disabled .csel-trigger { opacity: 0.4; cursor: default; }

/* ── modo compact/tag — usado em selects embutidos numa linha de lista
   (ex: status da dívida). Por padrão parece só um texto/tag, sem caixa
   nem borda; vira uma "caixa de input" só quando aberto/focado, pra
   não pesar visualmente numa lista com várias linhas. ── */
.csel.compact { width: auto; flex: 0 0 auto; }
.csel.compact .csel-trigger {
  width: auto;
  background: transparent;
  border-color: transparent;
  padding: 2px 4px;
  font-size: 10.5px;
  color: var(--text-dim);
}
.csel.compact .csel-trigger:hover {
  border-color: var(--border-soft);
  background: var(--bg);
}
.csel.compact.open .csel-trigger {
  background: var(--bg);
  border-color: var(--accent);
  color: var(--text-bright);
}

/* ── lista (portal em <body>, position:fixed — ver positionList() em JS) ── */
.csel-list {
  position: fixed;
  max-height: 220px;
  overflow-y: auto;
  background: var(--panel, #0a0a0a);
  border: 1px solid var(--border);
  box-shadow: 4px 4px 0 0 #000;
  z-index: 500;
  display: none;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: var(--accent-dim) var(--panel, #0a0a0a);
}
.csel-list::-webkit-scrollbar { width: 7px; }
.csel-list::-webkit-scrollbar-track { background: var(--panel, #0a0a0a); }
.csel-list::-webkit-scrollbar-thumb { background: var(--accent-dim); }
.csel-list::-webkit-scrollbar-thumb:hover { background: var(--accent); }
.csel-list.open { display: block; }

.csel-item {
  padding: 7px 9px;
  font-size: 11.5px;
  color: var(--text-dim);
  cursor: pointer;
  border-bottom: 1px dashed var(--border-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csel-item:last-child { border-bottom: none; }
.csel-item:hover { background: rgba(255, 255, 255, 0.06); color: var(--text-bright); }
.csel-item.on { color: var(--accent); }
.csel-item.disabled { opacity: 0.4; cursor: default; }
`;

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function closeUi(ui) {
  ui.wrap.classList.remove("open");
  ui.list.classList.remove("open");
}

function closeAllExcept(exceptUi) {
  document.querySelectorAll(".csel.open").forEach((wrap) => {
    const list = wrap.__cselList;
    if (wrap !== exceptUi?.wrap) {
      wrap.classList.remove("open");
      list?.classList.remove("open");
    }
  });
}

function ensureGlobalListeners() {
  if (globalListenersReady) return;
  globalListenersReady = true;

  document.addEventListener("click", (e) => {
    document.querySelectorAll(".csel.open").forEach((wrap) => {
      const list = wrap.__cselList;
      const clickedTrigger = wrap.contains(e.target);
      const clickedList = list?.contains(e.target);
      if (!clickedTrigger && !clickedList) {
        wrap.classList.remove("open");
        list?.classList.remove("open");
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".csel.open").forEach((wrap) => {
      wrap.classList.remove("open");
      wrap.__cselList?.classList.remove("open");
    });
  });

  // a lista é position:fixed calculada no momento da abertura — em vez
  // de recalcular a posição a cada pixel de scroll (custoso e ainda
  // assim aproximado), fecha o dropdown se algo por trás rolar. mesmo
  // padrão que um <select> nativo tem no comportamento com scroll.
  document.addEventListener("scroll", (e) => {
    document.querySelectorAll(".csel.open").forEach((wrap) => {
      const list = wrap.__cselList;
      if (!wrap.contains(e.target) && !list?.contains(e.target)) {
        wrap.classList.remove("open");
        list?.classList.remove("open");
      }
    });
  }, true);

  window.addEventListener("resize", () => {
    document.querySelectorAll(".csel.open").forEach((wrap) => {
      wrap.classList.remove("open");
      wrap.__cselList?.classList.remove("open");
    });
  });
}

function optionsOf(select) {
  return Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent, disabled: o.disabled }));
}

/** calcula e aplica a posição fixed da lista com base no trigger, com
 *  fallback pra abrir pra cima quando não cabe embaixo. */
function positionList(trigger, list) {
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const minWidth = Math.max(rect.width, 140);

  list.style.width = "";
  list.style.minWidth = minWidth + "px";

  let left = rect.left;
  if (left + minWidth > vw - 8) left = Math.max(8, vw - 8 - minWidth);

  const spaceBelow = vh - rect.bottom;
  const estimatedHeight = Math.min(220, list.scrollHeight || 220);
  const openUp = spaceBelow < estimatedHeight + 8 && rect.top > spaceBelow;

  if (openUp) {
    list.style.top = "";
    list.style.bottom = (vh - rect.top + 4) + "px";
    list.style.maxHeight = Math.max(120, rect.top - 12) + "px";
  } else {
    list.style.bottom = "";
    list.style.top = (rect.bottom + 4) + "px";
    list.style.maxHeight = Math.max(120, vh - rect.bottom - 12) + "px";
  }
  list.style.left = left + "px";
}

function buildUI(select, opts) {
  ensureStyles();
  ensureGlobalListeners();

  const compact = !!opts.compact;

  const wrap = document.createElement("div");
  wrap.className = ["csel", compact ? "compact" : "", ...select.className.split(/\s+/).filter(Boolean)].join(" ").trim();

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "csel-trigger";

  const list = document.createElement("div");
  list.className = "csel-list";
  list.setAttribute("role", "listbox");

  wrap.appendChild(trigger);
  select.insertAdjacentElement("afterend", wrap);
  select.classList.add("csel-native");
  document.body.appendChild(list);
  wrap.__cselList = list; // referência cruzada pros listeners globais (click-outside etc.)

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (select.disabled) return;
    const willOpen = !wrap.classList.contains("open");
    closeAllExcept(willOpen ? { wrap } : null);
    if (willOpen) {
      positionList(trigger, list);
      wrap.classList.add("open");
      list.classList.add("open");
    } else {
      wrap.classList.remove("open");
      list.classList.remove("open");
    }
  });

  const entry = { wrap, trigger, list, compact };
  REGISTRY.set(select, entry);
  return entry;
}

function render(select, opts) {
  const ui = REGISTRY.get(select) || buildUI(select, opts || {});
  const optsList = optionsOf(select);
  const current = optsList.find((o) => o.value === select.value) || optsList[0];

  ui.trigger.textContent = current ? current.label : "";
  ui.trigger.disabled = select.disabled;
  ui.wrap.classList.toggle("disabled", select.disabled);

  ui.list.innerHTML = "";
  optsList.forEach((o) => {
    const item = document.createElement("div");
    item.className = "csel-item" + (o.value === select.value ? " on" : "") + (o.disabled ? " disabled" : "");
    item.setAttribute("role", "option");
    item.textContent = o.label;
    if (!o.disabled) {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (select.value !== o.value) {
          select.value = o.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeUi(ui);
        render(select, opts);
      });
    }
    ui.list.appendChild(item);
  });

  if (ui.wrap.classList.contains("open")) positionList(ui.trigger, ui.list);
}

/**
 * Monta (ou remonta, se as <option> mudaram) o dropdown customizado.
 * @param {{ compact?: boolean }} [opts] — compact: trigger sem caixa/
 *   borda por padrão (parece texto simples), só ganha aparência de
 *   campo de seleção quando aberto. Bom pra selects embutidos numa
 *   linha de lista (ex: status por item).
 */
export function enhanceSelect(select, opts = {}) {
  if (!select) return;
  render(select, opts);
}

/** Alias semântico pra usar depois de repopular <option> ou trocar .value via JS. */
export function refreshCustomSelect(select, opts = {}) {
  enhanceSelect(select, opts);
}

/** Remove o dropdown customizado e a lista em portal (ex: ao destruir uma linha da lista). */
export function destroyCustomSelect(select) {
  const ui = REGISTRY.get(select);
  if (!ui) return;
  ui.list.remove();
  ui.wrap.remove();
  REGISTRY.delete(select);
}