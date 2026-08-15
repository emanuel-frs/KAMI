import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";
import { buildWidgetSteps } from "../components/widget-tips.js";

/**
 * Dicas contextuais de Finanças (etapa 5, plano-onboarding-kami.md,
 * seção 8 item 5). Terceira tela, e a primeira SEM layout padrão
 * (DEFAULT_LAYOUTS não tem entrada "financas" em database.py) — todos
 * os 11 tipos do catálogo (app/widgets.py) são opcionais, então um
 * usuário novo chega aqui com o grid inteiramente vazio.
 *
 * Isso muda o papel do passo "adicionar widget" em relação ao Núcleo/
 * Perfil: lá ele é só um extra no fim ("esse painel também é seu").
 * Aqui, se o grid estiver vazio na primeira visita — o caso comum —,
 * ele é o ÚNICO passo que existe (buildWidgetSteps não gera nada pra
 * varrer, já que não há nenhum `.card[data-widget]` no DOM ainda). Sem
 * ele, quem chegasse com a tela vazia veria a sequência inteira
 * terminar sem mostrar nada (ver startTipSequence em tip-sequence.js:
 * `resolved.length === 0` chama onFinish() direto) e a tela ficaria
 * marcada como "vista" sem nunca ter ensinado nada — daí ele ser
 * obrigatório aqui, diferente de ser só um nice-to-have.
 */
const SCREEN = "financas";

const WIDGET_TEXTS = {
  wallet: "seus bancos e contas — saldo, cartão de crédito, o que cada um tiver.",
  financas_resumo: "visão rápida: quanto você tem versus quanto ainda precisa pagar.",
  financas_renda: "sua renda do mês — parte 1 e parte 2, confirme quando cair na conta.",
  financas_registros: "todo lançamento do mês, com filtro por conta e por status.",
  financas_assinaturas: "suas assinaturas recorrentes e quanto elas somam no mês.",
  dividas: "dívidas em aberto — status editável direto aqui, sem abrir nada.",
  contas_fixas: "contas fixas do mês — aluguel, internet, esse tipo de coisa.",
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
  selector: "#financas-add-widget",
  text: "esse painel é seu: toque aqui pra adicionar ou tirar widgets.",
  advanceOn: "interact",
};

function buildSteps(container) {
  return [...buildWidgetSteps(container, WIDGET_TEXTS), ADD_WIDGET_STEP];
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

/**
 * Dispara a sequência se: (a) o onboarding geral já foi concluído e
 * (b) Finanças ainda não está em screen_tips_seen. Mesmo guard de
 * chamada repetida que Núcleo/Perfil.
 */
export async function maybeStartFinancasTips(grid, container) {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas de finanças:", err);
    running = false;
    return;
  }
  if (seen.seen.includes(SCREEN)) {
    running = false;
    return;
  }

  grid?.lockForTips();
  startTipSequence(buildSteps(container), {
    onFinish: async () => {
      grid?.unlockForTips();
      running = false;
      try {
        await markScreenTipsSeen(SCREEN);
      } catch (err) {
        console.error("erro ao marcar dicas de finanças como vistas:", err);
      }
    },
  });
}
