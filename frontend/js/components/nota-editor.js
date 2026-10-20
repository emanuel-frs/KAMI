import { icon } from "./icons.js";
import { markdownParaDom, domParaMarkdown, urlSegura } from "./nota-markdown.js";
import { showPromptModal } from "../modals/prompt-modal.js";
import { openExternal } from "./open-external.js";

/**
 * components/nota-editor.js — editor de notas "estilo Teams" (ORG-01, P-49).
 *
 * WYSIWYG em cima de um contenteditable: a pessoa vê a formatação
 * enquanto escreve; por baixo, o que sai daqui é MARKDOWN
 * (nota-markdown.js) — nunca o HTML do contenteditable.
 *
 *   - barra fixa em cima + mini barra (bolha) ao selecionar texto;
 *   - negrito, itálico, sublinhado, tachado, títulos 1-3, lista com
 *     marcador/numerada, checklist (clique na caixinha marca), citação,
 *     código (linha e bloco), link, divisória, tabela simples, limpar;
 *   - atalhos: Ctrl+B/I/U, Ctrl+Shift+X (tachado), Ctrl+E (código),
 *     Ctrl+K (link), Ctrl+Shift+7/8/9 (numerada/marcador/checklist),
 *     Ctrl+Alt+1/2/3 (títulos), Tab/Shift+Tab (nível da lista);
 *   - markdown ao digitar, no começo da linha: "- " / "* ", "1. ", "[] ",
 *     "# " / "## " / "### ", "> ", "```" e "---" + Enter;
 *   - colar: HTML de fora passa pelo markdown antes de entrar (sai tudo
 *     que não for formatação conhecida: estilo, imagem, script); texto
 *     com cara de markdown vira formatação.
 *
 * Os comandos usam document.execCommand: está "obsoleto" no papel, mas é
 * o único jeito de formatar um contenteditable mantendo o desfazer
 * (Ctrl+Z) nativo, e funciona igual no WebKitGTK (Linux) e no WebView2
 * (Windows) — os dois motores do app.
 *
 * Uso:
 *   const ed = criarEditorNota(el, { markdown, onChange, placeholder });
 *   ed.getMarkdown(); ed.setMarkdown(md); ed.focus(); ed.destroy();
 */

const BOTOES = [
  { id: "negrito", rotulo: "B", dica: "negrito (Ctrl+B)", classe: "b" },
  { id: "italico", rotulo: "I", dica: "itálico (Ctrl+I)", classe: "i" },
  { id: "sublinhado", rotulo: "U", dica: "sublinhado (Ctrl+U)", classe: "u" },
  { id: "tachado", rotulo: "S", dica: "tachado (Ctrl+Shift+X)", classe: "s" },
  "|",
  { id: "h1", rotulo: "H1", dica: "título (Ctrl+Alt+1)" },
  { id: "h2", rotulo: "H2", dica: "subtítulo (Ctrl+Alt+2)" },
  { id: "h3", rotulo: "H3", dica: "título menor (Ctrl+Alt+3)" },
  "|",
  { id: "marcador", rotulo: "•", dica: "lista com marcador (Ctrl+Shift+8)" },
  { id: "numerada", rotulo: "1.", dica: "lista numerada (Ctrl+Shift+7)" },
  { id: "checklist", rotulo: "[x]", dica: "checklist (Ctrl+Shift+9)" },
  "|",
  { id: "citacao", rotulo: "❝", dica: "citação" },
  { id: "codigo", rotulo: "<>", dica: "código na linha (Ctrl+E)" },
  { id: "bloco", rotulo: "{ }", dica: "bloco de código" },
  "|",
  { id: "link", icone: "link", dica: "link (Ctrl+K)" },
  { id: "divisoria", rotulo: "──", dica: "divisória" },
  { id: "tabela", rotulo: "▦", dica: "tabela" },
  { id: "limpar", rotulo: "Tx", dica: "limpar formatação", classe: "limpar" },
];
const BOLHA = ["negrito", "italico", "sublinhado", "tachado", "codigo", "link"];

