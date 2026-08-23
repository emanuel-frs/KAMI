/**
 * Gera os passos de uma sequência de dicas contextuais (etapa 5,
 * plano-onboarding-kami.md) A PARTIR do que está de fato no grid da
 * tela agora — em vez de uma lista fixa de seletores escrita à mão.
 *
 * Por quê: uma lista fixa (o que nucleo-tips.js fazia antes) presume
 * que os widgets "esperados" sempre estarão lá. Isso quebra em telas
 * como finanças, que começam totalmente vazias (nenhum widget é
 * seedado por padrão) — o usuário monta o grid do zero pelo catálogo,
 * então não existe um "layout padrão" pra apontar de antemão. Lendo o
 * DOM na hora, a sequência sempre reflete o grid real de quem está
 * vendo, tenha ele 1 widget ou 6.
 *
 * `textsByType` é o único lugar que ainda é escrito à mão por tela —
 * o texto de cada dica continua uma decisão de conteúdo (seção 10 do
 * plano: "ainda não definido, fica pra depois"), só que agora indexado
 * por widget_type em vez de amarrado a um seletor de posição fixa.
 * Widget presente na tela mas sem entrada em `textsByType` (widget
 * novo, ou tela ainda não revisada) => nenhum passo é gerado pra ele —
 * silenciosamente ignorado, não um texto genérico de preenchimento.
 *
 * A ordem dos passos segue a ordem dos cards no DOM (ordem real do
 * grid), não a ordem das chaves de `textsByType`.
 */
export function buildWidgetSteps(container, textsByType) {
  const cards = container.querySelectorAll(".card[data-widget]");
  const steps = [];
  cards.forEach((card) => {
    const type = card.dataset.widget;
    const text = textsByType[type];
    if (!text) return;
    steps.push({ selector: `.card[data-widget="${type}"]`, text });
  });
  return steps;
}
