/**
 * components/nota-markdown.js — markdown das notas ⇄ DOM do editor (ORG-01).
 *
 * O editor de notas é WYSIWYG (estilo Teams, P-49), mas o que vai pro
 * banco é MARKDOWN — nunca HTML (busca, exportação e a IA leem texto
 * puro; e HTML guardado seria porta de entrada pra script). Este módulo
 * faz as duas pontas, sem lib:
 *
 *   markdownParaDom(md, doc)  -> DocumentFragment  (abrir a nota)
 *   domParaMarkdown(raiz)     -> string            (salvar a nota)
 *
 * O DOM é montado só com createElement/textContent (o markdown pode ter
 * vindo de colagem ou de importação); link só vira <a> se for http(s) ou
 * mailto. O caminho de volta aceita o que o contenteditable produz
 * (div/p/br, b/strong, i/em, s/strike/del, u, span…) e ignora o resto —
 * é ele que limpa o HTML colado de fora (editor colapsa tudo pelo
 * markdown antes de mostrar).
 *
 * O que existe (o mesmo da barra do editor):
 *   # / ## / ###          títulos
 *   **negrito**  _itálico_ (*itálico* também é lido)  ++sublinhado++
 *   ~~tachado~~  `código`  [texto](url)
 *   - item / 1. item / - [ ] tarefa / - [x] feita   (2 espaços = nível)
 *   > citação     ``` bloco de código ```     ---  divisória
 *   | a | b |  tabela simples (a 1ª linha é o cabeçalho)
 *   linha em branco separa blocos; quebra simples dentro do parágrafo vira <br>
 *
 * Os testes de ida e volta ficam em tests/frontend/nota-markdown.test.js.
 */

// ---------------------------------------------------------------- inline

const INLINE_RE = new RegExp(
  [
    "\\\\([\\\\`*_~+\\[\\]()#>|\\-!.])", // 1 escape
    "`([^`\\n]+)`", // 2 código
    "\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*", // 3 negrito
    "~~(?=\\S)([\\s\\S]*?\\S)~~", // 4 tachado
    "\\+\\+(?=\\S)([\\s\\S]*?\\S)\\+\\+", // 5 sublinhado
    "(?<![\\w\\\\])_(?=\\S)([\\s\\S]*?\\S)_(?!\\w)", // 6 itálico _x_
    "(?<![\\w*\\\\])\\*(?=[^\\s*])([\\s\\S]*?[^\\s*])\\*(?![\\w*])", // 7 itálico *x*
    "\\[([^\\]\\n]*)\\]\\(([^)\\s]+)\\)", // 8, 9 link
  ].join("|")
);

export function urlSegura(url) {
  return /^(https?:\/\/|mailto:)/i.test(url || "");
}

function inline(doc, texto, destino) {
  let resto = texto;
  while (resto) {
    const m = INLINE_RE.exec(resto);
    if (!m) {
      destino.append(doc.createTextNode(resto));
      return;
    }
    if (m.index) destino.append(doc.createTextNode(resto.slice(0, m.index)));
    const envolver = (tag, conteudo) => {
      const el = doc.createElement(tag);
      inline(doc, conteudo, el);
      destino.append(el);
    };
    if (m[1] !== undefined) destino.append(doc.createTextNode(m[1]));
    else if (m[2] !== undefined) {
      const code = doc.createElement("code");
      code.textContent = m[2];
      destino.append(code);
    } else if (m[3] !== undefined) envolver("strong", m[3]);
    else if (m[4] !== undefined) envolver("s", m[4]);
    else if (m[5] !== undefined) envolver("u", m[5]);
    else if (m[6] !== undefined) envolver("em", m[6]);
    else if (m[7] !== undefined) envolver("em", m[7]);
    else if (m[8] !== undefined) {
      if (urlSegura(m[9])) {
        const a = doc.createElement("a");
        a.href = m[9];
        inline(doc, m[8], a);
        destino.append(a);
      } else {
        inline(doc, m[8], destino);
      }
    }
    resto = resto.slice(m.index + m[0].length);
  }
}

