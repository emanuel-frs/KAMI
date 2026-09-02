import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";

/**
 * Dicas contextuais de Aprendizado (etapa 5,
 * seção 8 item 5). Terceira e última das telas de layout fixo — mesmo
 * modelo manual de passos de Metas/Organização (metas-tips.js,
 * organizacao-tips.js), puxando mais pro lado "ensinar a usar"
 * (advanceOn: "interact") nos pontos em que dá pra fazer isso com
 * segurança.
 *
 * A diferença que motiva isso: Núcleo/Perfil/Finanças são grids de
 * widgets — a única interação genuína que dá pra ensinar ali é
 * "+ adicionar widget". Metas e Organização já são layout fixo, mas a
 * maioria das ações de tela (contribuir, adicionar link/repo/conta)
 * abre modal, e um passo "interact" no MEIO da sequência que abre
 * modal quebra o passo seguinte (o motor não sabe nada sobre modais —
 * ver o comentário equivalente nesses dois arquivos). Aprendizado tem
 * ações que resolvem *inline*, sem modal, então uns passos ensinam de
 * verdade (expandir um módulo pra ver notas, criar a trilha no fim).
 *
 * Limite importante, diferente do que a primeira versão deste arquivo
 * assumia: startTipSequence só resolve a lista de passos válidos UMA
 * VEZ, no início (`steps.filter(s => document.querySelector(s.selector))`,
 * ver tip-sequence.js), antes de qualquer onEnter ou interação
 * acontecer. Isso funciona bem pra elementos que já existem no DOM
 * mas estão com display:none (caso das abas de Organização — troca de
 * aba via onEnter só precisa deixar visível algo que já existe), mas
 * NÃO funciona pra elementos que só são criados depois que o próprio
 * usuário interage dentro da sequência — como os nós do modo de
 * edição de trilha (renderTrackEditMode() reescreve o innerHTML do
 * zero ao entrar nesse modo). Por isso o botão "editar" não força
 * clique aqui: ensinar a clicar nele levaria a sequência a "pular"
 * pros passos seguintes que, resolvidos antes de o modo de edição
 * existir, já teriam sido descartados do array por inteiro (ver
 * comentário no passo #btn-edit-track abaixo pra mais detalhe). Os
 * passos que depende do modo de edição continuam na lista mesmo assim
 * — eles só aparecem de verdade quando a sequência é reaberta (replay
 * manual) com a trilha já em edição.
 *
 * Como em Metas, não tem grid pra escanear — startTipSequence filtra
 * por conta própria os passos cujo `selector` não existe no DOM agora,
 * então quem chega com nenhuma trilha criada só vê os passos que
 * independem de trilha selecionada (lista + heatmap + "+ adicionar
 * trilha"). Quem já tem trilha (ou volta depois via "rever dicas desta
 * tela", replayAprendizadoTips) vê o mapa e o card de módulo também.
 */
const SCREEN = "aprendizado";

