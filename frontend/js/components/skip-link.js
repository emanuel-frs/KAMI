/**
 * components/skip-link.js — "pular para o conteúdo" (pendência 4).
 *
 * O `href="#page-root"` sozinho, com `tabindex="-1"` no alvo (ver
 * index.html), já move o foco em navegadores/engines modernos. O
 * listener de clique abaixo só reforça isso com um `.focus()`
 * explícito — mais seguro no WebKitGTK (motor do Tauri no Linux), que
 * historicamente tem comportamento inconsistente com foco por
 * fragmento de URL (mesmo motivo de modal-accessibility.js e
 * modal-escape.js não confiarem só no comportamento nativo de
 * `<dialog>`/Esc).
 *
 * `preventScroll: true`: o layout é de página única (sidebar fixa +
 * `#page-root`, sem scroll da página em si — cada tela rola por
 * dentro), então não tem "pular pra uma âncora" de verdade aqui; só
 * queremos o foco, sem qualquer salto visual.
 */
export function wireSkipLink() {
  const link = document.querySelector(".skip-link");
  const target = document.getElementById("page-root");
  if (!link || !target) return;

  link.addEventListener("click", (e) => {
    e.preventDefault();
    target.focus({ preventScroll: true });
  });
}
