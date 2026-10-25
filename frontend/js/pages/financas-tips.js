import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { buildWidgetSteps } from "../components/widget-tips.js";
import { t } from "../i18n.js";

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

const widgetTexts = () => ({
  carteira: t("financas_tips.seus_bancos_e_contas_saldo"),
  financas_resumo: t("financas_tips.visao_rapida_quanto_voce_tem"),
  financas_renda: t("financas_tips.suas_fontes_de_renda_cadastradas"),
  financas_registros: t("financas_tips.todo_lancamento_do_mes_com"),
  financas_assinaturas: t("financas_tips.suas_assinaturas_recorrentes_e_quanto"),
  dividas: t("financas_tips.dividas_em_aberto_status_editavel"),
  contas_fixas: t("financas_tips.contas_fixas_do_mes_aluguel"),
  compras_parceladas: t("financas_tips.compras_parceladas_e_em_que"),
  financas_grafico_fluxo: t("financas_tips.entradas_contra_saidas_mes_a"),
  financas_grafico_categorias: t("financas_tips.pra_onde_seu_dinheiro_ta"),
  financas_grafico_evolucao: t("financas_tips.como_seu_saldo_mudou_ao"),
  financas_grafico_limites: t("financas_tips.quanto_do_limite_do_cartao"),
});

// financas não tem nenhum widget removable:false (diferente do profile
// em perfil) — então este passo cobre o caso em que o grid chega vazio
// (comportamento padrão pra quem nunca configurou nada aqui, ver
// comentário acima) e também reforça, pra quem já montou algo, que dá
// pra continuar adicionando.
const addWidgetStep = () => ({
  id: "adicionar-widget",
  selector: "#financas-add-widget",
  text: t("financas_tips.esse_painel_e_seu_toque"),
  advanceOn: "interact",
});

function buildSteps(container) {
  // MAN-05: contas_fixas ganhou o sino na 1.13 — texto reescrito, aparece de novo
  return [...buildWidgetSteps(container, widgetTexts(), { contas_fixas: 2 }), addWidgetStep()];
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
