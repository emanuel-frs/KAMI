import { fmtDataCurta, localDateKey } from "./format.js";

/**
 * components/email-texto.js — desenha o texto de um e-mail (ORG-06).
 *
 * O backend (app/email_texto.py) já entrega o corpo LIMPO, em texto
 * puro, com uma estrutura mínima:
 *   - linha em branco separa parágrafos;
 *   - "• " no começo da linha = item de lista;
 *   - "> " no começo da linha = trecho citado (resposta);
 *   - "-- " sozinho na linha = começo da assinatura;
 *   - link = U+E000 rótulo U+E001 url U+E002 (rótulo vazio = só "↗").
 *
 * Aqui isso vira DOM com createElement/textContent — NUNCA innerHTML:
 * o texto é de terceiro (marketing, spam), e a regra do app é não
 * renderizar HTML de ninguém. Link só abre se for http(s), e abre no
 * navegador do sistema (openExternal), nunca dentro do app. A URL não
 * aparece na tela (só o rótulo e, no tooltip, o domínio) — era a
 * reclamação: `[Statica](https://collect…/jwt/eyJ0…)` inteiro na lista.
 *
 * Também ficam aqui os pedaços puros da lista (agrupar por dia, hora
 * curta), testados sozinhos em tests/frontend/email-texto.test.js.
 */
const INI = "";
const MEIO = "";
const FIM = "";
const LINK_RE = new RegExp(`${INI}([^${MEIO}]*)${MEIO}([^${FIM}]*)${FIM}`, "g");

export function dominio(url) {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

function urlSegura(url) {
  return /^https?:\/\//i.test(url || "") && !!dominio(url);
}

/** Linha -> nós (texto + links). */
function nosDaLinha(doc, linha) {
  const frag = doc.createDocumentFragment();
  let ultimo = 0;
  for (const m of linha.matchAll(LINK_RE)) {
    if (m.index > ultimo) frag.append(doc.createTextNode(linha.slice(ultimo, m.index)));
    const [, rotulo, url] = m;
    if (urlSegura(url)) {
      const a = doc.createElement("a");
      a.className = "em-link" + (rotulo ? "" : " so-seta");
      a.href = "#";
      a.dataset.url = url;
      a.dataset.tooltip = `abrir no navegador — ${dominio(url)}`;
      a.textContent = rotulo ? `${rotulo} ↗` : "↗";
      frag.append(a);
    } else if (rotulo) {
      frag.append(doc.createTextNode(rotulo));
    }
    ultimo = m.index + m[0].length;
  }
  if (ultimo < linha.length) frag.append(doc.createTextNode(linha.slice(ultimo)));
  return frag;
}

function tipoDaLinha(linha) {
  if (linha.startsWith("> ") || linha === ">") return "citacao";
  if (linha.startsWith("• ")) return "lista";
  return "texto";
}

/**
 * Texto do e-mail -> DocumentFragment pronto pra pôr no leitor.
 * @param {string} texto
 * @param {Document} [doc]
 */
export function renderEmailTexto(texto, doc = document) {
  const frag = doc.createDocumentFragment();
  if (!texto) return frag;

  let destino = frag; // vira o bloco da assinatura depois do "-- "
  for (const bloco of texto.split(/\n{2,}/)) {
    const linhas = bloco.split("\n");
    // agrupa linhas seguidas do mesmo tipo: um parágrafo com uma lista no
    // meio vira <p>, <ul>, <p> — e não tudo num <p> só
    let atual = null;
    let tipoAtual = null;
    for (const linha of linhas) {
      if (linha === "-- " || linha === "--") {
        const assinatura = doc.createElement("div");
        assinatura.className = "em-assinatura";
        frag.append(assinatura);
        destino = assinatura;
        atual = null;
        continue;
      }
      const tipo = tipoDaLinha(linha);
      if (!atual || tipo !== tipoAtual) {
        atual = doc.createElement(tipo === "lista" ? "ul" : tipo === "citacao" ? "blockquote" : "p");
        tipoAtual = tipo;
        destino.append(atual);
      } else if (tipo !== "lista") {
        atual.append(doc.createElement("br"));
      }
      const conteudo = tipo === "lista" ? linha.slice(2) : tipo === "citacao" ? linha.replace(/^>\s?/, "") : linha;
      if (tipo === "lista") {
        const li = doc.createElement("li");
        li.append(nosDaLinha(doc, conteudo));
        atual.append(li);
      } else {
        atual.append(nosDaLinha(doc, conteudo));
      }
    }
  }
  return frag;
}

/** Texto do e-mail sem as marcas, pro "copiar texto" (links viram
 * "rótulo (url)" — quem cola em outro lugar ainda consegue abrir). */
export function textoParaCopiar(texto) {
  return (texto || "").replace(LINK_RE, (_, rotulo, url) => (rotulo ? `${rotulo} (${url})` : url));
}

// ---------------- lista: grupos por dia ----------------

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function inicioDoDia(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Em qual grupo da lista o e-mail entra (P-29): hoje, ontem, esta
 * semana (desde segunda), este mês, e depois um grupo por mês.
 * @returns {{ chave: string, rotulo: string }}
 */
export function grupoDoDia(iso, agora = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { chave: "sem-data", rotulo: "sem data" };
  const hoje = inicioDoDia(agora);
  const dia = inicioDoDia(d);
  const dias = Math.round((hoje - dia) / 86400000);
  if (dias <= 0) return { chave: "hoje", rotulo: "hoje" };
  if (dias === 1) return { chave: "ontem", rotulo: "ontem" };
  const desdeSegunda = (hoje.getDay() + 6) % 7; // segunda = 0
  if (dias <= desdeSegunda) return { chave: "semana", rotulo: "esta semana" };
  if (d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth()) {
    return { chave: "mes", rotulo: "este mês" };
  }
  const rotulo = d.getFullYear() === agora.getFullYear() ? MESES[d.getMonth()] : `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  return { chave: `${d.getFullYear()}-${d.getMonth()}`, rotulo };
}

/** Hora curta da linha da lista, combinando com o grupo: hoje/ontem só
 * a hora, esta semana o dia da semana, o resto dia/mês no formato escolhido (ORG-07). */
export function horaCurta(iso, agora = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const { chave } = grupoDoDia(iso, agora);
  if (chave === "hoje" || chave === "ontem") return hh;
  if (chave === "semana") return `${DIAS[d.getDay()]} ${hh}`;
  return fmtDataCurta(localDateKey(d)); // ORG-07
}

/** Data por extenso do cabeçalho do leitor: "ter, 20 de outubro de 2026 · 14:32". */
export function dataLonga(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()} · ${hh}`;
}
