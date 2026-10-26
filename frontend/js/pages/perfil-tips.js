import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { buildWidgetSteps } from "../components/widget-tips.js";
import { t } from "../i18n.js";

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

const widgetTexts = () => ({
  profile: t("perfil_tips.seu_nome_cor_e_avatar"),
  attributes: t("perfil_tips.o_mesmo_progresso_por_atributo"),
  achievements: t("perfil_tips.todas_as_conquistas_num_so"),
  notas_rapidas: t("perfil_tips.suas_notas_fixadas_e_um"),
  habitos_hoje: t("perfil_tips.os_habitos_que_valem_hoje"),
  perfil_atividade: t("perfil_tips.seu_mapa_de_atividade_cada"),
});

function buildSteps(container) {
  return buildWidgetSteps(container, widgetTexts());
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
