/**
 * Listener global (window) amarrado à vida de um widget.
 *
 * Widgets escutam eventos globais (`kami:action-registered`,
 * `kami:wallet-changed`...) pra se atualizar quando outro widget grava
 * algo. O grid (widgets/grid.js) recria o card inteiro a cada mudança
 * de layout e chama render() de novo num elemento NOVO — o listener do
 * render anterior ficava preso no window pra sempre, apontando pra um
 * elemento que já saiu da tela. Depois de algumas reorganizações do
 * dashboard, uma única ação disparava N recargas (e N requisições) em
 * elementos invisíveis.
 *
 * `listenWhileConnected(el, type, handler)` registra o listener e, a
 * cada disparo, confere se `el` ainda está no documento: se não está,
 * remove o próprio listener e não chama o handler. Não precisa de hook
 * de "unmount" (o grid não tem um) — a limpeza acontece no primeiro
 * evento depois que o widget some.
 */
export function listenWhileConnected(el, type, handler) {
  function wrapped(event) {
    if (!el.isConnected) {
      window.removeEventListener(type, wrapped);
      return;
    }
    handler(event);
  }
  window.addEventListener(type, wrapped);
  return () => window.removeEventListener(type, wrapped);
}
