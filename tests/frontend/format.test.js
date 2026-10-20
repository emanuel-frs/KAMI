import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, fmtDateBR, fmtMoney, fmtRelDate, localDateKey } from "../../frontend/js/components/format.js";

test("fmtDateBR formata datas ISO e trata valor vazio", () => {
  assert.equal(fmtDateBR("2026-09-12"), "12/09/2026");
  assert.equal(fmtDateBR(""), "—");
});

test("fmtMoney usa a formatação monetária brasileira", () => {
  assert.equal(fmtMoney(1234.5), "R$ 1.234,5");
  assert.equal(fmtMoney(12), "R$ 12");
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
