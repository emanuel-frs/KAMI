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
 *
 * Acessibilidade: como o <select> nativo fica com display:none, ele sai
 * da árvore de acessibilidade — um leitor de tela não vê "select" nenhum
 * ali, só um <div> e um <button> soltos. Pra não quebrar o uso por
 * teclado/leitor de tela, o trigger e a lista implementam o padrão ARIA
 * de "combobox" (variante somente-leitura, sem digitação — ver
 * https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/):
 * o <button> vira role="combobox" com aria-expanded/aria-controls/
 * aria-activedescendant, e a lista vira role="listbox" com role="option"
 * em cada item. O foco NUNCA sai do botão (nem quando a lista abre) —
 * é assim que o padrão evita ter que gerenciar foco entrando/saindo de
 * dentro da listbox; a navegação por seta só move um destaque visual
 * ("active") e atualiza aria-activedescendant, quem está com o foco de
 * verdade sempre é o trigger.
 *
 * Outro detalhe: os <label for="..."> deste projeto apontam pro id do
 * <select> original. Com o select escondido, esse vínculo não ajuda em
 * nada o novo <button> (que é o que realmente recebe foco). Por isso
 * buildUI() localiza esse <label> (se existir) e liga o trigger nele via
 * aria-labelledby — sem isso o combobox fica sem nome acessível.
 */

const REGISTRY = new WeakMap(); // select -> { wrap, trigger, list, compact, itemEls, activeIndex }

let globalListenersReady = false;
let stylesInjected = false;
let uidSeq = 0;

/** ids únicos pra ligar aria-controls/aria-activedescendant sem colidir
 *  entre várias instâncias de combobox na mesma página. */
function nextUid(prefix) {
  return `${prefix}-${++uidSeq}`;
}

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
.csel-trigger:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

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

/* ── destaque de navegação por teclado (aria-activedescendant) — o foco
   de verdade nunca sai do trigger, então isso é só o indicador visual
   de "qual item seria escolhido com Enter agora". Mesma aparência do
   :hover pra não introduzir um terceiro estilo, só a origem é diferente
   (seta do teclado, não o mouse). ── */
.csel-item.active { background: rgba(255, 255, 255, 0.06); color: var(--text-bright); }
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

/** Fecha um combobox e sincroniza o lado ARIA (aria-expanded, destaque
 *  de teclado). Ponto único de fechamento — todo mundo que fecha uma
 *  instância (clique no item, clique fora, Escape, scroll, resize, abrir
 *  outro combobox) passa por aqui, senão o aria-expanded fica dessincronizado
 *  do estado visual em algum desses caminhos. */
function closeUi(ui) {
  ui.wrap.classList.remove("open");
  ui.list.classList.remove("open");
  ui.trigger.setAttribute("aria-expanded", "false");
  ui.itemEls?.forEach((el) => el.classList.remove("active"));
}

/** Fallback pra fechar um wrap "cru" (sem entry no REGISTRY) — não deveria
 *  acontecer no fluxo normal, mas os listeners globais varrem `.csel.open`
 *  no DOM, então mantém isso como rede de segurança. */
function closeWrapEl(wrap) {
  const ui = wrap.__cselUi;
  if (ui) closeUi(ui);
  else {
    wrap.classList.remove("open");
    wrap.__cselList?.classList.remove("open");
  }
}

function closeAllExcept(exceptUi) {
  document.querySelectorAll(".csel.open").forEach((wrap) => {
    if (wrap !== exceptUi?.wrap) closeWrapEl(wrap);
  });
}

/** Abre a lista e inicializa o destaque de teclado na opção selecionada
 *  (ou na primeira habilitada, se nada estiver selecionado ainda). */
function openUi(ui) {
  closeAllExcept(ui);
  positionList(ui.trigger, ui.list);
  ui.wrap.classList.add("open");
  ui.list.classList.add("open");
  ui.trigger.setAttribute("aria-expanded", "true");
  const selectedIndex = ui.itemEls.findIndex((el) => el.classList.contains("on"));
  highlightIndex(ui, selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(ui.itemEls));
}

/** Move o destaque de teclado (aria-activedescendant) pro índice dado,
 *  sem trocar o valor selecionado — isso só acontece em commitActive(). */
