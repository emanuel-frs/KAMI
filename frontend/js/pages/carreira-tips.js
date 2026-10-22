import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
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
  id: "adicionar-widget",
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
 * e NÃO marca nada como visto — é uma revisão.
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

// MAN-05: ids das dicas que já existiam até a 1.12 — quem viu esta tela
// antes da 1.14 não as vê de novo (components/dicas-novas.js). Dica nova
// ou reescrita (id com "-2") fica FORA desta lista.
const ATE_1_12 = [
  "widget-carreira_perfil",
  "widget-carreira_interesses",
  "widget-carreira_posicoes",
  "widget-carreira_formacoes",
  "widget-carreira_salario",
  "adicionar-widget",
];

/**
 * Ao abrir a tela, mostra as dicas que a pessoa ainda não viu (todas, na
 * primeira vez; só as novas, com o rótulo "novidade", depois) — regras
 * em components/dicas-novas.js. Seguro de chamar várias vezes (mount e
 * store.subscribe do perfil, pra rodar logo depois do tour geral).
 */
export function maybeStartCarreiraTips(grid, container) {
  return mostrarDicasNovas({
    tela: SCREEN,
    passos: () => buildSteps(container),
    ate112: ATE_1_12,
    antes: () => grid?.lockForTips(),
    depois: () => grid?.unlockForTips(),
  });
}