// ---------------------------------------------------------------- blocos

const LISTA_RE = /^( *)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;
const TABELA_SEP_RE = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/;

function celulas(linha) {
  let t = linha.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  // divide por | que não esteja escapado
  return t.split(/(?<!\\)\|/).map((c) => c.trim());
}

function montarLista(doc, itens) {
  // itens: [{nivel, ordenada, tarefa, feita, texto}] — monta a árvore por nível
  const raiz = doc.createDocumentFragment();
  const pilha = []; // [{nivel, el}]
  for (const it of itens) {
    while (pilha.length && pilha[pilha.length - 1].nivel > it.nivel) pilha.pop();
    let topo = pilha[pilha.length - 1];
    const tipo = it.ordenada ? "ol" : "ul";
    const precisaNova =
      !topo || topo.nivel < it.nivel || topo.el.tagName.toLowerCase() !== tipo || topo.tarefa !== it.tarefa;
    if (precisaNova) {
      const lista = doc.createElement(tipo);
      if (it.tarefa) lista.className = "checklist";
      if (topo && topo.nivel < it.nivel) {
        const ultimoLi = topo.el.lastElementChild || topo.el.appendChild(doc.createElement("li"));
        ultimoLi.append(lista);
      } else {
        if (topo && topo.nivel === it.nivel) pilha.pop();
        (pilha.length ? pilha[pilha.length - 1].el.lastElementChild : raiz).append(lista);
      }
      topo = { nivel: it.nivel, el: lista, tarefa: it.tarefa };
      pilha.push(topo);
    }
    const li = doc.createElement("li");
    if (it.tarefa) li.dataset.checked = it.feita ? "true" : "false";
    inline(doc, it.texto, li);
    topo.el.append(li);
  }
  return raiz;
}

/**
 * markdown -> DocumentFragment (seguro: só createElement/textContent).
 * @param {string} md
 * @param {Document} [doc]
 */
