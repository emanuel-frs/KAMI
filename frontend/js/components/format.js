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

// ── datas (ORG-07, P-53) ───────────────────────────────────────────────
// Um formatador só pra toda data numérica do app. A ordem vem de
// configurações › aparência › formato das datas: "sistema" (padrão — segue
// o idioma do sistema: dd/mm/aaaa no Brasil, mm/dd/aaaa nos EUA…), "dma",
// "mda" ou "iso" (aaaa-mm-dd). app.js chama definirFormatoData() com o
// perfil no boot e quando ele muda. Os campos de data dos formulários são
// os nativos (P-71) e seguem o sistema sozinhos. Nome de mês por extenso
// ("outubro 2026", "out/26") não depende da ordem e fica fora daqui.

const FORMATOS = ["dma", "mda", "iso"];
let preferencia = "sistema";
let doSistema = null;

/** @param {"sistema"|"dma"|"mda"|"iso"} formato */
export function definirFormatoData(formato) {
  preferencia = FORMATOS.includes(formato) ? formato : "sistema";
}

/** A ordem do idioma do sistema, pela ordem das partes no Intl. */
function ordemDoSistema() {
  if (doSistema) return doSistema;
  try {
    const idioma = (typeof navigator !== "undefined" && navigator.language) || "pt-BR";
    const partes = new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "2-digit", year: "numeric" })
      .formatToParts(new Date(2026, 9, 21))
      .filter((p) => p.type !== "literal")
      .map((p) => p.type[0])
      .join("");
    doSistema = partes === "mdy" ? "mda" : partes === "ymd" ? "iso" : "dma";
  } catch {
    doSistema = "dma";
  }
  return doSistema;
}

/** A ordem em uso agora: "dma" | "mda" | "iso". */
export function formatoData() {
  return preferencia === "sistema" ? ordemDoSistema() : preferencia;
}

function partesIso(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return { y, m, d };
}

/** "2026-10-21" (ou ISO com hora) -> "21/10/2026" | "10/21/2026" | "2026-10-21". */
export function fmtData(iso) {
  return fmtDataNoFormato(iso, formatoData());
}

/** fmtData num formato dado (os exemplos de configurações). */
export function fmtDataNoFormato(iso, formato) {
  if (!iso) return "—";
  const { y, m, d } = partesIso(iso);
  const f = formato === "sistema" ? ordemDoSistema() : formato;
  if (f === "iso") return `${y}-${m}-${d}`;
  return f === "mda" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

/** Dia e mês, sem ano: "21/10" | "10/21" | "10-21". */
export function fmtDataCurta(iso) {
  if (!iso) return "—";
  const { m, d } = partesIso(iso);
  const f = formatoData();
  if (f === "iso") return `${m}-${d}`;
  return f === "mda" ? `${m}/${d}` : `${d}/${m}`;
}

/** Sem o ano quando é o ano corrente: "21/10" ou "21/10/2025". */
export function fmtDataCompacta(iso, hoje = new Date()) {
  if (!iso) return "—";
  return partesIso(iso).y === String(hoje.getFullYear()) ? fmtDataCurta(iso) : fmtData(iso);
}

/** "2026-10" -> "10/2026" | "10/2026" | "2026-10". */
export function fmtMesAno(mesIso) {
  if (!mesIso) return "—";
  const [y, m] = String(mesIso).slice(0, 7).split("-");
  return formatoData() === "iso" ? `${y}-${m}` : `${m}/${y}`;
}

/** O contrário de fmtMesAno, pros campos de mês digitados: "10/2026",
 * "10-2026", "2026-10" ou "2026/10" -> "2026-10" (null se não der). */
export function lerMesAno(texto) {
  const t = String(texto || "").trim();
  let m = /^(\d{1,2})[/-](\d{4})$/.exec(t);
  let y;
  let mes;
  if (m) [, mes, y] = m;
  else if ((m = /^(\d{4})[/-](\d{1,2})$/.exec(t))) [, y, mes] = m;
  else return null;
  const n = Number(mes);
  return n >= 1 && n <= 12 ? `${y}-${String(n).padStart(2, "0")}` : null;
}

/** Data e hora de um timestamp ISO: "21/10/2026 14:30". */
export function fmtDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtData(localDateKey(d))} ${hh}:${mm}`;
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