const STEPS = [
  // ─── lista de trilhas ──────────────────────────────────────────────
  {
    // informar — visão geral, sempre presente mesmo com a lista vazia
    selector: "#apr-tracks-list",
    text: "aqui ficam suas trilhas de aprendizado, cada uma com uma barra mostrando o progresso geral dela.",
  },
  {
    // informar — só existe com pelo menos uma trilha criada
    selector: ".apr-track-drag-dot",
    text: "segure aqui pra arrastar e reordenar suas trilhas na lista.",
  },
  {
    // informar, não ensinar — mount() de aprendizado.js já auto-seleciona
    // a primeira trilha (`if (!selectedTrackId && tracks.length > 0) ...`),
    // então quando as dicas chegam aqui quase sempre já existe uma trilha
    // selecionada. Um advanceOn:"interact" neste passo faria o usuário
    // clicar justamente nessa trilha já ativa — e o clique em
    // .apr-track-item é toggle (setupListEvents: `if (selectedTrackId
    // === id) { selectedTrackId = null; ... }`), então "ensinar" a
    // clicar aqui na prática DESSELECIONA a trilha, some com
    // #milestone-list-canvas e os passos seguintes (que dependem de
    // trilha selecionada) somem do DOM junto — o motor então pula todos
    // eles em silêncio (positionAll() -> advance() quando o selector do
    // passo não resolve mais nada), e a sequência salta direto pro
    // heatmap. Por isso este passo só informa, sem exigir o clique.
    selector: ".apr-track-item",
    text: "toque numa trilha pra abrir (ou fechar) o mapa dela aqui do lado.",
  },

  // ─── mapa da trilha (modo normal) ──────────────────────────────────
  {
    // informar — visão geral do mapa antes de entrar em detalhe de card.
    // #milestone-list-canvas existe com qualquer trilha selecionada,
    // mesmo sem nenhum módulo ainda (mostra o placeholder tracejado
    // "+ adicionar módulo" nesse caso) — mesmo raciocínio do primeiro
    // passo de #goals-section-active em metas-tips.js.
    selector: "#milestone-list-canvas",
    text: "aqui fica o mapa da trilha: os módulos aparecem em ordem, ligados numa linha do tempo — o que já foi concluído, o módulo atual em destaque e o que ainda falta.",
  },
  {
    // informar — só existe com uma trilha selecionada e pelo menos um
    // módulo criado (o passo anterior acabou de garantir a trilha,
    // clicando numa)
    selector: '#milestone-list .roadmap-title, #milestone-list .roadmap-arrow',
    text: "cada módulo vira um card na trilha — toque no título ou na seta pra ver descrição e escrever anotações.",
  },
  {
    // informar, não ensinar — startTipSequence() resolve os passos válidos
    // UMA VEZ, no início, contra o DOM de agora (tip-sequence.js:
    // `steps.filter(s => document.querySelector(s.selector))`), e só
    // depois disso renderStep()/onEnter entram em cena. Os elementos do
    // modo de edição (.roadmap-drag-dot, .roadmap-expand-btn dentro de
    // #edit-milestone-list, #btn-add-module) só passam a existir DEPOIS
    // que renderTrackEditMode() reescreve o innerHTML — ou seja, ainda
    // não existem no momento desse filtro inicial, então mesmo forçando
    // o clique aqui com advanceOn:"interact" os passos abaixo já teriam
    // sido descartados da lista antes de a sequência sequer começar, e o
    // próximo passo resolvido de verdade seria o do heatmap (a
    // sequência parece "pular" pro final). Diferente do caso das abas de
    // Organização (organizacao-tips.js), onde os painéis ficam sempre no
    // DOM só com display:none — aqui os nós do modo de edição
    // literalmente não existem ainda, então onEnter não teria como
    // resolver isso a tempo. Por isso o clique fica só sugerido, e o
    // resumo do que tem lá dentro (arrastar, expandir com notas,
    // adicionar/excluir) vai direto no texto deste passo.
    selector: "#btn-edit-track",
    text: "toque em \"editar\" pra reorganizar a trilha: arrastar módulos pra mudar a ordem, expandir um pra escrever notas, ou adicionar/renomear/excluir.",
  },

  // ─── modo de edição ─────────────────────────────────────────────────
  // Os três passos abaixo só aparecem de fato quando a sequência começa
  // com a trilha JÁ em modo de edição — típico do replay manual ("rever
  // dicas desta tela") disparado por quem está no meio de uma edição.
  // No primeiro contato (onboarding), o passo acima normalmente é o
  // último antes do heatmap, já que o modo de edição ainda não foi
  // aberto no momento em que a lista de passos é resolvida.
  {
    // informar — só existe no modo de edição
    selector: ".roadmap-drag-dot",
    text: "com a trilha em edição, segure aqui pra arrastar os módulos e mudar a ordem da timeline.",
  },
  {
    // ensinar a usar — expandir é inline (mostra notas ali embaixo do
    // próprio card), sem modal por baixo pra atrapalhar o passo seguinte
    selector: "#edit-milestone-list .roadmap-expand-btn",
    text: "toque na seta pra expandir o módulo e escrever notas direto ali, sem precisar abrir outra tela.",
    advanceOn: "interact",
  },
  {
    // informar — abre modal, então não pode ensinar com clique no meio da sequência
    selector: "#btn-add-module",
    text: "todo módulo novo dessa trilha começa aqui.",
  },

  // ─── atividade (heatmap) ────────────────────────────────────────────
  {
    // informar — sempre presente (o ano atual sempre entra na lista de abas)
    selector: "#apr-heatmap-years",
    text: "troque de ano aqui pra ver o histórico de atividade de aprendizado registrada antes.",
  },
  {
    // informar — quadriculado tipo contribution graph
    selector: "#apr-heatmap",
    text: "cada quadradinho é um dia: quanto mais forte a cor, mais registros de aprendizado nele. o contorno dourado marca dias em que você concluiu um módulo.",
  },

  // ─── criar trilha ───────────────────────────────────────────────────
  {
    // ensinar a usar — sempre presente, fecha a sequência (mesma lógica
    // do ADD_WIDGET_STEP em nucleo/perfil/financas e do "+ nova meta" /
    // "+ adicionar conta" em metas/organizacao: ponto de partida pra
    // quem chega com a tela vazia, e por abrir modal só pode ser o
    // ÚLTIMO passo da sequência)
    selector: "#apr-add-track",
    text: "toda trilha nova começa aqui — dá pra criar do zero ou importar de um json pronto.",
    advanceOn: "interact",
  },
];

let running = false;

/**
 * Replay manual — aprendizado.js registra esta função em
 * screen-tips-registry.js ao montar, chamada pelo botão de ajuda
 * global ("rever dicas desta tela") estando em Aprendizado. Roda
 * incondicionalmente, não marca como visto.
 */
export function replayAprendizadoTips() {
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
 * (b) Aprendizado ainda não está em screen_tips_seen. Mesmo guard de
 * chamada repetida que as outras telas.
 */
export async function maybeStartAprendizadoTips() {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas de aprendizado:", err);
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
        console.error("erro ao marcar dicas de aprendizado como vistas:", err);
      }
    },
  });
}