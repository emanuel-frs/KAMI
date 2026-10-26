// ORG-02 — o que a captura rápida entende (components/captura-texto.js).
import test from "node:test";
import assert from "node:assert/strict";
import { interpretarCaptura, extrairDataHora, lerValor } from "../../frontend/js/components/captura-texto.js";

// terça-feira, 20/10/2026, 10h
const HOJE = new Date(2026, 9, 20, 10, 0);
const cap = (t) => interpretarCaptura(t, HOJE);

test("gasto: valor em vários formatos, descrição e data", () => {
  assert.deepEqual(cap("$ 25 almoço"), { tipo: "gasto", texto: "$ 25 almoço", valor: 25, descricao: "almoço", data: null });
  assert.equal(cap("$25,90 farmácia").valor, 25.9);
  assert.equal(cap("$ 1.234,56 aluguel").valor, 1234.56);
  assert.equal(cap("$ R$ 12.50 pão").valor, 12.5);
  assert.deepEqual([cap("$ uber 32").valor, cap("$ uber 32").descricao], [32, "uber"]);
  assert.equal(cap("$ 40 mercado ontem").data, "2026-10-19");
  assert.equal(cap("$ 40 mercado ontem").descricao, "mercado");
  assert.equal(cap("$ 90 sexta jantar").data, "2026-10-16"); // a última sexta (passado)
  assert.equal(cap("$ só texto").valor, null);
});

test("nota: primeira linha é o título", () => {
  assert.deepEqual(cap("# ideia: app de receitas"), { tipo: "nota", texto: "# ideia: app de receitas", titulo: "ideia: app de receitas", conteudo: "" });
  const longa = cap("# " + "palavra ".repeat(20));
  assert.ok(longa.titulo.endsWith("…") && longa.titulo.length <= 80);
  assert.ok(longa.conteudo.startsWith("palavra palavra"));
});

test("evento: datas relativas, dia da semana, hora", () => {
  assert.deepEqual(cap("! amanhã 9h dentista"), { tipo: "evento", texto: "! amanhã 9h dentista", titulo: "dentista", data: "2026-10-21", hora: "09:00" });
  assert.deepEqual([cap("! sexta 14:30 reunião").data, cap("! sexta 14:30 reunião").hora], ["2026-10-23", "14:30"]);
  assert.equal(cap("! terça academia").data, "2026-10-27", "o mesmo dia da semana é o da semana que vem");
  assert.deepEqual([cap("! dentista às 9h30 depois de amanhã").titulo, cap("! dentista às 9h30 depois de amanhã").data, cap("! dentista às 9h30 depois de amanhã").hora], ["dentista", "2026-10-22", "09:30"]);
  assert.equal(cap("! na próxima segunda-feira prova").data, "2026-10-26");
  assert.equal(cap("! 05/11 aniversário da Ana").data, "2026-11-05");
  assert.equal(cap("! 10/03 viagem").data, "2027-03-10", "sem ano e já passou: ano que vem");
  assert.equal(cap("! dia 25 consulta").data, "2026-10-25");
  assert.equal(cap("! dia 5 consulta").data, "2026-11-05");
  assert.deepEqual([cap("! lembrar do pão").data, cap("! lembrar do pão").hora], [null, null]);
});

test("'ter' (verbo) não vira terça-feira", () => {
  assert.deepEqual([cap("! ter que ligar pro banco").data, cap("! ter que ligar pro banco").titulo], [null, "ter que ligar pro banco"]);
});

test("datas inválidas não viram data", () => {
  assert.equal(extrairDataHora("31/02 nada", HOJE).data, null);
  assert.equal(extrairDataHora("às 25h", HOJE).hora, null);
});

test("sem prefixo vai pra entrada", () => {
  assert.deepEqual(cap("  ligar pro banco  "), { tipo: "entrada", texto: "ligar pro banco" });
});

test("lerValor", () => {
  assert.equal(lerValor("1.000"), 1000);
  assert.equal(lerValor("abc"), null);
});

test("lembrete (ORG-05): @ com data e hora, como evento", () => {
  assert.deepEqual(cap("@ amanhã 9h ligar pro banco"), { tipo: "lembrete", texto: "@ amanhã 9h ligar pro banco", titulo: "ligar pro banco", data: "2026-10-21", hora: "09:00" });
  assert.equal(cap("@18h remédio").hora, "18:00");
  assert.equal(cap("@ sexta pagar luz").data, "2026-10-23");
});

// P-100 — datas e horas no idioma do app (os exemplos do rodapé da captura
// de cada idioma precisam funcionar)
const em = (idioma) => (t) => interpretarCaptura(t, HOJE, idioma);
const dh = (r) => [r.titulo ?? r.descricao, r.data, r.hora ?? null];

