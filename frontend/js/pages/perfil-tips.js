import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";
import { buildWidgetSteps } from "../components/widget-tips.js";

/**
 * Dicas contextuais do Perfil (etapa 5, plano-onboarding-kami.md,
 * seção 8 item 5 — "espalhar as dicas contextuais pelas telas
 * restantes"). Segunda tela a ganhar o mecanismo, reaproveitando o
 * mesmo motor dinâmico do Núcleo (widget-tips.js): os passos vêm do
 * que está de fato no grid agora, não de uma lista fixa.
 *
 * Catálogo do Perfil (app/widgets.py, backend): profile (fixo,
 * default_span sempre presente), attributes e achievements (mesmos
 * tipos que já aparecem no Núcleo — mas com texto próprio aqui, porque
 * o contexto muda: em Perfil eles são "seu histórico", em Núcleo são
 * "o que você tá fazendo agora"). `org_notifications` saiu do
 * catálogo de widgets (notificações v2 — virou o sino global na
 * sidebar), então não tem mais entrada aqui.
 */
const SCREEN = "perfil";

const WIDGET_TEXTS = {
  profile: "seu nome, cor e avatar ficam aqui — toque em editar pra mudar qualquer um dos três.",
  attributes: "o mesmo progresso por atributo do núcleo, só que centralizado aqui no seu perfil.",
  achievements: "todas as conquistas que você já destravou, num só lugar.",
};

function buildSteps(container) {
  return buildWidgetSteps(container, WIDGET_TEXTS);
}

let running = false;

/**
 * Replay manual — mesmo papel do replayNucleoTips (nucleo-tips.js):
 * registrado em screen-tips-registry.js por perfil.js, chamado pelo
 * botão de ajuda global quando "rever dicas desta tela" é escolhido
 * estando no Perfil. Roda incondicionalmente e não marca como visto.
 */
export function replayPerfilTips(grid, container) {
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
 * (b) o Perfil ainda não está em screen_tips_seen. Mesmo guard de
 * chamada repetida que o Núcleo usa (`running` + o guard interno de
 * startTipSequence).
 */
export async function maybeStartPerfilTips(grid, container) {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas do perfil:", err);
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
        console.error("erro ao marcar dicas do perfil como vistas:", err);
      }
    },
  });
}