export function markdownParaDom(md, doc = document) {
  const frag = doc.createDocumentFragment();
  const linhas = (md || "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const vazia = (l) => l === undefined || !l.trim();

  while (i < linhas.length) {
    const linha = linhas[i];
    if (vazia(linha)) {
      i++;
      continue;
    }

    // bloco de código
    if (/^```/.test(linha)) {
      const corpo = [];
      i++;
      while (i < linhas.length && !/^```\s*$/.test(linhas[i])) corpo.push(linhas[i++]);
      i++; // fecha
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = corpo.join("\n");
      pre.append(code);
      frag.append(pre);
      continue;
    }

    // divisória
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linha)) {
      frag.append(doc.createElement("hr"));
      i++;
      continue;
    }

    // título
    const titulo = /^(#{1,3})\s+(.*)$/.exec(linha);
    if (titulo) {
      const h = doc.createElement(`h${titulo[1].length}`);
      inline(doc, titulo[2], h);
      frag.append(h);
      i++;
      continue;
    }

    // tabela: linha com | seguida da linha separadora
    if (linha.includes("|") && TABELA_SEP_RE.test(linhas[i + 1] || "") && (linhas[i + 1] || "").includes("-")) {
      const table = doc.createElement("table");
      const thead = doc.createElement("thead");
      const trh = doc.createElement("tr");
      for (const c of celulas(linha)) {
        const th = doc.createElement("th");
        inline(doc, c, th);
        trh.append(th);
      }
      thead.append(trh);
      table.append(thead);
      const tbody = doc.createElement("tbody");
      i += 2;
      while (i < linhas.length && linhas[i].includes("|") && !vazia(linhas[i])) {
        const tr = doc.createElement("tr");
        const cs = celulas(linhas[i]);
        for (let c = 0; c < trh.children.length; c++) {
          const td = doc.createElement("td");
          inline(doc, cs[c] ?? "", td);
          tr.append(td);
        }
        tbody.append(tr);
        i++;
      }
      table.append(tbody);
      frag.append(table);
      continue;
    }

    // citação
    if (/^>/.test(linha)) {
      const corpo = [];
      while (i < linhas.length && /^>/.test(linhas[i])) corpo.push(linhas[i++].replace(/^>\s?/, ""));
      const bq = doc.createElement("blockquote");
      bq.append(markdownParaDom(corpo.join("\n"), doc));
      frag.append(bq);
      continue;
    }

    // lista
    if (LISTA_RE.test(linha)) {
      const itens = [];
      while (i < linhas.length && LISTA_RE.test(linhas[i])) {
        const [, esp, marca, caixa, texto] = LISTA_RE.exec(linhas[i]);
        itens.push({
          nivel: Math.floor(esp.length / 2),
          ordenada: /\d/.test(marca),
          tarefa: !!caixa,
          feita: !!caixa && /x/i.test(caixa),
          texto,
        });
        i++;
      }
      frag.append(montarLista(doc, itens));
      continue;
    }

    // parágrafo: até linha vazia ou começo de outro bloco
    const corpo = [];
    while (
      i < linhas.length &&
      !vazia(linhas[i]) &&
      !(corpo.length && (/^(#{1,3}\s|>|```|\s*(-{3,}|\*{3,})\s*$)/.test(linhas[i]) || LISTA_RE.test(linhas[i])))
    ) {
      corpo.push(linhas[i++]);
    }
    const p = doc.createElement("p");
    corpo.forEach((l, k) => {
      if (k) p.append(doc.createElement("br"));
      inline(doc, l, p);
    });
    frag.append(p);
  }
  return frag;
}

// ---------------------------------------------------------------- DOM -> md

function escapar(texto) {
  return texto
    .replace(/\\/g, "\\\\")
    .replace(/([`*_[\]])/g, "\\$1")
    .replace(/~~/g, "\\~\\~")
    .replace(/\+\+/g, "\\+\\+");
}

// início de linha que viraria bloco se não fosse escapado
function escaparInicio(linha) {
  return linha.replace(/^(\s*)(#{1,6}\s|>|[-+]\s|\d+[.)]\s|\||-{3,}\s*$)/, (_, esp, marca) => `${esp}\\${marca}`);
}

const TAG_INLINE = {
  strong: "**", b: "**", em: "_", i: "_", u: "++", s: "~~", strike: "~~", del: "~~",
};

function estiloDoSpan(el) {
  // o contenteditable às vezes formata com <span style> em vez de tag
  const st = el.getAttribute?.("style") || "";
  return {
    negrito: /font-weight\s*:\s*(bold|[6-9]00)/i.test(st),
    italico: /font-style\s*:\s*italic/i.test(st),
    sublinhado: /text-decoration[^;]*underline/i.test(st),
    tachado: /text-decoration[^;]*line-through/i.test(st),
  };
}

function inlineMd(no) {
  if (no.nodeType === 3) return escapar(no.nodeValue.replace(/ /g, " ").replace(/\n/g, " "));
  if (no.nodeType !== 1) return "";
  const tag = no.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "code") return "`" + no.textContent.replace(/`/g, "'") + "`";
  if (tag === "img" || tag === "script" || tag === "style") return "";
  const dentro = [...no.childNodes].map(inlineMd).join("");
  if (tag === "a") {
    const href = no.getAttribute("href") || "";
    return urlSegura(href) && dentro.trim() ? `[${dentro}](${href.replace(/[()\s]/g, encodeURIComponent)})` : dentro;
  }
  let marca = TAG_INLINE[tag];
  let texto = dentro;
  if (tag === "span" || tag === "font") {
    const e = estiloDoSpan(no);
    if (e.tachado) texto = envolverMarca(texto, "~~");
    if (e.sublinhado) texto = envolverMarca(texto, "++");
    if (e.italico) texto = envolverMarca(texto, "_");
    if (e.negrito) texto = envolverMarca(texto, "**");
    return texto;
  }
  return marca ? envolverMarca(texto, marca) : texto;
}

// "** texto **" não é markdown válido: os espaços das pontas ficam fora
function envolverMarca(texto, marca) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(texto);
  if (!m[2]) return texto;
  return `${m[1]}${marca}${m[2]}${marca}${m[3]}`;
}

const BLOCOS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "hr", "table", "li", "section", "article", "header", "footer"]);

function linhasDeTexto(no) {
  // conteúdo inline de um bloco -> linhas (o <br> separa)
  return [...no.childNodes]
    .map(inlineMd)
    .join("")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""));
}

