import { escapeHtml } from "../components/format.js";
import { icon } from "../components/icons.js";
import { getShortcuts, comboParts, registerGlobalShortcuts } from "../components/shortcuts.js";
import { noIdiomaAtual, t } from "../i18n.js";

/**
 * Lista de atalhos de teclado — globais + da tela atual.
 *
 * O conteúdo é montado a cada abertura a partir do registro
 * (components/shortcuts.js), não escrito à mão: o que aparece aqui é
 * exatamente o que está ligado naquele momento.
 *
 * Mesmo padrão do widget-shortcuts-modal.js: `.modal-backdrop` > `.modal`,
 * o que já garante de graça role="dialog", foco preso, foco devolvido e
 * Esc (modal-accessibility.js / modal-escape.js).
 *
 * Abre por: Alt+H (global), menu de ajuda da sidebar ("atalhos de teclado").
 */

let modalEl = null;

// Teclas que já funcionam em qualquer tela por padrão do navegador ou do
// próprio app — vale listar porque quem usa só teclado precisa saber.
const generalHints = () => [
  { combos: [["Tab"], ["Shift", "Tab"]], label: t("shortcuts_help.avancar_voltar_entre_os_controles") },
  { combos: [["Enter"], [t("shortcuts_help.espaco")]], label: t("shortcuts_help.ativar_o_botao_ou_item") },
  { combos: [["Esc"]], label: t("shortcuts_help.fechar_a_janela_aberta_ou") },
];

function kbd(parts) {
  return parts.map((p) => `<kbd>${escapeHtml(p)}</kbd>`).join(" + ");
}

function row(keysHtml, label) {
  return `<div class="wg-shortcuts-row"><dt>${keysHtml}</dt><dd>${escapeHtml(label)}</dd></div>`;
}

function navItem(a) {
  return `<div class="ks-nav-item"><span class="ks-nav-keys">${kbd(comboParts(a))}</span><span class="ks-nav-label">${escapeHtml(a.shortLabel || a.label)}</span></div>`;
}

function renderBody() {
  const { screen, global } = getShortcuts();
  const hasScreen = !!(screen && (screen.actions.length || screen.hints.length));

  // Duas colunas (tela atual | em qualquer tela): a lista inteira numa
  // coluna só passava da altura de uma janela 1366×768 — ver help-menu.css.
  // Tela sem atalhos próprios: some a coluna da esquerda (não faz sentido
  // reservar metade do modal pra uma frase) e o modal fica mais estreito.
  let left = "";
  if (hasScreen) {
    left += `<h3 class="ks-section">${escapeHtml(t("atalhos.nesta_tela", { tela: screen.name }))}</h3><dl class="wg-shortcuts-list">`;
    screen.actions.forEach((a) => {
      left += row(kbd(comboParts(a)), a.label);
    });
    screen.hints.forEach((h) => {
      left += row(h.combos.map(kbd).join(" <span class=\"ks-or\">ou</span> "), h.label);
    });
    left += `</dl>`;
  }

  // Atalhos globais "de ação" (cada um faz uma coisa diferente) e os de
  // navegação entre telas (Alt+1..9: mesmo padrão repetido 9 vezes)
  // ficam em blocos separados — 8 linhas inteiras dizendo "ir para X"
  // eram a parte mais cansativa de escanear da lista inteira. A grade
  // compacta abaixo cabe em metade do espaço vertical de 8 linhas
  // `.wg-shortcuts-row` e o "ir para" comum já está no título da seção,
  // então cada item mostra só o nome da tela.
  // "apelido": mesma ação de outro atalho já listado (ex.: Alt+Espaço = Alt+Q)
  const actions = global.filter((a) => a.group !== "nav" && a.group !== "apelido");
  const navShortcuts = global.filter((a) => a.group === "nav");

  let right = `<h3 class="ks-section">${t("shortcuts_help.em_qualquer_tela")}</h3><dl class="wg-shortcuts-list">`;
  // ORG-03: a paleta não é Alt+tecla (fica fora do registro de shortcuts.js)
  right += row(kbd(["Ctrl", "K"]), t("shortcuts_help.buscar_em_tudo_e_rodar"));
  actions.forEach((a) => {
    right += row(kbd(comboParts(a)), a.label);
  });
  right += `</dl>`;

  if (navShortcuts.length) {
    right += `<h4 class="ks-subsection">${t("shortcuts_help.ir_para_uma_tela")}</h4>`;
    right += `<div class="ks-nav-grid">${navShortcuts.map(navItem).join("")}</div>`;
  }

  right += `<dl class="wg-shortcuts-list ks-hints-list">`;
  generalHints().forEach((h) => {
    right += row(h.combos.map(kbd).join(" <span class=\"ks-or\">ou</span> "), h.label);
  });
  right += `</dl>`;

  const note = `<p class="em-message wg-shortcuts-note">${t("shortcuts_help.os_atalhos_de_acao_usam")}</p>`;

  const html = `<div class="ks-cols">${hasScreen ? `<div class="ks-col">${left}</div>` : ""}<div class="ks-col">${right}</div></div>${note}`;
  return { html, hasScreen };
}

function close() {
  modalEl?.classList.remove("open");
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "shortcuts-help-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span class="modal-head-title">${t("shortcuts_help.atalhos_de_teclado")}</span>
        <button type="button" class="close" data-action="close" aria-label="${t("geral.fechar")}">${icon("x")}</button>
      </div>
      <div class="modal-body">
        <!-- a lista rola sozinha quando a janela é baixa (cabeçalho e botão
             ficam fixos). tabindex=0: nem todo webview deixa quem usa só
             teclado rolar uma área sem foco. -->
        <div id="shortcuts-help-body" class="ks-scroll" tabindex="0" role="region" aria-label="${t("shortcuts_help.lista_de_atalhos")}"></div>
        <div class="form-actions">
          <button type="button" class="btn sm primary" data-action="close" data-autofocus>${t("geral.entendi")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelectorAll('[data-action="close"]').forEach((el) => el.addEventListener("click", close));
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  return wrap;
}

export function openShortcutsHelp() {
  modalEl = noIdiomaAtual(modalEl, buildModal);
  const bodyEl = modalEl.querySelector("#shortcuts-help-body");
  const { html, hasScreen } = renderBody();
  bodyEl.innerHTML = html;
  // refeito a cada abertura: a tela atual pode ter mudado desde a última vez
  modalEl.querySelector(".modal").classList.toggle("ks-single", !hasScreen);
  modalEl.classList.add("open");
  // depois do "open": com display:none a atribuição é ignorada e a lista
  // reabriria rolada onde o usuário parou da última vez.
  bodyEl.scrollTop = 0;
}

/** Registra o atalho global Alt+H. Chamar uma vez no boot (app.js). */
export function wireShortcutsHelp() {
  registerGlobalShortcuts([
    {
      code: "KeyH",
      // getter: registrado uma vez no boot, lido no idioma atual
      get label() {
        return t("shortcuts_help.abrir_esta_lista_de_atalhos");
      },
      run: () => openShortcutsHelp(),
    },
  ]);
}
