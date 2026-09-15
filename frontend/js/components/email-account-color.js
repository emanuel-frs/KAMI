/**
 * Cor consistente por account_id de e-mail (hash simples do id),
 * sem precisar de um campo novo de cor no cadastro da conta.
 *
 * Usado em dois lugares que precisam concordar visualmente sobre "qual
 * cor é a conta X": o avatar de cada e-mail em pages/organizacao.js
 * (aba e-mail) e o avatar de cada item no modal de notificações
 * (modals/notifications-modal.js) — antes só a aba e-mail tinha
 * qualquer indicação visual de conta (uma tag cheia por e-mail, além
 * de destoar do resto do sistema), e o modal de notificações não
 * diferenciava nada. Centralizar aqui garante que os dois lugares
 * pintam o mesmo account_id com a mesma cor, sem duplicar a função.
 */
export function emailAccountColor(accountId) {
  let hash = 0;
  const str = accountId || "";
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 60%)`;
}
