/**
 * components/navigate.js — dispatcher fino em cima do showPage() de
 * app.js.
 *
 * app.js já importa cada tela via import() dinâmico (pages/*.js nunca
 * importam app.js de volta, pra evitar ciclo — ver comentário no topo
 * de pages/organizacao.js). Isso funcionava bem enquanto a única forma
 * de navegar de fora de app.js era simular clique no link da sidebar
 * (`document.querySelector('.nav-link[data-page="x"]').click()`), mas
 * esse atalho não tem como carregar um parâmetro junto (ex: abrir
 * Organização já na aba de e-mail, numa mensagem específica — ver
 * modals/notificacoes-modal.js).
 *
 * Em vez de toda tela que precisa navegar (calendário, modal de
 * notificações, sino da sidebar) receber showPage por callback através
 * de várias camadas, app.js registra sua própria showPage aqui uma
 * única vez no boot(), e qualquer módulo chama navigateTo(name, opts)
 * sem se importar com quem implementa de fato — mesma ideia de
 * inversão de dependência de components/tooltip.js.
 *
 * `opts` é repassado direto pro mount() da tela de destino (ver
 * assinatura de showPage em app.js); cada tela decide o que faz com
 * ele (pages/organizacao.js usa `{ tab, accountId, focusEmailId }`,
 * a maioria ignora por completo).
 */

let navigator = null;

export function registerNavigator(fn) {
  navigator = fn;
}

export function navigateTo(name, opts) {
  if (navigator) {
    navigator(name, opts);
    return;
  }
  // fallback defensivo (app.js ainda não terminou de registrar, ex:
  // chamada muito cedo no boot) — perde os `opts`, mas ainda troca de
  // tela em vez de não fazer nada.
  document.querySelector(`.nav-link[data-page="${name}"]`)?.click();
}
