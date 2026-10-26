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
 *   @ amanhã 9h ligar banco  -> lembrete (ORG-05) amanhã às 09:00
 *   qualquer outra coisa     -> vai pra caixa de entrada
 *
 * Datas e horas no idioma do app (P-100) — em português: hoje, amanhã,
 * depois de amanhã, ontem, anteontem, dia da semana (seg… /
 * segunda-feira…), "dia 25", 25/10 e 25/10/2026; hora 9h, 9h30, 14:30
 * (com ou sem "às"). Os outros idiomas têm o equivalente em LINGUAS
 * ("tomorrow 9am", "morgen 9 Uhr", "明天9点", "내일 9시"…). Pra evento o
 * dia da semana é o PRÓXIMO (sexta dita numa sexta = a da semana que
 * vem); pra gasto é o ÚLTIMO (já aconteceu).
 */
import { idiomaAtual } from "../i18n.js";

// ── palavras de data por idioma ─────────────────────────────────────────
// relativos: [regex, dias] na ordem de teste ("depois de amanhã" antes de
// "amanhã"); "±1" = depende do sentido (o "कल" do hindi é ontem e amanhã).
// dias: domingo primeiro (Date.getDay()). antes/depois: palavras que
// acompanham o dia da semana e saem junto ("next friday", "venerdì
// prossimo"). diaN: "dia 25". mesPrimeiro: 10/25 em vez de 25/10.
// juntas: idioma escrito sem espaço entre as palavras (明天9点牙医).
const HHMM = "(?<h>\\d{1,2}):(?<m>\\d{2})";
const LINGUAS = {
  pt: {
    relativos: [["depois de amanh[ãa]", 2], ["anteontem", -2], ["amanh[ãa]", 1], ["ontem", -1], ["hoje", 0]],
    dias: [
      ["dom", "domingo"],
      ["seg", "segunda", "segunda-feira"],
      // sem "ter": é verbo ("! ter que ligar pro banco") — terça vale por extenso
      ["terca", "terça", "terca-feira", "terça-feira"],
      ["qua", "quarta", "quarta-feira"],
      ["qui", "quinta", "quinta-feira"],
      ["sex", "sexta", "sexta-feira"],
      ["sab", "sáb", "sabado", "sábado"],
    ],
    antes: "n[ao]|nesta|neste|pr[óo]xim[ao]|essa|esse|est[ae]|[úu]ltim[ao]",
    diaN: "(?:no\\s+)?dia\\s+(\\d{1,2})",
    horas: ["(?:às|as|a partir das)?\\s*(?<h>\\d{1,2})(?::(?<m>\\d{2})|h(?<m2>\\d{2})?)"],
  },
  en: {
    relativos: [["(?:the )?day after tomorrow", 2], ["(?:the )?day before yesterday", -2], ["tomorrow", 1], ["yesterday", -1], ["today|tonight", 0]],
    // sem "sun"/"sat": são palavras comuns ("sat with mom")
    dias: [["sunday"], ["mon", "monday"], ["tue", "tues", "tuesday"], ["wed", "wednesday"], ["thu", "thur", "thurs", "thursday"], ["fri", "friday"], ["saturday"]],
    antes: "next|this|last|on|this coming",
    diaN: "(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)",
    horas: ["(?:at\\s+)?(?<h>\\d{1,2})(?::(?<m>\\d{2}))?\\s*(?<ap>a\\.?m\\.?|p\\.?m\\.?)", `(?:at\\s+)?${HHMM}`],
    mesPrimeiro: true,
  },
  es: {
    relativos: [["pasado ma[ñn]ana", 2], ["anteayer|antier", -2], ["ma[ñn]ana", 1], ["ayer", -1], ["hoy", 0]],
    dias: [["domingo"], ["lunes"], ["martes"], ["miércoles", "miercoles"], ["jueves"], ["viernes"], ["sábado", "sabado"]],
    antes: "el pr[óo]ximo|el pasado|pr[óo]ximo|este|el",
    depois: "pr[óo]ximo|pasado|que viene",
    diaN: "(?:el\\s+)?d[íi]a\\s+(\\d{1,2})",
    horas: ["(?:a\\s+las?\\s+)?(?<h>\\d{1,2})(?::(?<m>\\d{2})|\\s?h(?<m2>\\d{2})?)", "a\\s+las?\\s+(?<h>\\d{1,2})"],
  },
  fr: {
    relativos: [["apr[èe]s-demain", 2], ["avant-hier", -2], ["demain", 1], ["hier", -1], ["aujourd['’]hui|ce soir", 0]],
    dias: [["dimanche"], ["lundi"], ["mardi"], ["mercredi"], ["jeudi"], ["vendredi"], ["samedi"]],
    antes: "ce",
    depois: "prochain|dernier",
    diaN: "le\\s+(\\d{1,2})(?:er)?",
    horas: ["(?:[àa]\\s+)?(?<h>\\d{1,2})(?::(?<m>\\d{2})|\\s?h(?<m2>\\d{2})?)"],
  },
  it: {
    relativos: [["dopodomani", 2], ["l['’]altro ieri|altroieri", -2], ["domani", 1], ["ieri", -1], ["oggi|stasera", 0]],
    dias: [["domenica"], ["lunedì", "lunedi"], ["martedì", "martedi"], ["mercoledì", "mercoledi"], ["giovedì", "giovedi"], ["venerdì", "venerdi"], ["sabato"]],
    antes: "questo|questa|prossimo|prossima|lo scorso|la scorsa",
    depois: "prossimo|prossima|scorso|scorsa",
    diaN: "il\\s+(?:giorno\\s+)?(\\d{1,2})",
    horas: ["(?:alle\\s+|ore\\s+)?(?<h>\\d{1,2})[:.](?<m>\\d{2})", "(?:alle|ore)\\s+(?<h>\\d{1,2})"],
  },
  de: {
    relativos: [["[üu]bermorgen|uebermorgen", 2], ["vorgestern", -2], ["morgen", 1], ["gestern", -1], ["heute", 0]],
    dias: [["sonntag"], ["montag"], ["dienstag"], ["mittwoch"], ["donnerstag"], ["freitag"], ["samstag", "sonnabend"]],
    antes: "am|n[äa]chsten|naechsten|diesen|letzten|kommenden",
    diaN: "am\\s+(\\d{1,2})\\.",
    horas: ["(?:um\\s+)?(?<h>\\d{1,2})(?:[:.](?<m>\\d{2}))?\\s*uhr", `(?:um\\s+)?${HHMM}`],
  },
  zh: {
    relativos: [["后天|後天", 2], ["前天", -2], ["明天|明日", 1], ["昨天|昨日", -1], ["今天|今日|今晚", 0]],
    dias: [..."日一二三四五六"].map((c) => [`星期${c}`, `周${c}`, `週${c}`, `礼拜${c}`, `禮拜${c}`]).map((l, i) => (i ? l : [...l, "星期天", "周天", "礼拜天"])),
    antes: "下个|下個|下|这个|這個|这|這|本|上个|上個|上",
    diaN: "(\\d{1,2})[号號日]",
    horas: ["(?<ap>上午|早上|中午|下午|晚上)?(?<h>\\d{1,2})[点點时時](?:(?<m>\\d{1,2})分?|(?<half>半))?", HHMM],
    mesPrimeiro: true,
    juntas: true,
  },
  ja: {
    relativos: [["明後日|あさって", 2], ["一昨日|おととい", -2], ["明日|あした|あす", 1], ["昨日|きのう", -1], ["今日|きょう|今夜", 0]],
    dias: [..."日月火水木金土"].map((c) => [`${c}曜日`, `${c}曜`]),
    antes: "次の|今度の|今週の|来週の|先週の|来週|今週|先週",
    diaN: "(\\d{1,2})日",
    horas: ["(?<ap>午前|午後|朝|夜)?(?<h>\\d{1,2})時(?:(?<m>\\d{1,2})分|(?<half>半))?", HHMM],
    mesPrimeiro: true,
    juntas: true,
  },
  ko: {
    relativos: [["모레", 2], ["그저께|그제", -2], ["내일", 1], ["어제", -1], ["오늘", 0]],
    dias: [..."일월화수목금토"].map((c) => [`${c}요일`]),
    antes: "다음 주|이번 주|지난 주|다음주|이번주|지난주|다음|이번|지난",
    diaN: "(\\d{1,2})일",
    horas: ["(?<ap>오전|오후|아침|저녁|밤)?\\s*(?<h>\\d{1,2})시(?:\\s*(?<m>\\d{1,2})분|\\s*(?<half>반))?", HHMM],
    mesPrimeiro: true,
    juntas: true,
  },
  hi: {
    relativos: [["परसों", "±2"], ["कल", "±1"], ["आज", 0]],
    dias: [["रविवार", "इतवार"], ["सोमवार"], ["मंगलवार"], ["बुधवार"], ["गुरुवार", "बृहस्पतिवार"], ["शुक्रवार"], ["शनिवार"]],
    antes: "अगले|इस|पिछले",
    depois: "को",
    diaN: "(\\d{1,2})\\s*तारीख(?:\\s*को)?",
    horas: ["(?<ap>सुबह|दोपहर|शाम|रात)?\\s*(?<h>\\d{1,2})(?::(?<m>\\d{2}))?\\s*बजे", HHMM],
  },
};
const TARDE = /^(p\.?m\.?|下午|晚上|午後|夜|오후|저녁|밤|दोपहर|शाम|रात)$/i;
const MANHA = /^(a\.?m\.?|上午|早上|午前|朝|오전|아침|सुबह)$/i;

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

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