function highlightIndex(ui, index) {
  const items = ui.itemEls;
  if (!items || index < 0 || index >= items.length) return;
  items.forEach((el, i) => el.classList.toggle("active", i === index));
  ui.activeIndex = index;
  ui.trigger.setAttribute("aria-activedescendant", items[index].id);
  items[index].scrollIntoView({ block: "nearest" });
}

function firstEnabledIndex(items) {
  return items.findIndex((el) => !el.classList.contains("disabled"));
}

function lastEnabledIndex(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].classList.contains("disabled")) return i;
  }
  return -1;
}

/** ArrowUp/ArrowDown: anda pro próximo item habilitado na direção `dir`
 *  (1 ou -1). Não dá a volta (Home/End cobrem os extremos) — mesmo
 *  comportamento que o <select> nativo tem com as setas. */
function stepActive(ui, dir) {
  const items = ui.itemEls;
  if (!items.length) return;
  let i = ui.activeIndex;
  do {
    i += dir;
  } while (i >= 0 && i < items.length && items[i].classList.contains("disabled"));
  if (i < 0 || i >= items.length) return;
  highlightIndex(ui, i);
}

/** Efetiva a opção destacada (Enter, ou clique no item) como o novo
 *  valor do <select> nativo — mesmo caminho de dados que o clique já
 *  usava (select.value + evento "change"), só reaproveitado aqui. */
function commitActive(ui, select, opts) {
  const item = ui.itemEls[ui.activeIndex];
  if (!item || item.classList.contains("disabled")) return;
  const value = item.dataset.value;
  if (select.value !== value) {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeUi(ui);
  render(select, opts);
}

/** Navegação por teclado no trigger. O <button> nativo já dispara "click"
 *  sozinho em Enter/Espaço — deixamos isso abrir a lista quando fechada
 *  (mesmo handler do clique do mouse) e só interceptamos aqui pra
 *  COMMITAR a opção destacada quando a lista já está aberta. */
function onTriggerKeydown(e, ui, select, opts) {
  if (select.disabled) return;
  const isOpen = ui.wrap.classList.contains("open");

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      if (!isOpen) openUi(ui);
      else stepActive(ui, 1);
      break;
    case "ArrowUp":
      e.preventDefault();
      if (!isOpen) openUi(ui);
      else stepActive(ui, -1);
      break;
    case "Home":
      if (isOpen) {
        e.preventDefault();
        highlightIndex(ui, firstEnabledIndex(ui.itemEls));
      }
      break;
    case "End":
      if (isOpen) {
        e.preventDefault();
        highlightIndex(ui, lastEnabledIndex(ui.itemEls));
      }
      break;
    case "Enter":
    case " ":
    case "Spacebar":
      if (isOpen) {
        e.preventDefault();
        commitActive(ui, select, opts);
      }
      break;
    case "Escape":
      // Fecha localmente (em vez de confiar só no listener global) e
      // para a propagação — assim um Esc só fecha a lista, sem também
      // fechar o modal por trás numa tacada só.
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeUi(ui);
      }
      break;
    default:
      break;
  }
}

