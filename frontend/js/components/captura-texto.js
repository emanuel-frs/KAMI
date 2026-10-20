/**
 * components/captura-texto.js — o que a captura rápida entende (ORG-02).
 *
 * Função pura (testada em tests/frontend/captura-texto.test.js): recebe a
 * linha digitada e devolve o que ela parece ser. Os prefixos só
 * PREENCHEM o formulário (P-38) — a pessoa confere e confirma.
 *
 *   $ 25 almoço              -> gasto de R$ 25, "almoço", hoje
 *   $ 32,90 farmácia ontem   -> gasto com data de ontem
 *   # ideia: app de receitas -> nota (1ª linha = título)
 *   ! amanhã 9h dentista     -> evento amanhã às 09:00, "dentista"
 *   ! sexta 14:30 reunião    -> evento na próxima sexta
 *   qualquer outra coisa     -> vai pra caixa de entrada
 *
 * Datas em português: hoje, amanhã, depois de amanhã, ontem, anteontem,
 * dia da semana (seg… / segunda-feira…), "dia 25", 25/10 e 25/10/2026.
 * Pra evento o dia da semana é o PRÓXIMO (sexta dita numa sexta = a da
 * semana que vem); pra gasto é o ÚLTIMO (já aconteceu). Hora: 9h, 9h30,
 * 14:30 (com ou sem "às").
 */

const DIAS = [
  ["dom", "domingo"],
  ["seg", "segunda", "segunda-feira"],
  // sem "ter": é verbo ("! ter que ligar pro banco") — terça vale por extenso
  ["terca", "terça", "terca-feira", "terça-feira"],
  ["qua", "quarta", "quarta-feira"],
  ["qui", "quinta", "quinta-feira"],
  ["sex", "sexta", "sexta-feira"],
  ["sab", "sáb", "sabado", "sábado"],
];

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function somarDias(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function limpar(s) {
  return s.replace(/\s+/g, " ").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").trim();
}

/**
 * Tira a data e a hora do texto. `sentido`: "futuro" (evento) ou
 * "passado" (gasto) — decide o dia da semana e o "dia 25".
 * @returns {{ resto: string, data: string|null, hora: string|null }}
 */
export function extrairDataHora(texto, hoje = new Date(), sentido = "futuro") {
  let resto = ` ${texto} `;
  let data = null;
  let hora = null;
  const pegar = (re, fn) => {
    const m = re.exec(resto);
    if (!m) return false;
    const v = fn(m);
    if (v === null) return false;
    resto = resto.slice(0, m.index) + " " + resto.slice(m.index + m[0].length);
    return v;
  };

  // hora primeiro (o "9" de "9h" não pode virar "dia 9")
  const h = pegar(/\s(?:às|as|a partir das)?\s*(\d{1,2})(?::(\d{2})|h(\d{2})?)(?=[\s,.]|$)/i, (m) => {
    const hh = Number(m[1]);
    const mm = Number(m[2] ?? m[3] ?? 0);
    return hh < 24 && mm < 60 ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : null;
  });
  if (h) hora = h;

  const relativos = [
    [/\sdepois de amanh[ãa](?=\s)/i, 2],
    [/\santeontem(?=\s)/i, -2],
    [/\samanh[ãa](?=\s)/i, 1],
    [/\sontem(?=\s)/i, -1],
    [/\shoje(?=\s)/i, 0],
  ];
  for (const [re, n] of relativos) {
    const d = pegar(re, () => iso(somarDias(hoje, n)));
    if (d) {
      data = d;
      break;
    }
  }

  if (!data) {
    // 25/10 ou 25/10/2026 (ou /26)
    data = pegar(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=[\s,.]|$)/, (m) => {
      const dia = Number(m[1]);
      const mes = Number(m[2]) - 1;
      let ano = m[3] ? Number(m[3]) : hoje.getFullYear();
      if (ano < 100) ano += 2000;
      const d = new Date(ano, mes, dia);
      if (d.getMonth() !== mes || d.getDate() !== dia) return null;
      // sem ano: o mais próximo no sentido pedido
      if (!m[3] && sentido === "futuro" && d < somarDias(hoje, 0)) d.setFullYear(ano + 1);
      if (!m[3] && sentido === "passado" && d > hoje) d.setFullYear(ano - 1);
      return iso(d);
    }) || null;
  }

  if (!data) {
    const nomes = DIAS.flat().map((n) => n.replace("-", "\\-")).sort((a, b) => b.length - a.length).join("|");
    const re = new RegExp(`\\s(?:(?:n[ao]|nesta|neste|pr[óo]xim[ao]|essa|esse|est[ae]|[úu]ltim[ao])\\s+)?(${nomes})(?=[\\s,.]|$)`, "i");
    data = pegar(re, (m) => {
      const alvo = DIAS.findIndex((nomesDia) => nomesDia.includes(m[1].toLowerCase()));
      if (alvo < 0) return null;
      const hojeDia = hoje.getDay();
      if (sentido === "futuro") return iso(somarDias(hoje, ((alvo - hojeDia + 7) % 7) || 7));
      return iso(somarDias(hoje, -(((hojeDia - alvo + 7) % 7) || 7)));
    }) || null;
  }

  if (!data) {
    // "dia 25"
    data = pegar(/\s(?:no\s+)?dia\s+(\d{1,2})(?=[\s,.]|$)/i, (m) => {
      const dia = Number(m[1]);
      if (dia < 1 || dia > 31) return null;
      let d = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
      if (sentido === "futuro" && d < somarDias(hoje, 0)) d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
      if (sentido === "passado" && d > hoje) d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, dia);
      return iso(d);
    }) || null;
  }

  return { resto: limpar(resto), data, hora };
}

