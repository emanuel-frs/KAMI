import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { t } from "../i18n.js";

/**
 * Dicas contextuais da tela de hábitos (ORG-04) — mesmo esquema de
 * metas-tips.js: passos escritos à mão; os que dependem de já existir um
 * hábito somem sozinhos com a tela vazia (startTipSequence filtra os
 * seletores que não estão no DOM).
 */
const SCREEN = "habitos";

const steps = () => [
  {
    id: "hoje",
    selector: "#hb-hoje .hb-item",
    text: t("habitos_tips.os_habitos_de_hoje_um"),
  },
  {
    id: "grade",
    selector: ".hb-grade",
    text: t("habitos_tips.a_grade_mostra_as_ultimas"),
  },
  {
    id: "pausar",
    selector: '.hb-card [data-acao="pausar"]',
    text: t("habitos_tips.viagem_ou_doenca_pause_o"),
  },
  {
    id: "lembrar",
    selector: '.hb-card [data-acao="lembrar"]',
    text: t("habitos_tips.o_sino_cria_um_lembrete"),
  },
  {
    id: "novo-habito",
    selector: "#hb-add-btn",
    text: t("habitos_tips.todo_habito_novo_comeca_aqui"),
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
  startTipSequence(steps(), {
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
  return mostrarDicasNovas({ tela: SCREEN, passos: () => steps(), ate112: ATE_1_12 });
}