/** A hora de um match dos padrões de `horas` ("9pm" → 21:00, "下午3点半" → 15:30). */
function lerHora(g) {
  let hh = Number(g.h);
  const mm = g.half ? 30 : Number(g.m ?? g.m2 ?? 0);
  if (g.ap && TARDE.test(g.ap) && hh < 12) hh += 12;
  if (g.ap && MANHA.test(g.ap) && hh === 12) hh = 0;
  return hh < 24 && mm < 60 ? `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : null;
}

/**
 * Tira a data e a hora do texto. `sentido`: "futuro" (evento) ou
 * "passado" (gasto) — decide o dia da semana e o "dia 25". `idioma`: de
 * qual tabela de LINGUAS vêm as palavras (o do app, por padrão).
 * @returns {{ resto: string, data: string|null, hora: string|null }}
 */
export function extrairDataHora(texto, hoje = new Date(), sentido = "futuro", idioma = idiomaAtual()) {
  const L = LINGUAS[idioma] ?? LINGUAS.pt;
  // começo e fim de palavra; nos idiomas sem espaço, qualquer lugar vale
  const [A, Z] = L.juntas ? ["", ""] : ["\\s", "(?=[\\s,.;:!?।]|$)"];
  const re = (corpo) => new RegExp(`${A}(?:${corpo})${Z}`, "i");
  let resto = ` ${texto} `;
  let data = null;
  let hora = null;
  const pegar = (regex, fn) => {
    const m = regex.exec(resto);
    if (!m) return false;
    const v = fn(m);
    if (v === null) return false;
    resto = resto.slice(0, m.index) + " " + resto.slice(m.index + m[0].length);
    return v;
  };

  // hora primeiro (o "9" de "9h" não pode virar "dia 9")
  for (const padrao of L.horas) {
    const h = pegar(re(padrao), (m) => lerHora(m.groups));
    if (h) {
      hora = h;
      break;
    }
  }

  for (const [palavras, n] of L.relativos) {
    const dias = typeof n === "string" ? Number(n.slice(1)) * (sentido === "passado" ? -1 : 1) : n;
    const d = pegar(re(palavras), () => iso(somarDias(hoje, dias)));
    if (d) {
      data = d;
      break;
    }
  }

  if (!data) {
    // 2026-10-25, 25/10, 25/10/2026 (ou /26) — 10/25 nos idiomas de mês
    // primeiro — e 10月25日 / 10월 25일
    const montar = (ano, mes, dia, temAno) => {
      const d = new Date(ano, mes, dia);
      if (d.getMonth() !== mes || d.getDate() !== dia) return null;
      // sem ano: o mais próximo no sentido pedido
      if (!temAno && sentido === "futuro" && d < somarDias(hoje, 0)) d.setFullYear(ano + 1);
      if (!temAno && sentido === "passado" && d > hoje) d.setFullYear(ano - 1);
      return iso(d);
    };
    data =
      pegar(re("(\\d{4})-(\\d{2})-(\\d{2})"), (m) => montar(Number(m[1]), Number(m[2]) - 1, Number(m[3]), true)) ||
      pegar(re("(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2}|\\d{4}))?"), (m) => {
        const [dia, mes] = L.mesPrimeiro ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
        let ano = m[3] ? Number(m[3]) : hoje.getFullYear();
        if (ano < 100) ano += 2000;
        return montar(ano, mes - 1, dia, Boolean(m[3]));
      }) ||
      (L.juntas &&
        pegar(re("(\\d{1,2})[月월]\\s*(\\d{1,2})[日号號일]?"), (m) => montar(hoje.getFullYear(), Number(m[1]) - 1, Number(m[2]), false))) ||
      null;
  }

  if (!data) {
    const nomes = L.dias.flat().map(escapar).sort((a, b) => b.length - a.length).join("|");
    const sep = L.juntas ? "\\s*" : "\\s+";
    const antes = L.antes ? `(?:(?:${L.antes})${sep})?` : "";
    const depois = L.depois ? `(?:${sep}(?:${L.depois}))?` : "";
    data = pegar(re(`${antes}(${nomes})${depois}`), (m) => {
      const alvo = L.dias.findIndex((nomesDia) => nomesDia.includes(m[1].toLowerCase()));
      if (alvo < 0) return null;
      const hojeDia = hoje.getDay();
      if (sentido === "futuro") return iso(somarDias(hoje, ((alvo - hojeDia + 7) % 7) || 7));
      return iso(somarDias(hoje, -(((hojeDia - alvo + 7) % 7) || 7)));
    }) || null;
  }

  if (!data) {
    // "dia 25"
    data = pegar(re(L.diaN), (m) => {
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

/** "1.234,56" / "1,234.56" / "25,9" / "25.50" / "25" -> número (ou null). */
export function lerValor(txt) {
  const t = txt.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) return Number(t.replace(/,/g, ""));
  if (/^\d+(,\d{1,2})?$/.test(t)) return Number(t.replace(",", "."));
  if (/^\d+\.\d{1,2}$/.test(t)) return Number(t);
  return null;
}

/**
 * @returns {{ tipo: "gasto"|"nota"|"evento"|"lembrete"|"entrada", texto: string,
 *   valor?: number|null, descricao?: string, data?: string|null,
 *   hora?: string|null, titulo?: string, conteudo?: string }}
 */
export function interpretarCaptura(entrada, hoje = new Date(), idioma = idiomaAtual()) {
  const texto = (entrada || "").trim();
  if (texto.startsWith("$")) {
    const corpo = texto.replace(/^\$\s*/, "").replace(/^r\$\s*/i, "");
    const { resto, data } = extrairDataHora(corpo, hoje, "passado", idioma);
    let valor = null;
    let descricao = resto;
    const m = /(?:^|\s)(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?=\s|$)/i.exec(resto);
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
    const { resto, data, hora } = extrairDataHora(corpo, hoje, "futuro", idioma);
    return { tipo: "evento", texto, titulo: resto, data: data || null, hora };
  }
  if (texto.startsWith("@")) {
    const corpo = texto.replace(/^@\s*/, "");
    const { resto, data, hora } = extrairDataHora(corpo, hoje, "futuro", idioma);
    return { tipo: "lembrete", texto, titulo: resto, data: data || null, hora };
  }
  return { tipo: "entrada", texto };
}
