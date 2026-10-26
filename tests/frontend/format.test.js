import test from "node:test";
import assert from "node:assert/strict";
import {
  definirFormatoData, escapeHtml, fmtData, fmtDataCompacta, fmtDataCurta, fmtDataHora, fmtDataNoFormato,
  fmtMesAno, fmtMoney, fmtRelDate, lerMesAno, localDateKey,
} from "../../frontend/js/components/format.js";

// ORG-07 (P-53): um formatador só, no formato escolhido em configurações
test("fmtData segue o formato escolhido e trata valor vazio", (t) => {
  t.after(() => definirFormatoData("sistema"));
  definirFormatoData("dma");
  assert.equal(fmtData("2026-09-12"), "12/09/2026");
  assert.equal(fmtData("2026-09-12T08:30:00-03:00"), "12/09/2026");
  assert.equal(fmtData(""), "—");
  assert.equal(fmtDataCurta("2026-09-12"), "12/09");
  definirFormatoData("mda");
  assert.equal(fmtData("2026-09-12"), "09/12/2026");
  assert.equal(fmtDataCurta("2026-09-12"), "09/12");
  assert.equal(fmtMesAno("2026-09"), "09/2026");
  definirFormatoData("iso");
  assert.equal(fmtData("2026-09-12"), "2026-09-12");
  assert.equal(fmtDataCurta("2026-09-12"), "09-12");
  assert.equal(fmtMesAno("2026-09"), "2026-09");
  definirFormatoData("qualquer"); // valor desconhecido volta pro do sistema
  assert.equal(fmtData("2026-10-21"), fmtDataNoFormato("2026-10-21", "sistema"));
});

test("o formato do sistema vem da ordem das partes do idioma", () => {
  // o Node daqui tem algum idioma; o que importa é a ordem bater com o Intl
  const esperado = new Intl.DateTimeFormat(navigator.language, { day: "2-digit", month: "2-digit", year: "numeric" })
    .formatToParts(new Date(2026, 9, 21)).filter((p) => p.type !== "literal").map((p) => p.type[0]).join("");
  const mapa = { dmy: "21/10/2026", mdy: "10/21/2026", ymd: "2026-10-21" };
  assert.equal(fmtDataNoFormato("2026-10-21", "sistema"), mapa[esperado]);
});

test("fmtDataCompacta tira o ano do ano corrente; fmtDataHora junta a hora", (t) => {
  t.after(() => definirFormatoData("sistema"));
  definirFormatoData("dma");
  const hoje = new Date(2026, 9, 21);
  assert.equal(fmtDataCompacta("2026-03-05", hoje), "05/03");
  assert.equal(fmtDataCompacta("2025-03-05", hoje), "05/03/2025");
  assert.equal(fmtDataHora("2026-10-21T14:05:00"), "21/10/2026 14:05");
  assert.equal(fmtDataHora("lixo"), "—");
});

test("lerMesAno aceita mm/aaaa e aaaa-mm", () => {
  assert.equal(lerMesAno("10/2026"), "2026-10");
  assert.equal(lerMesAno("3-2026"), "2026-03");
  assert.equal(lerMesAno("2026-10"), "2026-10");
  assert.equal(lerMesAno("13/2026"), null);
  assert.equal(lerMesAno("outubro"), null);
});

test("fmtMoney usa a formatação monetária brasileira", () => {
  // o Intl separa o símbolo com espaço não separável (não quebra a linha ali)
  assert.equal(fmtMoney(1234.5), "R$\u00a01.234,5");
  assert.equal(fmtMoney(12), "R$\u00a012");
});

// "X minutos atrás", mas sem passar da meia-noite: rodando logo depois
// das 00:00 o "30 min atrás" virava ontem e o teste falhava (visto no CI)
function hojeHaMinutos(min) {
  const agora = new Date();
  const inicioDoDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  return new Date(Math.max(agora.getTime() - min * 60 * 1000, inicioDoDia.getTime()));
}

test("fmtRelDate mostra horário para datas de hoje", () => {
  const date = hojeHaMinutos(30);
  const expected = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  assert.equal(fmtRelDate(date.toISOString()), expected);
});

test("fmtRelDate mostra dias decorridos", () => {
  const date = new Date(Date.now() - 3 * 86400000);
  assert.equal(fmtRelDate(date.toISOString()), "3d atrás");
});

test("escapeHtml transforma texto potencialmente executável em texto seguro", () => {
  const escaped = escapeHtml("<script>alert('xss')</script>");
  assert.equal(escaped, "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  assert.doesNotMatch(escaped, /<script>/i);
});

test("fmtRelDate conta dias de calendário, não blocos de 24h", () => {
  const now = new Date();
  const lateYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59);
  assert.equal(fmtRelDate(lateYesterday.toISOString()), "ontem");
});

test("fmtRelDate interpreta o offset gravado pelo backend", () => {
  const date = hojeHaMinutos(10);
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  const local =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00` +
    `${sign}${pad(Math.trunc(offsetMin / 60))}:${pad(offsetMin % 60)}`;
  assert.equal(fmtRelDate(local), `${pad(date.getHours())}:${pad(date.getMinutes())}`);
});

test("localDateKey usa o dia local, não o dia em UTC", () => {
  assert.equal(localDateKey(new Date(2026, 9, 7, 23, 30)), "2026-10-07");
  assert.equal(localDateKey(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});