function ensureGlobalListeners() {
  if (globalListenersReady) return;
  globalListenersReady = true;

  document.addEventListener("click", (e) => {
    document.querySelectorAll(".csel.open").forEach((wrap) => {
      const list = wrap.__cselList;
      const clickedTrigger = wrap.contains(e.target);
      const clickedList = list?.contains(e.target);
      if (!clickedTrigger && !clickedList) closeWrapEl(wrap);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".csel.open").forEach((wrap) => closeWrapEl(wrap));
  });

  // a lista é position:fixed calculada no momento da abertura — em vez
  // de recalcular a posição a cada pixel de scroll (custoso e ainda
  // assim aproximado), fecha o dropdown se algo por trás rolar. mesmo
  // padrão que um <select> nativo tem no comportamento com scroll.
  document.addEventListener("scroll", (e) => {
    document.querySelectorAll(".csel.open").forEach((wrap) => {
      const list = wrap.__cselList;
      if (!wrap.contains(e.target) && !list?.contains(e.target)) closeWrapEl(wrap);
    });
  }, true);

  window.addEventListener("resize", () => {
    document.querySelectorAll(".csel.open").forEach((wrap) => closeWrapEl(wrap));
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

/** Acha o <label for="select.id"> (se existir) e garante que ele tenha
 *  um id, pra dar pro trigger via aria-labelledby — o for="" original
 *  aponta pro <select> que agora é invisível/inalcançável por foco, então
 *  sem isso o combobox fica sem nome acessível nenhum. */
function labelIdFor(select) {
  if (!select.id) return null;
  const label = document.querySelector(`label[for="${select.id}"]`);
  if (!label) return null;
  if (!label.id) label.id = nextUid("csel-label");
  return label.id;
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
  // padrão ARIA "select-only combobox" — ver nota no topo do arquivo.
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const list = document.createElement("div");
  list.className = "csel-list";
  list.setAttribute("role", "listbox");
  list.id = nextUid("csel-list");
  trigger.setAttribute("aria-controls", list.id);

  const labelId = labelIdFor(select);
  if (labelId) trigger.setAttribute("aria-labelledby", labelId);

  wrap.appendChild(trigger);
  select.insertAdjacentElement("afterend", wrap);
  select.classList.add("csel-native");
  document.body.appendChild(list);

  const entry = { wrap, trigger, list, compact, itemEls: [], activeIndex: -1 };
  wrap.__cselList = list; // referência cruzada pros listeners globais (click-outside etc.)
  wrap.__cselUi = entry; // idem, mas pro fechamento "oficial" (closeUi) que sincroniza aria-expanded

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (select.disabled) return;
    if (wrap.classList.contains("open")) closeUi(entry);
    else openUi(entry);
  });

  trigger.addEventListener("keydown", (e) => onTriggerKeydown(e, entry, select, opts));

  REGISTRY.set(select, entry);
  return entry;
}

function render(select, opts) {
  const ui = REGISTRY.get(select) || buildUI(select, opts || {});
  const optsList = optionsOf(select);
  const current = optsList.find((o) => o.value === select.value) || optsList[0];

  ui.trigger.textContent = current ? current.label : "";
  if (current && current.label) ui.trigger.setAttribute("data-tooltip", current.label);
  else ui.trigger.removeAttribute("data-tooltip");
  ui.trigger.disabled = select.disabled;
  ui.wrap.classList.toggle("disabled", select.disabled);

  ui.list.innerHTML = "";
  ui.itemEls = [];
  optsList.forEach((o, i) => {
    const item = document.createElement("div");
    const selected = o.value === select.value;
    item.className = "csel-item" + (selected ? " on" : "") + (o.disabled ? " disabled" : "");
    item.id = nextUid("csel-opt");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", selected ? "true" : "false");
    if (o.disabled) item.setAttribute("aria-disabled", "true");
    item.dataset.value = o.value;
    item.textContent = o.label;
    if (o.label) item.setAttribute("data-tooltip", o.label);
    if (!o.disabled) {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        ui.activeIndex = i;
        commitActive(ui, select, opts);
      });
      // hover do mouse também move o destaque de teclado, pra manter os
      // dois "cursores" (mouse e teclado) sempre em sincronia — assim
      // um Enter logo depois de passar o mouse comita o item certo.
      item.addEventListener("mouseenter", () => highlightIndex(ui, i));
    }
    ui.list.appendChild(item);
    ui.itemEls.push(item);
  });

  // aria-activedescendant reflete o valor atual mesmo com a lista fechada
  // — é o que o leitor de tela anuncia como valor do combobox. Só troca
  // de fato o destaque visual ("active") se a lista já estiver aberta.
  const selectedIndex = ui.itemEls.findIndex((el) => el.classList.contains("on"));
  const fallbackIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(ui.itemEls);
  if (fallbackIndex >= 0) {
    ui.activeIndex = fallbackIndex;
    ui.trigger.setAttribute("aria-activedescendant", ui.itemEls[fallbackIndex].id);
    if (ui.wrap.classList.contains("open")) {
      ui.itemEls.forEach((el, i) => el.classList.toggle("active", i === fallbackIndex));
    }
  } else {
    ui.trigger.removeAttribute("aria-activedescendant");
  }

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