test("inglês: tomorrow 9am, 6pm, next friday, the 25th, 10/25, 1,234.56", () => {
  const c = em("en");
  assert.deepEqual(dh(c("! tomorrow 9am dentist")), ["dentist", "2026-10-21", "09:00"]);
  assert.deepEqual(dh(c("@ 6pm medicine")), ["medicine", null, "18:00"]);
  assert.deepEqual(dh(c("! next friday at 14:30 meeting")), ["meeting", "2026-10-23", "14:30"]);
  assert.equal(c("! the day after tomorrow dinner").data, "2026-10-22");
  assert.equal(c("! on the 25th checkup").data, "2026-10-25");
  assert.equal(c("! 11/05 birthday").data, "2026-11-05", "mês primeiro");
  assert.equal(c("$ 40 groceries yesterday").data, "2026-10-19");
  assert.equal(c("$ 1,234.56 rent").valor, 1234.56);
  assert.equal(c("! sat with mom").data, null, "sat não é sábado");
});

test("espanhol, francês, italiano e alemão", () => {
  assert.deepEqual(dh(em("es")("! mañana 9h dentista")), ["dentista", "2026-10-21", "09:00"]);
  assert.deepEqual(dh(em("es")("@ 18h remedio")), ["remedio", null, "18:00"]);
  assert.equal(em("es")("! pasado mañana cita").data, "2026-10-22");
  assert.deepEqual(dh(em("es")("! el viernes a las 10 reunión")), ["reunión", "2026-10-23", "10:00"]);
  assert.deepEqual(dh(em("fr")("! demain 9h dentiste")), ["dentiste", "2026-10-21", "09:00"]);
  assert.deepEqual(dh(em("fr")("! vendredi prochain 14h30 réunion")), ["réunion", "2026-10-23", "14:30"]);
  assert.equal(em("fr")("! après-demain dîner").data, "2026-10-22");
  assert.deepEqual(dh(em("it")("! domani alle 9 dentista")), ["dentista", "2026-10-21", "09:00"]);
  assert.deepEqual(dh(em("it")("@ alle 18 medicina")), ["medicina", null, "18:00"]);
  assert.equal(em("it")("! venerdì prossimo cena").data, "2026-10-23");
  assert.deepEqual(dh(em("de")("! morgen 9 Uhr Zahnarzt")), ["Zahnarzt", "2026-10-21", "09:00"]);
  assert.deepEqual(dh(em("de")("@ 18 Uhr Medikament")), ["Medikament", null, "18:00"]);
  assert.deepEqual(dh(em("de")("! am Freitag um 14:30 Meeting")), ["Meeting", "2026-10-23", "14:30"]);
  assert.equal(em("de")("! übermorgen Termin").data, "2026-10-22");
});

test("chinês, japonês e coreano: sem espaço entre as palavras", () => {
  assert.deepEqual(dh(em("zh")("! 明天9点牙医")), ["牙医", "2026-10-21", "09:00"]);
  assert.deepEqual(dh(em("zh")("@ 下午6点半吃药")), ["吃药", null, "18:30"]);
  assert.equal(em("zh")("! 下周一开会").data, "2026-10-26");
  assert.equal(em("zh")("! 11月5日生日").data, "2026-11-05");
  assert.deepEqual(dh(em("ja")("! 明日9時歯医者")), ["歯医者", "2026-10-21", "09:00"]);
  assert.deepEqual(dh(em("ja")("@ 午後3時半 薬")), ["薬", null, "15:30"]);
  assert.equal(em("ja")("! 金曜日 会議").data, "2026-10-23");
  assert.deepEqual(dh(em("ko")("! 내일 9시 치과")), ["치과", "2026-10-21", "09:00"]);
  assert.deepEqual(dh(em("ko")("@ 오후 6시 약")), ["약", null, "18:00"]);
  assert.equal(em("ko")("! 금요일 회의").data, "2026-10-23");
});

test("hindi: कल é amanhã no evento e ontem no gasto", () => {
  assert.deepEqual(dh(em("hi")("! कल 9 बजे डेंटिस्ट")), ["डेंटिस्ट", "2026-10-21", "09:00"]);
  assert.equal(em("hi")("$ 40 खाना कल").data, "2026-10-19");
  assert.equal(em("hi")("! शुक्रवार को मीटिंग").data, "2026-10-23");
  assert.deepEqual(dh(em("hi")("@ 18 बजे दवा")), ["दवा", null, "18:00"]);
});