function listaMd(lista, nivel, saida) {
  const ordenada = lista.tagName.toLowerCase() === "ol";
  const tarefa = lista.classList.contains("checklist");
  let n = 1;
  for (const li of lista.children) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const sub = [...li.children].filter((c) => /^(ul|ol)$/i.test(c.tagName));
    const copia = li.cloneNode(true);
    copia.querySelectorAll(":scope > ul, :scope > ol").forEach((c) => c.remove());
    const texto = linhasDeTexto(copia).join(" ").trim();
    const marca = ordenada ? `${n++}.` : "-";
    const caixa = tarefa ? (li.dataset.checked === "true" ? "[x] " : "[ ] ") : "";
    saida.push(`${"  ".repeat(nivel)}${marca} ${caixa}${texto}`);
    sub.forEach((s) => listaMd(s, nivel + 1, saida));
  }
}

function blocosMd(raiz, saida) {
  let soltos = []; // nós inline fora de bloco (texto direto no editor)
  const fecharSoltos = () => {
    if (!soltos.length) return;
    const p = raiz.ownerDocument.createElement("p");
    soltos.forEach((n) => p.append(n.cloneNode(true)));
    soltos = [];
    const linhas = linhasDeTexto(p);
    if (linhas.some((l) => l.trim())) saida.push(linhas.map(escaparInicio).join("\n"));
  };

  for (const no of [...raiz.childNodes]) {
    const tag = no.nodeType === 1 ? no.tagName.toLowerCase() : "";
    if (!BLOCOS.has(tag)) {
      soltos.push(no);
      continue;
    }
    fecharSoltos();
    if (tag === "hr") saida.push("---");
    else if (/^h[1-6]$/.test(tag)) {
      const nivel = Math.min(3, Number(tag[1]));
      const texto = linhasDeTexto(no).join(" ").trim();
      if (texto) saida.push(`${"#".repeat(nivel)} ${texto}`);
    } else if (tag === "ul" || tag === "ol") {
      const linhas = [];
      listaMd(no, 0, linhas);
      if (linhas.length) saida.push(linhas.join("\n"));
    } else if (tag === "blockquote") {
      const dentro = [];
      blocosMd(no, dentro);
      if (dentro.length) saida.push(dentro.join("\n\n").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
    } else if (tag === "pre") {
      saida.push("```\n" + no.textContent.replace(/\n$/, "") + "\n```");
    } else if (tag === "table") {
      const linhas = [...no.querySelectorAll("tr")].map((tr) =>
        [...tr.children].map((c) => linhasDeTexto(c).join(" ").trim().replace(/\|/g, "\\|"))
      );
      if (!linhas.length) continue;
      const cols = Math.max(...linhas.map((l) => l.length));
      const fmt = (l) => `| ${Array.from({ length: cols }, (_, k) => l[k] || "").join(" | ")} |`;
      saida.push([fmt(linhas[0]), `|${" --- |".repeat(cols)}`, ...linhas.slice(1).map(fmt)].join("\n"));
    } else {
      // p, div, section… — div com blocos dentro (colagem) desce um nível
      if ([...no.children].some((c) => BLOCOS.has(c.tagName.toLowerCase()) && c.tagName.toLowerCase() !== "li")) {
        blocosMd(no, saida);
        continue;
      }
      const linhas = linhasDeTexto(no);
      if (linhas.some((l) => l.trim())) saida.push(linhas.map(escaparInicio).join("\n").trim());
    }
  }
  fecharSoltos();
}

/**
 * DOM do editor (ou HTML colado já parseado) -> markdown.
 * @param {Node} raiz
 */
export function domParaMarkdown(raiz) {
  const saida = [];
  blocosMd(raiz, saida);
  return saida.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