/** "1.234,56" / "25,9" / "25.50" / "25" -> número (ou null). */
export function lerValor(txt) {
  const t = txt.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+(,\d{1,2})?$/.test(t)) return Number(t.replace(",", "."));
  if (/^\d+\.\d{1,2}$/.test(t)) return Number(t);
  return null;
}

/**
 * @returns {{ tipo: "gasto"|"nota"|"evento"|"entrada", texto: string,
 *   valor?: number|null, descricao?: string, data?: string|null,
 *   hora?: string|null, titulo?: string, conteudo?: string }}
 */
export function interpretarCaptura(entrada, hoje = new Date()) {
  const texto = (entrada || "").trim();
  if (texto.startsWith("$")) {
    const corpo = texto.replace(/^\$\s*/, "").replace(/^r\$\s*/i, "");
    const { resto, data } = extrairDataHora(corpo, hoje, "passado");
    let valor = null;
    let descricao = resto;
    const m = /(?:^|\s)(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?=\s|$)/i.exec(resto);
    if (m) {
      valor = lerValor(m[1]);
      descricao = limpar(resto.slice(0, m.index) + " " + resto.slice(m.index + m[0].length));
    }
    return { tipo: "gasto", texto, valor, descricao, data: data || null };
  }
  if (texto.startsWith("#")) {
    const corpo = texto.replace(/^#+\s*/, "");
    const [primeira, ...outras] = corpo.split("\n");
    let titulo = primeira.trim();
    let conteudo = outras.join("\n").trim();
    if (titulo.length > 80) {
      conteudo = [corpo.trim()].join("");
      titulo = titulo.slice(0, 77).replace(/\s+\S*$/, "") + "…";
    }
    return { tipo: "nota", texto, titulo, conteudo };
  }
  if (texto.startsWith("!")) {
    const corpo = texto.replace(/^!\s*/, "");
    const { resto, data, hora } = extrairDataHora(corpo, hoje, "futuro");
    return { tipo: "evento", texto, titulo: resto, data: data || null, hora };
  }
  return { tipo: "entrada", texto };
}
