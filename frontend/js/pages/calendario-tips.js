import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";

/**
 * Dicas contextuais do Calendário (etapa 5).
 * Última das seis telas v1 a ganhar isso — ficou de fora do rollout
 * original (ver comentário antigo em screen-tips-registry.js) por ser
 * considerada um tutorial mais complexo na época; na prática a tela
 * é fixa (toolbar + grade + painel do dia + legenda), sem grid de
 * widgets, então segue o mesmo modelo de passos escritos à mão usado
 * em Metas/Organização/Aprendizado, não o buildWidgetSteps de
 * Núcleo/Perfil/Finanças.
 *
 * Mistura os dois tipos de passo, como nas outras telas de layout
 * fixo:
 *   - informar: destaca e explica (advanceOn padrão "button").
 *   - ensinar a usar: só avança com interação real (advanceOn:
 *     "interact") — aqui é o passo do dia de hoje na grade, clicável
 *     desde a primeira visita (mount já seleciona o dia atual), então
 *     diferente de Metas (cujo "+ nova meta" é o único passo garantido
 *     em tela vazia) dá pra fechar a sequência com uma interação real
 *     sem depender de já existir nenhum evento cadastrado.
 *
 * Os passos que dependem do painel do dia ter eventos (filtro de
 * tipo, linha de evento) simplesmente não aparecem quando o dia atual
 * está vazio — startTipSequence já filtra por conta própria os passos
 * cujo `selector` não resolve no DOM (mesmo comportamento documentado
 * em metas-tips.js).
 */
const SCREEN = "calendario";

const STEPS = [
  {
    // informar — visão geral da tela antes de entrar em detalhe
    selector: "#cal-grid",
    text: "aqui ficam todos os seus compromissos do mês: contas, dívidas, assinaturas, parcelas, metas e ações, tudo num só lugar.",
  },
  {
    // informar — navegação entre meses
    selector: ".cal-nav",
    text: "navegue entre os meses por aqui, ou use \"hoje\" pra voltar direto pro mês atual.",
  },
  {
    // informar — o que os selinhos coloridos no dia significam
    selector: "#cal-grid .cal-day.has-events",
    text: "os selinhos em cada dia mostram os tipos de evento presentes — a legenda no rodapé explica cada cor e ícone.",
  },
  {
    // ensinar a usar — clicar num dia abre o painel de detalhes; o dia
    // atual já vem selecionado ao entrar na tela, então este seletor
    // sempre existe, mesmo em mês vazio
    selector: "#cal-grid .cal-day.today",
    text: "toque em um dia pra ver os detalhes dele aqui do lado.",
    advanceOn: "interact",
  },
  {
    // informar — só existe quando o dia selecionado tem mais de um tipo de evento
    selector: ".cal-filter-btn",
    text: "quando o dia tem vários tipos de evento, filtre por aqui pra ver só o que interessa.",
  },
  {
    // informar — clicar numa linha de evento leva pro módulo de origem
    selector: ".cal-event-row",
    text: "cada evento leva direto pro registro de origem — exceto eventos manuais, que abrem pra edição.",
  },
  {
    // informar — eventos manuais podem ser arrastados pra outro dia
    selector: ".cal-event-row-evento",
    text: "eventos manuais também podem ser arrastados pra outro dia direto na grade, pra reagendar rápido.",
  },
  {
    // informar — fecha explicando o cadastro manual (não força clique
    // porque abre um modal no meio da sequência, mesma ressalva de
    // metas-tips.js sobre advanceOn:"interact" + modal)
    selector: "#cal-new-event-btn",
    text: "pra cadastrar um evento manual (que não vem de nenhum outro módulo), use este botão.",
  },
];

let running = false;

/**
 * Replay manual — calendario.js registra esta função em
 * screen-tips-registry.js ao montar, chamada pelo botão de ajuda
 * global ("rever dicas desta tela") estando no Calendário. Roda
 * incondicionalmente, não marca como visto.
 */
export function replayCalendarioTips() {
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
 * (b) Calendário ainda não está em screen_tips_seen. Mesmo guard de
 * chamada repetida que as outras telas.
 */
export async function maybeStartCalendarioTips() {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas de calendário:", err);
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
        console.error("erro ao marcar dicas de calendário como vistas:", err);
      }
    },
  });
}
