/** Portado de kami_telas_final.html (fmtRelDate/fmtDateBR/fmtMoney). */

/** Datas ISO ("2026-07-06T12:00:00") -> "há X" relativo, ou HH:MM se for hoje. */
export function fmtRelDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (diffDays <= 0) return `${hh}:${mm}`;
  if (diffDays === 1) return "ontem";
  return `${diffDays}d atrás`;
}

/** Datas "YYYY-MM-DD" -> "DD/MM/YYYY". */
export function fmtDateBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function fmtMoney(v) {
  return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Escapa texto livre (descrições, títulos) antes de inserir via innerHTML. */
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
