import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { t } from "../i18n.js";

/**
 * Dicas contextuais de Metas (etapa 5,
 * seção 8 item 5). Primeira das três telas de layout fixo (a tela em
 * si que valida a abordagem antes de espalhar pra Organização e
 * Aprendizado — ver discussão que motivou este arquivo).
 *
 * Diferente de Núcleo/Perfil/Finanças (buildWidgetSteps varrendo
 * `.card[data-widget]`), aqui não tem grid nenhum pra escanear — a
 * tela é layout fixo com toolbar, duas seções (ativas/histórico) e
 * cards de meta com ações internas. Passos escritos à mão, como no
 * modelo original do Núcleo pré-widget-tips, misturando dois tipos:
 *
 *   - informar: destaca uma seção/elemento e explica o que é
 *     (advanceOn padrão "button" — usuário só lê e avança).
 *   - ensinar a usar: destaca uma ação específica e só avança quando
 *     o usuário interage de verdade (advanceOn: "interact"), mesma
 *     ideia do "+ adicionar widget" nas outras telas.
 *
 * startTipSequence já filtra por conta própria os passos cujo
 * `selector` não existe no DOM agora (tip-sequence.js:
 * `steps.filter(s => document.querySelector(s.selector))`) — então os
 * passos abaixo que dependem de já existir pelo menos uma meta
 * (contribuir, ver progresso, ver trilha) simplesmente não aparecem
 * pra quem chega com a tela vazia (caso comum: é raro Metas já ter
 * algo na primeira visita). Nada especial precisa ser feito aqui pra
 * cobrir isso — a sequência sempre sobra com pelo menos os passos de
 * seção + "+ nova meta", igual ao ADD_WIDGET_STEP de Finanças quando o
 * grid está vazio. E se o usuário voltar depois (via "rever dicas
 * desta tela", replayMetasTips) já com metas criadas, os passos de
 * card aparecem normalmente — a lista é a mesma, só o que resolve no
 * DOM muda.
 */
const SCREEN = "metas";

const steps = () => [
  {
    // informar — orienta antes de entrar em detalhe de card
    id: "em-andamento",
    selector: "#goals-section-active",
    text: t("metas_tips.aqui_ficam_suas_metas_em"),
  },
  {
    // informar — visão geral do card (tipo, peso em xp, progresso)
    id: "card",
    selector: ".goal-card",
    text: t("metas_tips.cada_meta_vira_um_card"),
  },
  {
    // ensinar a usar — ícone de gráfico só existe em metas que não são de aprendizado
    id: "grafico",
    selector: '.goal-card-icons [data-action="toggle-progress"]',
    text: t("metas_tips.toque_aqui_pra_abrir_um"),
    advanceOn: "interact",
  },
  {
    // informar, não ensinar — este botão abre um modal (openContributeModal),
    // e advanceOn:"interact" no MEIO da sequência quebra o passo seguinte:
    // advance() já tenta destacar #goals-section-done por baixo do modal
    // recém-aberto, já que o motor (tip-sequence.js) não sabe nada sobre
    // modais. Só funciona sem conflito quando o passo "interact" que abre
    // modal é o ÚLTIMO da sequência (ver #goals-add-btn abaixo: aí
    // advance() estoura o índice e chama finish() antes do modal aparecer
    // por cima, em vez de tentar destacar mais alguma coisa). Por isso este
    // passo só aponta e explica, sem forçar o clique.
    id: "contribuir",
    selector: '[data-action="contribute-goal"]',
    text: t("metas_tips.contribuir"),
  },
  {
    // ORG-05: lembrete ligado à meta
    id: "lembrar",
    selector: '[data-action="lembrar-goal"]',
    text: t("metas_tips.o_sino_cria_um_lembrete"),
  },
  {
    // informar — só existe se houver meta de aprendizado ativa
    id: "ver-trilha",
    selector: '[data-action="ver-trilha"]',
    text: t("metas_tips.metas_de_aprendizado_ficam_sincronizadas"),
  },
  {
    // informar — seção de histórico
    id: "concluidas",
    selector: "#goals-section-done",
    text: t("metas_tips.metas_concluidas_migram_pra_ca"),
  },
  {
    // ensinar a usar — sempre presente, fecha a sequência (mesma lógica do
    // ADD_WIDGET_STEP em nucleo/perfil/financas: é o ponto de partida pra
    // quem chega com a tela vazia)
    id: "nova-meta",
    selector: "#goals-add-btn",
    text: t("metas_tips.toda_meta_nova_comeca_aqui"),
    advanceOn: "interact",
  },
];

let running = false;

/**
 * Replay manual — metas.js registra esta função em
 * screen-tips-registry.js ao montar, chamada pelo botão de ajuda
 * global ("rever dicas desta tela") estando em Metas. Roda
 * incondicionalmente, não marca como visto.
 */
export function replayMetasTips() {
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
const ATE_1_12 = ["em-andamento", "card", "grafico", "contribuir", "ver-trilha", "concluidas", "nova-meta"];

/**
 * Ao abrir a tela, mostra as dicas que a pessoa ainda não viu (todas, na
 * primeira vez; só as novas, com o rótulo "novidade", depois) — regras
 * em components/dicas-novas.js. Seguro de chamar várias vezes (mount e
 * store.subscribe do perfil, pra rodar logo depois do tour geral).
 */
export function maybeStartMetasTips() {
  return mostrarDicasNovas({ tela: SCREEN, passos: () => steps(), ate112: ATE_1_12 });
}
