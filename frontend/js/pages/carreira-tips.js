import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";
import { buildWidgetSteps } from "../components/widget-tips.js";

/**
 * Dicas contextuais de Carreira (etapa 5, seção 8 item 5 — "espalhar
 * as dicas contextuais pelas telas restantes"). Mesmo motor dinâmico
 * do Núcleo/Perfil/Finanças (widget-tips.js): os passos vêm do que
 * está de fato no grid agora, não de uma lista fixa de seletores.
 *
 * Catálogo de Carreira (widgets/registry.js): carreira_perfil é
 * removable:false — sempre injetado por createDashboardPage
 * (withRequiredWidgets em dashboard.js), então esse card sempre existe
 * na tela, mesmo pra quem chega aqui pela primeira vez. Os outros
 * quatro (interesses/posições/formações/salário) são removíveis, então
 * podem ou não estar presentes dependendo do que o usuário montou —
 * buildWidgetSteps já lida com isso sozinho (widget ausente = passo
 * ausente, sem guard especial).
 *
 * ADD_WIDGET_STEP segue o padrão de nucleo-tips.js/financas-tips.js
 * (não o de perfil-tips.js, que omite esse passo): como quatro dos
 * cinco widgets daqui são removíveis, o botão de adicionar continua
 * relevante mesmo depois da primeira visita.
 */
const SCREEN = "carreira";

const WIDGET_TEXTS = {
  carreira_perfil: "área atual e área que você quer alcançar — toque em editar pra atualizar qualquer uma das duas.",
  carreira_interesses: "tags livres com o que te interessa profissionalmente — adicione quantas quiser.",
  carreira_posicoes: "linha do tempo dos seus empregos e cargos, do mais recente pro mais antigo.",
  carreira_formacoes: "cursos, graduação, certificações — tudo que você estudou ou está estudando.",
  carreira_salario: "como sua remuneração evoluiu ao longo do tempo, com o motivo de cada mudança.",
};

// único passo que não é um widget do catálogo — o botão de adicionar
// widget da própria toolbar (ver createDashboardPage em dashboard.js).
// Fica sempre por último e é sempre incluído (o botão sempre existe na
// tela), diferente dos widgets, que dependem do que o usuário montou.
const ADD_WIDGET_STEP = {
  selector: "#carreira-add-widget",
  text: "esse painel é seu: toque aqui pra adicionar ou tirar widgets.",
  advanceOn: "interact",
};

function buildSteps(container) {
  return [...buildWidgetSteps(container, WIDGET_TEXTS), ADD_WIDGET_STEP];
}

let running = false;

/**
 * Replay manual — mesmo papel do replayNucleoTips/replayFinancasTips:
 * registrado em screen-tips-registry.js por carreira.js, chamado pelo
 * botão de ajuda global (help-menu.js, etapa 6) quando "rever dicas
 * desta tela" é escolhido estando em Carreira. Roda incondicionalmente
 * e NÃO chama markScreenTipsSeen — é uma revisão, não afeta o
 * "visto/não visto" de quem ainda não tinha passado pela etapa 5.
 */
export function replayCarreiraTips(grid, container) {
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
 * Dispara a sequência se: (a) o onboarding geral já foi concluído —
 * não queremos os dois tutoriais competindo pela tela ao mesmo tempo —
 * e (b) Carreira ainda não está em screen_tips_seen. Mesmo guard de
 * chamada repetida que Núcleo/Perfil/Finanças (`running` + o guard
 * interno de startTipSequence contra empilhamento).
 */
export async function maybeStartCarreiraTips(grid, container) {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas de carreira:", err);
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
        // não trava nada — pior caso: a sequência reaparece no próximo boot
        console.error("erro ao marcar dicas de carreira como vistas:", err);
      }
    },
  });
}
