/** Portado de kami_telas_final.html (fmtRelDate/fmtDateBR/fmtMoney). */

/**
 * "YYYY-MM-DD" de um Date no fuso LOCAL de quem usa. Substitui o
 * `toISOString().slice(0, 10)`, que devolve o dia em UTC — no Brasil,
 * depois das 21h isso já era "amanhã" (ex: data padrão de um lançamento).
 */
export function localDateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Datas ISO com offset ("2026-07-06T12:00:00-03:00", ver now_iso no
 * backend) -> HH:MM se for hoje, "ontem", ou "Nd atrás". A diferença é
 * em dias de CALENDÁRIO locais, não em blocos de 24h — uma ação às 23h
 * de ontem vista às 8h de hoje é "ontem", não "HH:MM".
 */
export function fmtRelDate(iso) {
  const d = new Date(iso);
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
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
  return String(str ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
