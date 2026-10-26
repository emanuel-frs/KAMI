/**
 * components/global-shortcuts.js — atalhos globais de navegação e
 * descoberta (pendência 4 da lista).
 *
 * Continuação do Alt+H (ver modals/shortcuts-help-modal.js): usa o
 * mesmo registro central (components/shortcuts.js), então tudo aqui
 * aparece sozinho na lista de Alt+H — não existe texto de ajuda
 * separado pra ficar desatualizado, mesma ideia do resto do app.
 *
 * Alt+1 a Alt+9 — ir direto pra qualquer tela:
 *   Mesma ordem do menu (#nav-tree em index.html), casada por posição
 *   com PAGE_ORDER abaixo. "assistente kami" fica de fora (link
 *   desabilitado, pós-mvp, sem tela pra abrir). Usa `navigateTo` de
 *   navigate.js em vez de chamar showPage direto — esse módulo não
 *   tem (e não deveria ter) acesso a app.js, mesma regra que já vale
 *   pra calendar-notifications.js, notificacoes-modal.js etc.
 *
 *   `group: "nav"` + `shortLabel`: só pra shortcuts-help-modal.js
 *   desenhar essas 8 entradas como uma grade compacta em vez de 8
 *   linhas inteiras repetindo "ir para" — ver renderBody() lá. Não
 *   muda nada em como o atalho funciona, é só metadado de exibição.
 *
 * Alt+C — abrir configurações:
 *   Mesmo modal do botão de engrenagem na sidebar (id=btn-open-settings).
 *
 * Alt+B — focar a busca:
 *   Hoje só existe um campo de busca no app inteiro: #org-search, na
 *   tela Organização (pages/organizacao.js). "Focar a busca" navega
 *   pra lá e dá foco nele, reaproveitando o mesmo mecanismo de `opts`
 *   que o modal de notificações já usa pra abrir Organização numa
 *   aba/conta/e-mail específico (ver navigate.js) — sem caminho novo,
 *   só mais um campo em `opts` (`focusSearch`).
 *
 * Alt+Shift+N — nota rápida (ORG-01, P-51):
 *   Modal pequeno de qualquer tela (modals/nota-rapida-modal.js). Com
 *   Shift de propósito: Alt+N sozinho já é atalho de tela (aprendizado,
 *   dashboard) e, no Windows, vai ser a captura rápida (ORG-02).
 *
 * Alt+Q — captura rápida (ORG-02, P-55) em qualquer sistema; Alt+Espaço
 *   também (P-36), mas como apelido escondido da lista: no GNOME (e em
 *   outros) ele é o menu da janela e nem chega ao app. Alt+N ficou de
 *   fora porque já é "adicionar widget" nas telas de dashboard.
 *
 * Letras livres: nenhuma tela registra atalho próprio em "C" ou "B"
 * hoje (aprendizado.js usa N/E/M/T/R; dashboard.js usa N) — evitado de
 * propósito, pra essas duas letras terem sempre o mesmo efeito em
 * qualquer tela (ver shortcuts.js: atalho de tela ganha de global numa
 * colisão de tecla).
 */
import { registerGlobalShortcuts } from "./shortcuts.js";
import { navigateTo } from "./navigate.js";
import { openConfiguracoesModal } from "../modals/configuracoes-modal.js";
import { openNotaRapida } from "../modals/nota-rapida-modal.js";
import { abrirCaptura } from "./captura.js";
import { t } from "../i18n.js";

// mesma ordem visual de index.html (#nav-tree). ORG-04 (P-55): hábitos
// por último (Alt+9), pra Alt+1..8 não mudarem de tela
const PAGE_ORDER = ["perfil", "nucleo", "financas", "carreira", "aprendizado", "organizacao", "metas", "calendario", "habitos"];

// os atalhos são registrados uma vez no boot e a ajuda lê os rótulos na
// hora — por getter, pra seguirem o idioma atual
const comRotulo = (item, chave) =>
  Object.defineProperty(item, "label", { get: () => t(chave), enumerable: true });

/** Registra os atalhos globais. Chamar uma vez no boot (app.js), junto
 * de wireShortcuts()/wireShortcutsHelp(). */
export function wireGlobalShortcuts() {
  const pageShortcuts = PAGE_ORDER.map((page, i) => ({
    code: `Digit${i + 1}`,
    get label() {
      return t("paleta.ir_para", { tela: t(`nav.${page}`) });
    },
    get shortLabel() {
      return t(`nav.${page}`);
    },
    group: "nav",
    run: () => navigateTo(page),
  }));

  registerGlobalShortcuts([
    ...pageShortcuts,
    comRotulo({ code: "KeyC", run: () => openConfiguracoesModal() }, "atalhos.abrir_configuracoes"),
    comRotulo({ code: "KeyN", shift: true, run: () => openNotaRapida() }, "atalhos.nota_rapida"),
    comRotulo({ code: "KeyQ", run: () => abrirCaptura() }, "atalhos.captura"),
    comRotulo({ code: "Space", group: "apelido", run: () => abrirCaptura() }, "atalhos.captura_curta"),
    comRotulo({ code: "KeyB", run: () => navigateTo("organizacao", { focusSearch: true }) }, "atalhos.focar_busca"),
  ]);
}
