import { icon } from "../components/icons.js";
import { t } from "../i18n.js";

/**
 * Modal de instruções dos atalhos de teclado do grid de widgets
 * (reordenação sem mouse — ver widgets/grid.js).
 *
 * Segue o mesmo padrão singleton dos demais modais (ver confirm-modal.js):
 * DOM construído uma vez, reaproveitado depois. Usa exatamente o mesmo
 * markup `.modal-backdrop` > `.modal` que todo o resto do app — isso
 * basta pra ganhar de graça, via components/modal-accessibility.js e
 * components/modal-escape.js (já ligados globalmente em app.js, reagem
 * a QUALQUER `.modal-backdrop` que apareça no DOM, não só aos que já
 * existiam no boot):
 *   - role="dialog" + aria-modal + aria-labelledby
 *   - foco preso quando o próprio modal está aberto (Tab/Shift+Tab não escapam)
 *   - foco devolvido pro elemento que abriu o modal ao fechar
 *   - fechar com Esc
 * Ou seja: nenhuma outra parte do app precisa saber que esse modal
 * existe além de quem chama openWidgetShortcutsModal() (grid.js).
 */

let modalEl = null;

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "widget-shortcuts-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span class="modal-head-title">${t("atalhos_grid.titulo")}</span>
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="modal-body">
        <p class="em-message wg-shortcuts-intro">
          ${t("atalhos_grid.intro")}
        </p>
        <dl class="wg-shortcuts-list">
          <div class="wg-shortcuts-row">
            <dt><kbd>&larr;</kbd> <kbd>&rarr;</kbd> <kbd>&uarr;</kbd> <kbd>&darr;</kbd></dt>
            <dd>${t("atalhos_grid.trocar")}</dd>
          </div>
          <div class="wg-shortcuts-row">
            <dt><kbd>Enter</kbd></dt>
            <dd>${t("atalhos_grid.selecionar")}</dd>
          </div>
          <div class="wg-shortcuts-row">
            <dt><kbd>&larr;</kbd> <kbd>&rarr;</kbd> <kbd>&uarr;</kbd> <kbd>&darr;</kbd></dt>
            <dd>${t("atalhos_grid.mover")}</dd>
          </div>
          <div class="wg-shortcuts-row">
            <dt><kbd>Shift</kbd> + <kbd>&larr;</kbd> <kbd>&rarr;</kbd></dt>
            <dd>${t("atalhos_grid.largura")}</dd>
          </div>
          <div class="wg-shortcuts-row">
            <dt><kbd>Shift</kbd> + <kbd>&uarr;</kbd> <kbd>&darr;</kbd></dt>
            <dd>${t("atalhos_grid.altura")}</dd>
          </div>
          <div class="wg-shortcuts-row">
            <dt><kbd>Enter</kbd></dt>
            <dd>${t("atalhos_grid.salvar")}</dd>
          </div>
          <div class="wg-shortcuts-row">
            <dt><kbd>Esc</kbd></dt>
            <dd>${t("atalhos_grid.sair")}</dd>
          </div>
          <div class="wg-shortcuts-row">
            <dt><kbd>?</kbd></dt>
            <dd>${t("atalhos_grid.abrir")}</dd>
          </div>
        </dl>
        <p class="em-message wg-shortcuts-note">
          ${t("atalhos_grid.nota")}
        </p>
        <div class="form-actions">
          <button class="btn sm primary" data-action="close">${t("geral.entendi")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelectorAll('[data-action="close"]').forEach((el) =>
    el.addEventListener("click", () => close())
  );
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });

  return wrap;
}

function close() {
  modalEl?.classList.remove("open");
}

export function openWidgetShortcutsModal() {
  // refeito a cada abertura: sai no idioma atual
  modalEl?.remove();
  modalEl = buildModal();
  modalEl.classList.add("open");
}
