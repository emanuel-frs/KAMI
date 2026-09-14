import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, fmtDateBR, fmtMoney, fmtRelDate } from "../../frontend/js/components/format.js";

test("fmtDateBR formata datas ISO e trata valor vazio", () => {
  assert.equal(fmtDateBR("2026-09-12"), "12/09/2026");
  assert.equal(fmtDateBR(""), "—");
});

test("fmtMoney usa a formatação monetária brasileira", () => {
  assert.equal(fmtMoney(1234.5), "R$ 1.234,5");
  assert.equal(fmtMoney(12), "R$ 12");
});

test("fmtRelDate mostra horário para datas de hoje", () => {
  const date = new Date(Date.now() - 30 * 60 * 1000);
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
