import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { buildWidgetSteps } from "../components/widget-tips.js";

/**
 * Dicas contextuais do Perfil (etapa 5,
 * seção 8 item 5 — "espalhar as dicas contextuais pelas telas
 * restantes"). Segunda tela a ganhar o mecanismo, reaproveitando o
 * mesmo motor dinâmico do Núcleo (widget-tips.js): os passos vêm do
 * que está de fato no grid agora, não de uma lista fixa.
 *
 * Catálogo do Perfil (app/widgets.py, backend): profile (fixo,
 * default_span sempre presente), attributes e achievements (mesmos
 * tipos que já aparecem no Núcleo — mas com texto próprio aqui, porque
 * o contexto muda: em Perfil eles são "seu histórico", em Núcleo são
 * "o que você tá fazendo agora") e perfil_atividade (exclusivo daqui,
 * mapa de atividade geral do perfil). `org_notifications` saiu do
 * catálogo de widgets (notificações v2 — virou o sino global na
 * sidebar), então não tem mais entrada aqui.
 */
const SCREEN = "perfil";

const WIDGET_TEXTS = {
  profile: "seu nome, cor e avatar ficam aqui — toque em editar pra mudar qualquer um dos três. ao lado, seu nível geral e a sequência de dias seguidos com pelo menos uma ação.",
  attributes: "o mesmo progresso por atributo do núcleo, só que centralizado aqui no seu perfil.",
  achievements: "todas as conquistas num só lugar — as destravadas e, nas bloqueadas, quanto falta. dá pra filtrar por uma ou mais áreas.",
  notas_rapidas: "suas notas fixadas, e um campo pra anotar sem sair daqui. alt+shift+n abre uma nota rápida de qualquer tela.",
  habitos_hoje: "os hábitos que valem hoje — um clique marca (+5 xp) ou desmarca. a grade e o histórico ficam na tela hábitos (alt+9).",
  perfil_atividade: "seu mapa de atividade — cada bloquinho é um dia, somando ações de todos os atributos. quanto mais escuro, mais coisa você registrou naquele dia.",
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

// MAN-05: ids das dicas que já existiam até a 1.12 — quem viu esta tela
// antes da 1.14 não as vê de novo (components/dicas-novas.js). Dica nova
// ou reescrita (id com "-2") fica FORA desta lista.
const ATE_1_12 = [
  "widget-profile",
  "widget-attributes",
  "widget-achievements",
  "widget-perfil_atividade",
];

/**
 * Ao abrir a tela, mostra as dicas que a pessoa ainda não viu (todas, na
 * primeira vez; só as novas, com o rótulo "novidade", depois) — regras
 * em components/dicas-novas.js. Seguro de chamar várias vezes (mount e
 * store.subscribe do perfil, pra rodar logo depois do tour geral).
 */
export function maybeStartPerfilTips(grid, container) {
  return mostrarDicasNovas({
    tela: SCREEN,
    passos: () => buildSteps(container),
    ate112: ATE_1_12,
    antes: () => grid?.lockForTips(),
    depois: () => grid?.unlockForTips(),
  });
}
