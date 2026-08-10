/**
 * Fecha o modal aberto com Esc — item 2 da revisão de UX (nenhum dos
 * ~13 modais fechava com teclado, só clique no X ou no backdrop).
 *
 * Genérico de propósito: em vez de importar/chamar a close() de cada
 * modal (13+ arquivos, cada um com seu próprio módulo singleton),
 * aproveita que todos seguem o mesmo padrão de markup (decisão 18,
 * ver base.css) — `.modal-backdrop.open` com um elemento
 * `[data-action="close"]` ou `[data-action="cancel"]` (confirm-modal.js
 * é o único que usa "cancel") já com o listener de fechar correto
 * amarrado nele. Clicar nesse elemento reaproveita a lógica de cada
 * modal (inclusive efeitos colaterais como onboarding-modal.js marcar
 * onboarding_completed ao fechar antes do fim) em vez de duplicá-la
 * aqui.
 *
 * kami-intro.js (`.ki-backdrop`, fluxo obrigatório de primeiro boot,
 * sem botão de fechar) e help-menu.js (`.help-menu-pop`, popover, não
 * modal) usam classes diferentes de propósito — não batem no seletor
 * abaixo, então Esc não afeta nenhum dos dois. Certo: nenhum dos dois
 * deveria ser fechável assim.
 *
 * Modais empilhados (ex.: settings-modal.js abre showConfirmModal por
 * cima de si mesmo no fluxo de import/reset) são tratados corretamente
 * porque o confirm-modal é construído sob demanda e só entra no DOM
 * (logo, só vira o último `.modal-backdrop.open` em ordem de pintura)
 * quando de fato aberto — pegar o último elemento fecha o modal do
 * topo, não o de baixo.
 *
 * Seletor do botão de fechar usa `^=` (começa com) em vez de igualdade
 * exata: os modais em modals/*.js, metas.js e aprendizado.js usam
 * data-action="close" genérico, mas os 6 modais embutidos direto na
 * página de Organização (link, repo, conta de e-mail, e-mail, chave de
 * busca, token do github) usam um nome por modal — "close-link-modal",
 * "close-account-modal" etc. — porque todos vivem juntos na mesma
 * página e "close" sozinho seria ambíguo entre eles. `^="close"` cobre
 * os dois padrões sem precisar tocar em nenhum dos dois lados.
 *
 * Registrado em fase de captura (capture: true) de propósito: o
 * dropdown de custom-select.js (components/custom-select.js) também
 * escuta Esc no document pra fechar `.csel.open`, mas em fase de bolha
 * (padrão). Capture garante que este handler roda primeiro e vê o
 * estado real do dropdown antes dele se fechar — se um dropdown
 * dentro do modal estiver aberto, este Esc só fecha o dropdown (deixa
 * pro handler do custom-select, que roda depois), sem fechar o modal
 * junto no mesmo aperto de tecla.
 */
export function wireModalEscapeClose() {
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".csel.open")) return;

      const openModals = document.querySelectorAll(".modal-backdrop.open");
      if (openModals.length === 0) return;

      const topmost = openModals[openModals.length - 1];
      const closeEl = topmost.querySelector('[data-action^="close"], [data-action="cancel"]');
      closeEl?.click();
    },
    { capture: true },
  );
}
