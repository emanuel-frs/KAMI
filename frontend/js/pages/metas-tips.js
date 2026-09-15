import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";

/**
 * Dicas contextuais de Metas (etapa 5,
 * seção 8 item 5). Primeira das três telas de layout fixo (a tela em
 * si que valida a abordagem antes de espalhar pra Organização e
 * Aprendizado — ver discussão que motivou este arquivo).
 *
 * Diferente de Núcleo/Perfil/Finanças (buildWidgetSteps varrendo
 * `.card[data-widget]`), aqui não tem grid nenhum pra escanear — a
 * tela é layout fixo com toolbar, duas seções (ativas/histórico) e
 * cards de meta com ações internas. Passos escritos à mão, como no
 * modelo original do Núcleo pré-widget-tips, misturando dois tipos:
 *
 *   - informar: destaca uma seção/elemento e explica o que é
 *     (advanceOn padrão "button" — usuário só lê e avança).
 *   - ensinar a usar: destaca uma ação específica e só avança quando
 *     o usuário interage de verdade (advanceOn: "interact"), mesma
 *     ideia do "+ adicionar widget" nas outras telas.
 *
 * startTipSequence já filtra por conta própria os passos cujo
 * `selector` não existe no DOM agora (tip-sequence.js:
 * `steps.filter(s => document.querySelector(s.selector))`) — então os
 * passos abaixo que dependem de já existir pelo menos uma meta
 * (contribuir, ver progresso, ver trilha) simplesmente não aparecem
 * pra quem chega com a tela vazia (caso comum: é raro Metas já ter
 * algo na primeira visita). Nada especial precisa ser feito aqui pra
 * cobrir isso — a sequência sempre sobra com pelo menos os passos de
 * seção + "+ nova meta", igual ao ADD_WIDGET_STEP de Finanças quando o
 * grid está vazio. E se o usuário voltar depois (via "rever dicas
 * desta tela", replayMetasTips) já com metas criadas, os passos de
 * card aparecem normalmente — a lista é a mesma, só o que resolve no
 * DOM muda.
 */
const SCREEN = "metas";

const STEPS = [
  {
    // informar — orienta antes de entrar em detalhe de card
    selector: "#goals-section-active",
    text: "aqui ficam suas metas em andamento, cada uma com uma barra mostrando o quanto já foi atingido.",
  },
  {
    // informar — visão geral do card (tipo, peso em xp, progresso)
    selector: ".goal-card",
    text: "cada meta vira um card assim: o tipo, o peso em xp (quanto maior, maior o bônus ao concluir) e o quanto falta pra bater o alvo.",
  },
  {
    // ensinar a usar — ícone de gráfico só existe em metas que não são de aprendizado
    selector: '.goal-card-icons [data-action="toggle-progress"]',
    text: "toque aqui pra abrir um gráfico com o histórico de contribuições dessa meta.",
    advanceOn: "interact",
  },
  {
    // informar, não ensinar — este botão abre um modal (openContributeModal),
    // e advanceOn:"interact" no MEIO da sequência quebra o passo seguinte:
    // advance() já tenta destacar #goals-section-done por baixo do modal
    // recém-aberto, já que o motor (tip-sequence.js) não sabe nada sobre
    // modais. Só funciona sem conflito quando o passo "interact" que abre
    // modal é o ÚLTIMO da sequência (ver #goals-add-btn abaixo: aí
    // advance() estoura o índice e chama finish() antes do modal aparecer
    // por cima, em vez de tentar destacar mais alguma coisa). Por isso este
    // passo só aponta e explica, sem forçar o clique.
    selector: '[data-action="contribute-goal"]',
    text: "toda vez que avançar de verdade nessa meta, registre aqui — é isso que move a barra de progresso.",
  },
  {
    // informar — só existe se houver meta de aprendizado ativa
    selector: '[data-action="ver-trilha"]',
    text: "metas de aprendizado ficam sincronizadas com uma trilha — o progresso vem sozinho de lá. esse botão leva direto pra ela.",
  },
  {
    // informar — seção de histórico
    selector: "#goals-section-done",
    text: "metas concluídas migram pra cá, com a data e o bônus de xp que elas renderam.",
  },
  {
    // ensinar a usar — sempre presente, fecha a sequência (mesma lógica do
    // ADD_WIDGET_STEP em nucleo/perfil/financas: é o ponto de partida pra
    // quem chega com a tela vazia)
    selector: "#goals-add-btn",
    text: "toda meta nova começa aqui.",
    advanceOn: "interact",
  },
];

let running = false;

/**
 * Replay manual — metas.js registra esta função em
 * screen-tips-registry.js ao montar, chamada pelo botão de ajuda
 * global ("rever dicas desta tela") estando em Metas. Roda
 * incondicionalmente, não marca como visto.
 */
export function replayMetasTips() {
  if (running) return;
  running = true;
  startTipSequence(STEPS, {
    onFinish: () => {
      running = false;
    },
  });
}

/**
 * Dispara a sequência se: (a) o onboarding geral já foi concluído e
 * (b) Metas ainda não está em screen_tips_seen. Mesmo guard de chamada
 * repetida que as outras telas.
 */
export async function maybeStartMetasTips() {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas de metas:", err);
    running = false;
    return;
  }
  if (seen.seen.includes(SCREEN)) {
    running = false;
    return;
  }

  startTipSequence(STEPS, {
    onFinish: async () => {
      running = false;
      try {
        await markScreenTipsSeen(SCREEN);
      } catch (err) {
        console.error("erro ao marcar dicas de metas como vistas:", err);
      }
    },
  });
}