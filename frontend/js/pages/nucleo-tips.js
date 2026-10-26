import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { buildWidgetSteps } from "../components/widget-tips.js";
import { t } from "../i18n.js";

/**
 * Dicas contextuais do Núcleo (etapa 5) — a
 * primeira tela a ganhar o mecanismo, por ser a mais central/visitada.
 *
 * Os passos são gerados na hora a partir do que está de fato no grid
 * (ver widget-tips.js) — não é mais uma lista fixa de seletores. Isso
 * significa: widget presente sem texto em widgetTexts() (ex: um widget
 * novo ainda não revisado) não ganha passo; widget ausente (ex: um dos
 * cinco abaixo removido pelo usuário) simplesmente não aparece na
 * lista — sem precisar de nenhum guard especial nos dois casos.
 *
 * `org_notifications` saiu do catálogo de widgets (notificações v2 —
 * virou o sino global na sidebar, não widget de dashboard mais), então
 * não tem mais entrada aqui.
 */
const SCREEN = "nucleo";

const widgetTexts = () => ({
  attributes: t("nucleo_tips.cada_area_da_sua_vida"),
  priorities: t("nucleo_tips.o_atributo_mais_atrasado_e"),
  log: t("nucleo_tips.todo_registro_que_voce_faz"),
  registrar: t("nucleo_tips.registre_qualquer_acao_manual_pra"),
  missoes: t("nucleo_tips.tres_missoes_por_dia_e"),
  notas_rapidas: t("nucleo_tips.suas_notas_fixadas_e_um"),
  habitos_hoje: t("nucleo_tips.os_habitos_que_valem_hoje"),
  achievements: t("nucleo_tips.conquistas"),
});

// único passo que não é um widget do catálogo — o botão de adicionar
// widget da própria toolbar (ver createDashboardPage em dashboard.js).
// Fica sempre por último e é sempre incluído (o botão sempre existe na
// tela), diferente dos widgets, que dependem do que o usuário montou.
const addWidgetStep = () => ({
  id: "adicionar-widget",
  selector: "#nucleo-add-widget",
  text: t("nucleo_tips.esse_painel_e_seu_toque"),
  advanceOn: "interact",
});

function buildSteps(container) {
  return [...buildWidgetSteps(container, widgetTexts()), addWidgetStep()];
}

let running = false;

/**
 * Replay manual da sequência do Núcleo — nucleo.js registra esta função
 * em screen-tips-registry.js ao montar, e o botão de ajuda global
 * (help-menu.js, etapa 6) chama ela quando o usuário escolhe "rever
 * dicas desta tela" estando no Núcleo. Ao contrário de
 * maybeStartNucleoTips(), roda incondicionalmente (ignora o tour geral
 * e as dicas já vistas) e NÃO marca nada como visto — é uma revisão.
 */
export function replayNucleoTips(grid, container) {
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
  "widget-attributes",
  "widget-priorities",
  "widget-log",
  "widget-registrar",
  "widget-achievements",
  "adicionar-widget",
];

/**
 * Ao abrir a tela, mostra as dicas que a pessoa ainda não viu (todas, na
 * primeira vez; só as novas, com o rótulo "novidade", depois) — regras
 * em components/dicas-novas.js. Seguro de chamar várias vezes (mount e
 * store.subscribe do perfil, pra rodar logo depois do tour geral).
 */
export function maybeStartNucleoTips(grid, container) {
  return mostrarDicasNovas({
    tela: SCREEN,
    passos: () => buildSteps(container),
    ate112: ATE_1_12,
    antes: () => grid?.lockForTips(),
    depois: () => grid?.unlockForTips(),
  });
}
