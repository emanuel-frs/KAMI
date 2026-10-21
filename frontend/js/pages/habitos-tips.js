import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";

/**
 * Dicas contextuais da tela de hábitos (ORG-04) — mesmo esquema de
 * metas-tips.js: passos escritos à mão; os que dependem de já existir um
 * hábito somem sozinhos com a tela vazia (startTipSequence filtra os
 * seletores que não estão no DOM).
 */
const SCREEN = "habitos";

const STEPS = [
  {
    selector: "#hb-hoje .hb-item",
    text: "os hábitos de hoje: um clique marca (+5 xp no atributo do hábito), outro desmarca e devolve o xp. o ▲ é a sequência.",
  },
  {
    selector: ".hb-grade",
    text: "a grade mostra as últimas 12 semanas. esqueceu de marcar? os dias até 2 atrás são clicáveis aqui.",
  },
  {
    selector: '.hb-card [data-acao="pausar"]',
    text: "viagem ou doença? pause o hábito: os dias pausados não contam nem quebram a sequência. arquivar guarda o histórico e tira da lista.",
  },
  {
    selector: '.hb-card [data-acao="lembrar"]',
    text: "o sino cria um lembrete pro hábito — ele só avisa se o hábito ainda não foi marcado naquele dia.",
  },
  {
    selector: "#hb-add-btn",
    text: "todo hábito novo começa aqui — todo dia, dias fixos ou x vezes por semana.",
    advanceOn: "interact",
  },
];

let running = false;

/**
 * Replay manual — habitos.js registra esta função em
 * screen-tips-registry.js ao montar, chamada pelo botão de ajuda
 * global ("rever dicas desta tela") estando em Hábitos. Roda
 * incondicionalmente, não marca como visto.
 */
export function replayHabitosTips() {
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
 * (b) Hábitos ainda não está em screen_tips_seen. Mesmo guard de chamada
 * repetida que as outras telas.
 */
export async function maybeStartHabitosTips() {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas de hábitos:", err);
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
        console.error("erro ao marcar dicas de hábitos como vistas:", err);
      }
    },
  });
}
