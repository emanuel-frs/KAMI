import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { buildWidgetSteps } from "../components/widget-tips.js";

/**
 * Dicas contextuais de Finanças (etapa 5,
 * seção 8 item 5). Terceira tela — agora com um layout padrão mínimo
 * (DEFAULT_LAYOUTS tem uma entrada "financas" em database.py com os
 * widgets carteira/financas_resumo/financas_registros), mas o usuário
 * pode remover tudo manualmente e chegar aqui com o grid vazio, então o
 * fallback abaixo continua útil.
 *
 * Isso muda o papel do passo "adicionar widget" em relação ao Núcleo/
 * Perfil: lá ele é só um extra no fim ("esse painel também é seu").
 * Aqui, se o grid estiver vazio na primeira visita — hoje um caso raro,
 * já que o layout padrão pré-popula a tela, mas ainda possível se o
 * usuário remover tudo —, ele é o ÚNICO passo que existe (buildWidgetSteps
 * não gera nada pra varrer, já que não há nenhum `.card[data-widget]` no
 * DOM ainda). Sem ele, quem chegasse com a tela vazia veria a sequência
 * inteira terminar sem mostrar nada (ver startTipSequence em
 * tip-sequence.js: `resolved.length === 0` chama onFinish() direto) e a
 * tela ficaria marcada como "vista" sem nunca ter ensinado nada — daí ele
 * ser obrigatório aqui, diferente de ser só um nice-to-have.
 */
const SCREEN = "financas";

const WIDGET_TEXTS = {
  carteira: "seus bancos e contas — saldo, cartão de crédito, o que cada um tiver.",
  financas_resumo: "visão rápida: quanto você tem versus quanto ainda precisa pagar.",
  financas_renda: "suas fontes de renda cadastradas — marque como paga quando cair na conta.",
  financas_registros: "todo lançamento do mês, com filtro por conta e por status.",
  financas_assinaturas: "suas assinaturas recorrentes e quanto elas somam no mês.",
  dividas: "dívidas em aberto — status editável direto aqui, sem abrir nada.",
  contas_fixas: "contas fixas do mês — aluguel, internet, esse tipo de coisa. o sino de cada uma cria um lembrete pra pagar.",
  compras_parceladas: "compras parceladas e em que parcela cada uma está.",
  financas_grafico_fluxo: "entradas contra saídas, mês a mês.",
  financas_grafico_categorias: "pra onde seu dinheiro tá indo, por categoria.",
  financas_grafico_evolucao: "como seu saldo mudou ao longo do tempo.",
  financas_grafico_limites: "quanto do limite do cartão já foi usado.",
};

// financas não tem nenhum widget removable:false (diferente do profile
// em perfil) — então este passo cobre o caso em que o grid chega vazio
// (comportamento padrão pra quem nunca configurou nada aqui, ver
// comentário acima) e também reforça, pra quem já montou algo, que dá
// pra continuar adicionando.
const ADD_WIDGET_STEP = {
  id: "adicionar-widget",
  selector: "#financas-add-widget",
  text: "esse painel é seu: toque aqui pra adicionar ou tirar widgets.",
  advanceOn: "interact",
};

function buildSteps(container) {
  // MAN-05: contas_fixas ganhou o sino na 1.13 — texto reescrito, aparece de novo
  return [...buildWidgetSteps(container, WIDGET_TEXTS, { contas_fixas: 2 }), ADD_WIDGET_STEP];
}

let running = false;

/**
 * Replay manual — registrado em screen-tips-registry.js por
 * financas.js, chamado pelo botão de ajuda global ("rever dicas desta
 * tela") estando em Finanças. Roda incondicionalmente, não marca como
 * visto.
 */
export function replayFinancasTips(grid, container) {
  if (running) return;
  running = true;
  grid?.lockForTips();
  startTipSequence(buildSteps(container), {
    onFinish: () => {
      grid?.unlockForTips();
      running = false;
    },
  });
}

// MAN-05: ids das dicas que já existiam até a 1.12 — quem viu esta tela
// antes da 1.14 não as vê de novo (components/dicas-novas.js). Dica nova
// ou reescrita (id com "-2") fica FORA desta lista.
const ATE_1_12 = [
  "widget-carteira",
  "widget-financas_resumo",
  "widget-financas_renda",
  "widget-financas_registros",
  "widget-financas_assinaturas",
  "widget-dividas",
  "widget-compras_parceladas",
  "widget-financas_grafico_fluxo",
  "widget-financas_grafico_categorias",
  "widget-financas_grafico_evolucao",
  "widget-financas_grafico_limites",
  "adicionar-widget",
];

/**
 * Ao abrir a tela, mostra as dicas que a pessoa ainda não viu (todas, na
 * primeira vez; só as novas, com o rótulo "novidade", depois) — regras
 * em components/dicas-novas.js. Seguro de chamar várias vezes (mount e
 * store.subscribe do perfil, pra rodar logo depois do tour geral).
 */
export function maybeStartFinancasTips(grid, container) {
  return mostrarDicasNovas({
    tela: SCREEN,
    passos: () => buildSteps(container),
    ate112: ATE_1_12,
    antes: () => grid?.lockForTips(),
    depois: () => grid?.unlockForTips(),
  });
}