function botaoHtml(b) {
  if (b === "|") return '<span class="ne-sep" aria-hidden="true"></span>';
  const conteudo = b.icone ? icon(b.icone, { size: 12 }) : b.rotulo;
  return `<button type="button" class="ne-btn${b.classe ? ` ne-${b.classe}` : ""}" data-ne="${b.id}" data-tooltip="${b.dica}" aria-label="${b.dica}" tabindex="-1">${conteudo}</button>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Fragmento (nosso, montado com createElement) -> HTML pro insertHTML. */
function fragParaHtml(frag) {
  const box = document.createElement("div");
  box.append(frag);
  return box.innerHTML;
}

const PARECE_MARKDOWN = /(^|\n)\s*(#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s?|```|\|.*\|)|\*\*\S|~~\S|\[[^\]]+\]\(https?:/;

export function criarEditorNota(container, { markdown = "", onChange = () => {}, placeholder = "escreva aqui…" } = {}) {
  container.classList.add("ne");
  container.innerHTML = `
    <div class="ne-barra" role="toolbar" aria-label="formatação">${BOTOES.map(botaoHtml).join("")}</div>
    <div class="ne-area" contenteditable="true" role="textbox" aria-multiline="true" aria-label="texto da nota" spellcheck="true" data-placeholder="${escapeHtml(placeholder)}"></div>
    <div class="ne-bolha" role="toolbar" aria-label="formatar seleção" hidden>${BOTOES.filter((b) => b !== "|" && BOLHA.includes(b.id)).map(botaoHtml).join("")}</div>
  `;
  const area = container.querySelector(".ne-area");
  const barra = container.querySelector(".ne-barra");
  const bolha = container.querySelector(".ne-bolha");

  const avisar = () => {
    marcarVazia();
    onChange();
  };

  function marcarVazia() {
    const vazia = !area.textContent.trim() && !area.querySelector("hr, table, li, img");
    area.classList.toggle("vazia", vazia);
  }

  function setMarkdown(md) {
    area.replaceChildren(markdownParaDom(md || ""));
    if (!area.firstChild) area.append(Object.assign(document.createElement("p"), { innerHTML: "<br>" }));
    marcarVazia();
  }

  const getMarkdown = () => domParaMarkdown(area);

  // ---------------- onde está o cursor ----------------

  function blocoAtual() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let no = sel.anchorNode;
    if (!area.contains(no)) return null;
    while (no && no !== area) {
      if (no.nodeType === 1 && /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(no.tagName)) return no;
      no = no.parentNode;
    }
    return null;
  }

  function dentroDe(seletor) {
    const sel = window.getSelection();
    const no = sel.anchorNode;
    if (!no || !area.contains(no)) return null;
    const el = no.nodeType === 1 ? no : no.parentElement;
    const achado = el?.closest(seletor);
    return achado && area.contains(achado) ? achado : null;
  }

  // ---------------- comandos ----------------

  // valor null vira "" — insertHorizontalRule usa o valor como id (saía id="null")
  const exec = (cmd, valor = null) => document.execCommand(cmd, false, valor ?? "");

  function alternarBloco(tag) {
    const atual = blocoAtual();
    const ja = atual && (atual.tagName.toLowerCase() === tag || atual.closest(tag));
    exec("formatBlock", ja ? "<p>" : `<${tag}>`);
  }

  /** Cria a lista no bloco atual. O Chrome junta a lista nova com uma
   * lista vizinha do mesmo tipo (escrever "- " depois de uma lista que
   * já acabou continuava a lista de cima): o item novo é separado numa
   * lista própria, mantendo o cursor. */
  function criarLista(cmd) {
    exec(cmd);
    const li = dentroDe("li");
    const lista = li?.parentElement;
    if (!li || !lista || !li.previousElementSibling) return;
    const sel = window.getSelection();
    const marca = [sel.anchorNode, sel.anchorOffset];
    const nova = document.createElement(lista.tagName.toLowerCase());
    let atual = li;
    while (atual) {
      const prox = atual.nextElementSibling;
      nova.append(atual);
      atual = prox;
    }
    lista.after(nova);
    try {
      sel.collapse(marca[0], marca[1]);
    } catch {
      /* cursor perdido: fica no começo do item */
    }
  }

  // tarefa é por item (li[data-checked]), não por lista: o Chrome junta
  // listas vizinhas sozinho, e uma lista com itens comuns e tarefas
  // misturados é markdown válido
  function checklist() {
    const li = dentroDe("li");
    if (li && li.closest("ol")) {
      exec("insertUnorderedList"); // tarefa só em lista com marcador
    } else if (li) {
      if (li.dataset.checked !== undefined) delete li.dataset.checked;
      else li.dataset.checked = "false";
      return;
    } else {
      criarLista("insertUnorderedList");
    }
    const novo = dentroDe("li");
    if (novo) novo.dataset.checked ??= "false";
  }

  /** Conserta o que o contenteditable às vezes produz: lista, título,
   * citação, código ou tabela DENTRO de um <p> (HTML inválido — o Chrome
   * faz isso ao criar lista num parágrafo). O <p> é desfeito; trechos de
   * texto soltos voltam pra <p>s próprios. O cursor é guardado e
   * devolvido (os nós de texto são os mesmos, só mudam de lugar). */
  function normalizar() {
    const ruins = [...area.querySelectorAll("p")].filter((p) =>
      [...p.children].some((c) => /^(UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|HR|P|DIV)$/.test(c.tagName))
    );
    if (!ruins.length) return;
    const sel = window.getSelection();
    const marca = sel.rangeCount ? [sel.anchorNode, sel.anchorOffset] : null;
    for (const p of ruins) {
      const pedacos = [];
      let solto = null;
      for (const filho of [...p.childNodes]) {
        if (filho.nodeType === 1 && /^(UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|HR|P|DIV)$/.test(filho.tagName)) {
          solto = null;
          pedacos.push(filho);
        } else if (filho.nodeType === 3 && !filho.data.trim() && !solto) {
          filho.remove();
        } else {
          if (!solto) {
            solto = document.createElement("p");
            pedacos.push(solto);
          }
          solto.append(filho);
        }
      }
      p.replaceWith(...pedacos);
    }
    if (marca && marca[0]?.isConnected) {
      try {
        sel.collapse(marca[0], Math.min(marca[1], marca[0].length ?? marca[0].childNodes.length));
      } catch {
        /* sem cursor pra devolver */
      }
    }
  }

  /** Enter numa linha vazia dentro de citação/bloco de código sai dele
   * (como no Teams); sem isso não havia como continuar escrevendo fora. */
  function sairDoBloco() {
    const container = dentroDe("blockquote, pre");
    if (!container) return false;
    const sel = window.getSelection();
    if (container.tagName === "PRE") {
      const texto = container.textContent;
      const range = sel.getRangeAt(0);
      const ateOFim = document.createRange();
      ateOFim.setStart(range.endContainer, range.endOffset);
      ateOFim.setEnd(container, container.childNodes.length);
      if (ateOFim.toString() !== "" || !texto.endsWith("\n")) return false;
      // tira a linha vazia do fim do bloco
      const ultimo = container.lastChild?.nodeType === 1 ? container.lastChild : container;
      const t = [...ultimo.childNodes].reverse().find((n) => n.nodeType === 3) || ultimo.lastChild;
      if (t?.nodeType === 3) t.data = t.data.replace(/\n$/, "");
    } else {
      const bloco = blocoAtual();
      const linhaVazia = bloco && bloco !== container ? !bloco.textContent.trim() : !container.textContent.split("\n").pop().trim();
      if (!linhaVazia) return false;
      if (bloco && bloco !== container) bloco.remove();
      // o Chrome abre uma citação nova a cada Enter: a vazia some ao sair
      if (bloco === container && !container.textContent.trim()) {
        const p = document.createElement("p");
        p.append(document.createElement("br"));
        container.replaceWith(p);
        sel.collapse(p, 0);
        return true;
      }
    }
    const p = document.createElement("p");
    p.append(document.createElement("br"));
    container.after(p);
    sel.collapse(p, 0);
    return true;
  }

  function codigoNaLinha() {
    const code = dentroDe("code");
    if (code && !code.closest("pre")) {
      // desfaz: troca o <code> pelo texto
      code.replaceWith(document.createTextNode(code.textContent));
      return;
    }
    const sel = window.getSelection();
    const texto = sel.toString() || "código";
    exec("insertHTML", `<code>${escapeHtml(texto)}</code>&#8203;`);
  }

  async function link() {
    const sel = window.getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const atual = dentroDe("a")?.getAttribute("href") || "";
    const valor = await showPromptModal("endereço do link", {
      title: "link",
      defaultValue: atual || "https://",
      confirmText: "aplicar",
    });
    if (valor == null) return;
    area.focus();
    if (range) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let url = valor.trim();
    if (!url || url === "https://") {
      exec("unlink");
      return;
    }
    if (!/^[a-z]+:/i.test(url)) url = (url.includes("@") && !url.includes("/") ? "mailto:" : "https://") + url;
    if (!urlSegura(url)) return;
    if (sel.isCollapsed) exec("insertHTML", `<a href="${escapeHtml(url)}">${escapeHtml(valor.trim())}</a>&#8203;`);
    else exec("createLink", url);
    avisar();
  }

  function tabela() {
    const cab = "<th>coluna</th><th>coluna</th>";
    const linha = "<td><br></td><td><br></td>";
    exec("insertHTML", `<table data-nova="1"><thead><tr>${cab}</tr></thead><tbody><tr>${linha}</tr><tr>${linha}</tr></tbody></table><p><br></p>`);
    // cursor na 1ª célula, com "coluna" selecionado pra digitar por cima
    const nova = area.querySelector("table[data-nova]");
    if (!nova) return;
    delete nova.dataset.nova;
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(nova.querySelector("th"));
    sel.removeAllRanges();
    sel.addRange(r);
  }

  const COMANDOS = {
    negrito: () => exec("bold"),
    italico: () => exec("italic"),
    sublinhado: () => exec("underline"),
    tachado: () => exec("strikeThrough"),
    h1: () => alternarBloco("h1"),
    h2: () => alternarBloco("h2"),
    h3: () => alternarBloco("h3"),
    marcador: () => {
      const li = dentroDe("li");
      if (li && li.dataset.checked !== undefined && li.closest("ul")) delete li.dataset.checked;
      else if (li) exec("insertUnorderedList");
      else criarLista("insertUnorderedList");
    },
    numerada: () => (dentroDe("li") ? exec("insertOrderedList") : criarLista("insertOrderedList")),
    checklist,
    citacao: () => alternarBloco("blockquote"),
    codigo: codigoNaLinha,
    bloco: () => alternarBloco("pre"),
    link,
    divisoria: () => exec("insertHorizontalRule"),
    tabela,
    limpar: () => {
      exec("removeFormat");
      exec("unlink");
      exec("formatBlock", "<p>");
    },
  };

  function rodar(id) {
    area.focus();
    const r = COMANDOS[id]?.();
    normalizar();
    if (!(r instanceof Promise)) avisar();
    atualizarEstado();
  }

  // ---------------- estado dos botões ----------------

  function atualizarEstado() {
    const ativo = {
      negrito: document.queryCommandState("bold"),
      italico: document.queryCommandState("italic"),
      sublinhado: document.queryCommandState("underline"),
      tachado: document.queryCommandState("strikeThrough"),
      h1: !!dentroDe("h1"),
      h2: !!dentroDe("h2"),
      h3: !!dentroDe("h3"),
      marcador: !!dentroDe("ul > li:not([data-checked])"),
      numerada: !!dentroDe("ol"),
      checklist: !!dentroDe("ul > li[data-checked]"),
      citacao: !!dentroDe("blockquote"),
      codigo: !!dentroDe("code"),
      bloco: !!dentroDe("pre"),
      link: !!dentroDe("a"),
    };
    container.querySelectorAll("[data-ne]").forEach((b) => {
      if (b.dataset.ne in ativo) b.setAttribute("aria-pressed", String(ativo[b.dataset.ne]));
    });
  }

  function posicionarBolha() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !area.contains(sel.anchorNode) || document.activeElement !== area) {
      bolha.hidden = true;
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const base = container.getBoundingClientRect();
    if (!r.width && !r.height) {
      bolha.hidden = true;
      return;
    }
    bolha.hidden = false;
    const largura = bolha.offsetWidth;
    const x = Math.min(Math.max(r.left - base.left + r.width / 2 - largura / 2, 4), base.width - largura - 4);
    const acima = r.top - base.top - bolha.offsetHeight - 6;
    bolha.style.left = `${x}px`;
    bolha.style.top = `${acima < 0 ? r.bottom - base.top + 6 : acima}px`;
  }

  // ---------------- eventos ----------------

  const onMouseDownBarra = (e) => {
    // não roubar o foco/seleção do texto ao clicar num botão
    if (e.target.closest("[data-ne]")) e.preventDefault();
  };
  const onClickBarra = (e) => {
    const b = e.target.closest("[data-ne]");
    if (b) rodar(b.dataset.ne);
  };
  barra.addEventListener("mousedown", onMouseDownBarra);
  bolha.addEventListener("mousedown", onMouseDownBarra);
  barra.addEventListener("click", onClickBarra);
  bolha.addEventListener("click", onClickBarra);

  function regraDeMarkdown() {
    // "- " / "1. " / "[] " / "# " / "> " / "```" no começo da linha
    const sel = window.getSelection();
    const no = sel.anchorNode;
    if (!sel.isCollapsed || !no || no.nodeType !== 3) return false;
    const bloco = blocoAtual();
    if (!bloco || bloco.tagName === "PRE") return false;
    const antes = no.data.slice(0, sel.anchorOffset).replace(/\u00a0/g, " ");
    // só vale se esse texto é o começo do bloco
    const primeiro = document.createTreeWalker(bloco, NodeFilter.SHOW_TEXT).nextNode();
    if (primeiro !== no) return false;
    const m = /^(-|\*|1\.|\[ ?\]|-\s\[ ?\]|#{1,3}|>|```)\s$/.exec(antes);
    if (!m) return false;
    const marca = m[1];
    const dentroDeLista = !!dentroDe("li");
    // apaga o prefixo selecionando e usando o "delete" nativo: mexer no
    // texto direto (deleteData) deixava o cursor numa posição inválida e
    // o que vinha depois caía dentro do bloco errado; e assim o Ctrl+Z
    // desfaz a conversão
    const prefixo = document.createRange();
    prefixo.setStart(no, 0);
    prefixo.setEnd(no, sel.anchorOffset);
    sel.removeAllRanges();
    sel.addRange(prefixo);
    exec("delete");
    if ((marca === "-" || marca === "*") && !dentroDeLista) criarLista("insertUnorderedList");
    else if (marca === "1." && !dentroDeLista) criarLista("insertOrderedList");
    else if (/\[/.test(marca)) checklist();
    else if (marca.startsWith("#")) exec("formatBlock", `<h${marca.length}>`);
    else if (marca === ">") exec("formatBlock", "<blockquote>");
    else if (marca === "```") exec("formatBlock", "<pre>");
    return true;
  }

  const onInput = (e) => {
    if (e.inputType === "insertText" && e.data === " " && regraDeMarkdown()) normalizar();
    avisar();
  };

  const onKeydown = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    let id = null;
    if (ctrl && !e.altKey && !e.shiftKey) id = { b: "negrito", i: "italico", u: "sublinhado", e: "codigo", k: "link" }[e.key.toLowerCase()];
    else if (ctrl && e.shiftKey && !e.altKey) id = { Digit7: "numerada", Digit8: "marcador", Digit9: "checklist", KeyX: "tachado" }[e.code];
    else if (ctrl && e.altKey && !e.shiftKey) id = { Digit1: "h1", Digit2: "h2", Digit3: "h3" }[e.code];
    if (id) {
      e.preventDefault();
      e.stopPropagation(); // Ctrl+K aqui é link, não a busca global
      rodar(id);
      return;
    }
    if (e.key === "Tab" && dentroDe("li")) {
      e.preventDefault();
      exec(e.shiftKey ? "outdent" : "indent");
      avisar();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && sairDoBloco()) {
      e.preventDefault();
      avisar();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const bloco = blocoAtual();
      if (bloco && bloco.textContent.replace(/\u00a0/g, " ").trim() === "---" && bloco.tagName !== "PRE") {
        e.preventDefault();
        // apaga o "---" pelo comando nativo (zerar o texto na mão perdia o
        // cursor e a divisória ia parar no bloco de cima)
        const r = document.createRange();
        r.selectNodeContents(bloco);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        exec("delete");
        exec("insertHorizontalRule");
        normalizar();
        avisar();
        return;
      }
      // Enter numa tarefa: o item novo (o navegador copia os atributos)
      // nasce desmarcado; e lista/parágrafo fora do lugar é consertado
      requestAnimationFrame(() => {
        const li = dentroDe("li[data-checked]");
        if (li && !li.textContent.trim()) li.dataset.checked = "false";
        normalizar();
      });
    }
  };

  const onClickArea = (e) => {
    // caixinha do checklist (o ::before à esquerda do item)
    const li = e.target.closest("li[data-checked]");
    if (li && e.target === li) {
      const r = li.getBoundingClientRect();
      if (e.clientX - r.left < 22) {
        li.dataset.checked = li.dataset.checked === "true" ? "false" : "true";
        avisar();
        return;
      }
    }
    // Ctrl+clique abre o link no navegador
    const a = e.target.closest("a");
    if (a && (e.ctrlKey || e.metaKey) && urlSegura(a.getAttribute("href"))) {
      e.preventDefault();
      openExternal(a.getAttribute("href"));
    }
  };

  const onPaste = (e) => {
    const dados = e.clipboardData;
    if (!dados) return;
    e.preventDefault();
    const html = dados.getData("text/html");
    const texto = dados.getData("text/plain");
    let md;
    if (html) {
      // DOMParser não executa script nem baixa imagem; o markdown limpa o resto
      const colado = new DOMParser().parseFromString(html, "text/html");
      md = domParaMarkdown(colado.body);
    } else if (PARECE_MARKDOWN.test(texto)) {
      md = texto;
    }
    if (md !== undefined && md.trim()) exec("insertHTML", fragParaHtml(markdownParaDom(md)));
    else if (texto) exec("insertText", texto);
    avisar();
  };

  const onSelecao = () => {
    if (!container.isConnected) return;
    atualizarEstado();
    posicionarBolha();
  };
  const onFocus = () => exec("defaultParagraphSeparator", "p");
  const onBlur = () => setTimeout(() => (bolha.hidden = true), 150);

  area.addEventListener("input", onInput);
  area.addEventListener("keydown", onKeydown);
  area.addEventListener("click", onClickArea);
  area.addEventListener("paste", onPaste);
  area.addEventListener("focus", onFocus);
  area.addEventListener("blur", onBlur);
  document.addEventListener("selectionchange", onSelecao);

  setMarkdown(markdown);

  return {
    el: area,
    getMarkdown,
    setMarkdown,
    focus: () => area.focus(),
    destroy() {
      document.removeEventListener("selectionchange", onSelecao);
      container.innerHTML = "";
      container.classList.remove("ne");
    },
  };
}
