import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { t } from "../i18n.js";

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

const steps = () => [
  {
    // informar — visão geral da tela antes de entrar em detalhe
    id: "grade-2",
    selector: "#cal-grid",
    text: t("calendario_tips.aqui_ficam_todos_os_seus"),
  },
  {
    // informar — navegação entre meses
    id: "navegar",
    selector: ".cal-nav",
    text: t("calendario_tips.navegue_entre_os_meses_por"),
  },
  {
    // informar — o que os selinhos coloridos no dia significam
    id: "selos",
    selector: "#cal-grid .cal-day.has-events",
    text: t("calendario_tips.os_selinhos_em_cada_dia"),
  },
  {
    // ensinar a usar — clicar num dia abre o painel de detalhes; o dia
    // atual já vem selecionado ao entrar na tela, então este seletor
    // sempre existe, mesmo em mês vazio
    id: "abrir-dia",
    selector: "#cal-grid .cal-day.today",
    text: t("calendario_tips.toque_em_um_dia_pra"),
    advanceOn: "interact",
  },
  {
    // informar — só existe quando o dia selecionado tem mais de um tipo de evento
    id: "filtro",
    selector: ".cal-filter-btn",
    text: t("calendario_tips.quando_o_dia_tem_varios"),
  },
  {
    // informar — clicar numa linha de evento leva pro módulo de origem
    id: "evento",
    selector: ".cal-event-row",
    text: t("calendario_tips.cada_evento_leva_direto_pro"),
  },
  {
    // informar — eventos manuais podem ser arrastados pra outro dia
    id: "arrastar-evento",
    selector: ".cal-event-row-evento",
    text: t("calendario_tips.eventos_manuais_tambem_podem_ser"),
  },
  {
    // ORG-05: a aba "lembretes" do painel da direita
    id: "aba-lembretes",
    selector: '.cal-painel-abas [data-painel="lembretes"]',
    text: t("calendario_tips.a_aba_lembretes_lista_todos"),
  },
  {
    // ORG-05: só informa (abre modal — mesma ressalva do passo abaixo)
    id: "novo-lembrete",
    selector: "#cal-new-lembrete-btn",
    text: t("calendario_tips.lembrete_avisa_na_hora_dentro"),
  },
  {
    // informar — fecha explicando o cadastro manual (não força clique
    // porque abre um modal no meio da sequência, mesma ressalva de
    // metas-tips.js sobre advanceOn:"interact" + modal)
    id: "novo-evento",
    selector: "#cal-new-event-btn",
    text: t("calendario_tips.pra_cadastrar_um_evento_manual"),
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
  startTipSequence(steps(), {
    onFinish: () => {
      running = false;
    },
  });
}

// MAN-05: ids das dicas que já existiam até a 1.12 — quem viu esta tela
// antes da 1.14 não as vê de novo (components/dicas-novas.js). Dica nova
// ou reescrita (id com "-2") fica FORA desta lista.
const ATE_1_12 = ["navegar", "selos", "abrir-dia", "filtro", "evento", "arrastar-evento", "novo-evento"];

/**
 * Ao abrir a tela, mostra as dicas que a pessoa ainda não viu (todas, na
 * primeira vez; só as novas, com o rótulo "novidade", depois) — regras
 * em components/dicas-novas.js. Seguro de chamar várias vezes (mount e
 * store.subscribe do perfil, pra rodar logo depois do tour geral).
 */
export function maybeStartCalendarioTips() {
  return mostrarDicasNovas({ tela: SCREEN, passos: () => steps(), ate112: ATE_1_12 });
}
