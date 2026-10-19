/**
 * Copiar texto pra área de transferência, com plano B.
 *
 * O WebKitGTK (app no Linux) às vezes nega navigator.clipboard sem
 * permissão explícita — aí cai no jeito antigo (textarea escondido +
 * execCommand("copy")). Devolve true se copiou.
 *
 * Usado pelo "copiar detalhes" do aviso de erro (error-notice.js, CONF-01)
 * e pelo "copiar diagnóstico" das configurações (CONF-06).
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
