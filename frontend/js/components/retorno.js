/**
 * EST-01 (P-176/P-190): relatar um erro ou dar uma ideia, pela aba
 * "sobre" das configurações. Nada sai pelo Kami: ele só monta um link —
 * o programa de e-mail da pessoa (mailto) ou uma issue do GitHub já
 * preenchida (templates em .github/ISSUE_TEMPLATE) — e ela confere e
 * envia de lá.
 *
 * Links longos não abrem em todo lugar (o Windows corta perto de 2 mil
 * caracteres; o GitHub, perto de 8 mil). O diagnóstico perde as linhas
 * mais antigas do log até caber; se nem o texto cabe, o link vai sem o
 * corpo e a mensagem inteira volta em `copiar`, pra ir pela área de
 * transferência.
 */
export const EMAIL = "kami.feedback@gmail.com";
export const ISSUES = "https://github.com/emanuel-frs/KAMI/issues/new";
export const EMAIL_MAX = 1800;
export const GITHUB_MAX = 7000;
const MARCA_LOG = "--- ";

// cabeçalho do diagnóstico fica; o log (depois da 1ª linha "--- ") perde
// linhas do começo até `cabe(diag)`
function encurtar(diag, cabe) {
  if (!diag || cabe(diag)) return diag;
  const linhas = diag.split("\n");
  const inicio = linhas.findIndex((l) => l.startsWith(MARCA_LOG)) + 1;
  if (inicio <= 0) return "";
  const cabeca = linhas.slice(0, inicio);
  let log = linhas.slice(inicio);
  while (log.length) {
    log = log.slice(Math.max(1, Math.ceil(log.length / 10)));
    const tentativa = [...cabeca, "…", ...log].join("\n");
    if (cabe(tentativa)) return tentativa;
  }
  const soCabeca = cabeca.join("\n");
  return cabe(soCabeca) ? soCabeca : "";
}

export function titulo(texto) {
  const linha = texto.trim().split("\n")[0].trim();
  return linha.length > 60 ? `${linha.slice(0, 59)}…` : linha;
}

/** { url, copiar } — `copiar` só quando o corpo não coube no link. */
export function linkEmail({ assunto, texto, diag, separador }) {
  const montar = (corpo) =>
    `mailto:${EMAIL}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo.replace(/\r?\n/g, "\r\n"))}`;
  const corpo = (d) => (d ? `${texto}\n\n${separador}\n${d}` : texto);
  const d = encurtar(diag, (x) => montar(corpo(x)).length <= EMAIL_MAX);
  const url = montar(corpo(d));
  if (url.length <= EMAIL_MAX) return { url, copiar: null };
  return { url: `mailto:${EMAIL}?subject=${encodeURIComponent(assunto)}`, copiar: corpo(diag) };
}

/** Bug → template bug.yml (campos por id); ideia → feedback.yml. */
export function linkGithub({ tipo, texto, diag, versao, separador }) {
  const erro = tipo === "bug";
  const montar = (d) => {
    const p = new URLSearchParams({ template: erro ? "bug.yml" : "feedback.yml", title: titulo(texto) });
    if (erro) {
      p.set("versao", versao);
      p.set("o-que-aconteceu", texto);
      if (d) p.set("log", d);
    } else {
      p.set("feedback", d ? `${texto}\n\n${separador}\n${d}` : texto);
    }
    return `${ISSUES}?${p}`;
  };
  const d = encurtar(diag, (x) => montar(x).length <= GITHUB_MAX);
  const url = montar(d);
  if (url.length <= GITHUB_MAX) return { url, copiar: null };
  const p = new URLSearchParams({ template: erro ? "bug.yml" : "feedback.yml", title: titulo(texto) });
  if (erro) p.set("versao", versao);
  return { url: `${ISSUES}?${p}`, copiar: diag ? `${texto}\n\n${separador}\n${diag}` : texto };
}
