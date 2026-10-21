/**
 * components/campos-data.js — campo de data vazio parece vazio (ORG-07).
 *
 * Os campos de data são os nativos (P-71). No WebKitGTK (Linux) um campo
 * VAZIO mostra a data de hoje só um pouco mais apagada — num campo
 * opcional ("fim — em branco = atual") isso parece preenchido. Aqui o
 * campo vazio ganha `data-vazio`, e o CSS (forms.css) esconde o texto
 * enquanto ele não está em foco. Com foco a máscara volta pra digitar.
 *
 * O valor muda por digitação (input/change) ou pelo script que abre o
 * formulário (`.value = …`, sem evento) — por isso também resincroniza
 * quando um modal abre (classe "open") e no foco/saída do campo.
 */

const SEL = 'input[type="date"]';

function sincronizar(el) {
  el.toggleAttribute("data-vazio", !el.value);
}

function sincronizarDentro(raiz) {
  raiz.querySelectorAll?.(SEL).forEach(sincronizar);
}

export function wireCamposData() {
  const aoMudar = (e) => {
    if (e.target?.matches?.(SEL)) sincronizar(e.target);
  };
  ["input", "change", "focusin", "focusout"].forEach((t) => document.addEventListener(t, aoMudar, true));
  new MutationObserver((mudancas) => {
    for (const m of mudancas) {
      if (m.type === "attributes" && m.target.classList?.contains("open")) sincronizarDentro(m.target);
      else if (m.type === "childList") m.addedNodes.forEach((n) => n.nodeType === 1 && sincronizarDentro(n.matches?.(SEL) ? n.parentNode : n));
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  sincronizarDentro(document);
}
