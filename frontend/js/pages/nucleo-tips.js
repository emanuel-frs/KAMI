import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";
import { buildWidgetSteps } from "../components/widget-tips.js";

/**
 * Dicas contextuais do Núcleo (etapa 5) — a
 * primeira tela a ganhar o mecanismo, por ser a mais central/visitada.
 *
 * Os passos são gerados na hora a partir do que está de fato no grid
 * (ver widget-tips.js) — não é mais uma lista fixa de seletores. Isso
 * significa: widget presente sem texto em WIDGET_TEXTS (ex: um widget
 * novo ainda não revisado) não ganha passo; widget ausente (ex: um dos
 * cinco abaixo removido pelo usuário) simplesmente não aparece na
 * lista — sem precisar de nenhum guard especial nos dois casos.
 *
 * `org_notifications` saiu do catálogo de widgets (notificações v2 —
 * virou o sino global na sidebar, não widget de dashboard mais), então
 * não tem mais entrada aqui.
 */
const SCREEN = "nucleo";

const WIDGET_TEXTS = {
  attributes: "cada área da sua vida sobe de nível conforme você age. isso aqui é seu progresso por atributo.",
  priorities: "o que você marcar aqui fica em destaque durante a semana.",
  log: "todo registro que você faz em qualquer módulo aparece aqui, em ordem.",
  registrar: "registre qualquer ação manual pra ganhar xp direto num atributo.",
  achievements: "marcos que destravam sozinhos conforme você usa o app.",
};

// único passo que não é um widget do catálogo — o botão de adicionar
// widget da própria toolbar (ver createDashboardPage em dashboard.js).
// Fica sempre por último e é sempre incluído (o botão sempre existe na
// tela), diferente dos widgets, que dependem do que o usuário montou.
const ADD_WIDGET_STEP = {
  selector: "#nucleo-add-widget",
  text: "esse painel é seu: toque aqui pra adicionar ou tirar widgets.",
  advanceOn: "interact",
};

function buildSteps(container) {
  return [...buildWidgetSteps(container, WIDGET_TEXTS), ADD_WIDGET_STEP];
}

let running = false;

/**
 * Replay manual da sequência do Núcleo — nucleo.js registra esta função
 * em screen-tips-registry.js ao montar, e o botão de ajuda global
 * (help-menu.js, etapa 6) chama ela quando o usuário escolhe "rever
 * dicas desta tela" estando no Núcleo. Ao contrário de
 * maybeStartNucleoTips(), roda incondicionalmente (ignora
 * onboarding_completed e screen_tips_seen) e NÃO chama
 * markScreenTipsSeen — é uma revisão, não afeta o "visto/não visto" de
 * quem ainda não tinha passado pela etapa 5.
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

/**
 * Dispara a sequência se: (a) o onboarding geral já foi concluído — não
 * queremos os dois tutoriais competindo pela tela ao mesmo tempo — e
 * (b) o Núcleo ainda não está em screen_tips_seen. Seguro de chamar
 * várias vezes (ex: uma vez no mount da tela, outra via store.subscribe
 * quando o onboarding termina em seguida) — `running` e o guard interno
 * de startTipSequence contra empilhamento cobrem a repetição.
 */
export async function maybeStartNucleoTips(grid, container) {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas do núcleo:", err);
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
        console.error("erro ao marcar dicas do núcleo como vistas:", err);
      }
    },
  });
}

