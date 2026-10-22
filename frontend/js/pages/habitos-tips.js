import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";

/**
 * Dicas contextuais da tela de hábitos (ORG-04) — mesmo esquema de
 * metas-tips.js: passos escritos à mão; os que dependem de já existir um
 * hábito somem sozinhos com a tela vazia (startTipSequence filtra os
 * seletores que não estão no DOM).
 */
const SCREEN = "habitos";

const STEPS = [
  {
    id: "hoje",
    selector: "#hb-hoje .hb-item",
    text: "os hábitos de hoje: um clique marca (+5 xp no atributo do hábito), outro desmarca e devolve o xp. o ▲ é a sequência.",
  },
  {
    id: "grade",
    selector: ".hb-grade",
    text: "a grade mostra as últimas 12 semanas. esqueceu de marcar? os dias até 2 atrás são clicáveis aqui.",
  },
  {
    id: "pausar",
    selector: '.hb-card [data-acao="pausar"]',
    text: "viagem ou doença? pause o hábito: os dias pausados não contam nem quebram a sequência. arquivar guarda o histórico e tira da lista.",
  },
  {
    id: "lembrar",
    selector: '.hb-card [data-acao="lembrar"]',
    text: "o sino cria um lembrete pro hábito — ele só avisa se o hábito ainda não foi marcado naquele dia.",
  },
  {
    id: "novo-habito",
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

// MAN-05: ids das dicas que já existiam até a 1.12 — quem viu esta tela
// antes da 1.14 não as vê de novo (components/dicas-novas.js). Dica nova
// ou reescrita (id com "-2") fica FORA desta lista.
const ATE_1_12 = [];

/**
 * Ao abrir a tela, mostra as dicas que a pessoa ainda não viu (todas, na
 * primeira vez; só as novas, com o rótulo "novidade", depois) — regras
 * em components/dicas-novas.js. Seguro de chamar várias vezes (mount e
 * store.subscribe do perfil, pra rodar logo depois do tour geral).
 */
export function maybeStartHabitosTips() {
  return mostrarDicasNovas({ tela: SCREEN, passos: () => STEPS, ate112: ATE_1_12 });
}
