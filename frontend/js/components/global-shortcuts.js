/**
 * components/global-shortcuts.js — atalhos globais de navegação e
 * descoberta (pendência 4 da lista).
 *
 * Continuação do Alt+H (ver modals/shortcuts-help-modal.js): usa o
 * mesmo registro central (components/shortcuts.js), então tudo aqui
 * aparece sozinho na lista de Alt+H — não existe texto de ajuda
 * separado pra ficar desatualizado, mesma ideia do resto do app.
 *
 * Alt+1 a Alt+8 — ir direto pra qualquer tela:
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
 * Letras livres: nenhuma tela registra atalho próprio em "C" ou "B"
 * hoje (aprendizado.js usa N/E/M/T/R; dashboard.js usa N) — evitado de
 * propósito, pra essas duas letras terem sempre o mesmo efeito em
 * qualquer tela (ver shortcuts.js: atalho de tela ganha de global numa
 * colisão de tecla).
 */
import { registerGlobalShortcuts } from "./shortcuts.js";
import { navigateTo } from "./navigate.js";
import { openConfiguracoesModal } from "../modals/configuracoes-modal.js";

// mesma ordem visual de index.html (#nav-tree).
const PAGE_ORDER = [
  { page: "perfil", label: "ir para perfil", shortLabel: "perfil" },
  { page: "nucleo", label: "ir para núcleo", shortLabel: "núcleo" },
  { page: "financas", label: "ir para finanças", shortLabel: "finanças" },
  { page: "carreira", label: "ir para carreira", shortLabel: "carreira" },
  { page: "aprendizado", label: "ir para aprendizado", shortLabel: "aprendizado" },
  { page: "organizacao", label: "ir para organização", shortLabel: "organização" },
  { page: "metas", label: "ir para metas pessoais", shortLabel: "metas pessoais" },
  { page: "calendario", label: "ir para calendário", shortLabel: "calendário" },
];

/** Registra os atalhos globais. Chamar uma vez no boot (app.js), junto
 * de wireShortcuts()/wireShortcutsHelp(). */
export function wireGlobalShortcuts() {
  const pageShortcuts = PAGE_ORDER.map(({ page, label, shortLabel }, i) => ({
    code: `Digit${i + 1}`,
    label,
    shortLabel,
    group: "nav",
    run: () => navigateTo(page),
  }));

  registerGlobalShortcuts([
    ...pageShortcuts,
    { code: "KeyC", label: "abrir configurações", run: () => openConfiguracoesModal() },
    {
      code: "KeyB",
      label: "focar a busca (tela organização)",
      run: () => navigateTo("organizacao", { focusSearch: true }),
    },
  ]);
}
