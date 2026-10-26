import { startTipSequence } from "../components/tip-sequence.js";
import { mostrarDicasNovas } from "../components/dicas-novas.js";
import { switchTab } from "./organizacao.js";
import { t } from "../i18n.js";

/**
 * Dicas contextuais de Organização (etapa 5,
 * seção 8 item 5). Segunda das três telas de layout fixo — mesmo
 * modelo de lista manual de Metas (metas-tips.js), mas com uma
 * complicação nova: três abas fixas (github/e-mail/links — nessa
 * ordem, espelhando a barra de abas depois do reordenamento pra
 * github primeiro), e só a aba ativa fica com `display` visível — as
 * outras duas somem via CSS (ver switchTab() em organizacao.js),
 * embora continuem no DOM.
 *
 * Isso quebra o destaque de qualquer passo que aponte pra dentro de
 * uma aba que não seja a ativa no momento: document.querySelector
 * ainda encontra o elemento (ele não sai do DOM, só fica
 * display:none), mas getBoundingClientRect() de um elemento
 * display:none dá um retângulo 0x0 — o destaque "abre" num ponto
 * qualquer da tela em vez de em cima do elemento de verdade.
 *
 * Por isso todo passo que depende de uma aba específica estar ativa
 * troca pra ela via `onEnter` (extensão do motor, ver tip-sequence.js)
 * ANTES do próprio passo ser posicionado — não dá pra confiar que o
 * passo anterior já deixou a aba certa ativa, porque o replay manual
 * ("rever dicas desta tela") pode começar com o usuário em qualquer
 * aba, não só "notas" (a aba padrão só vale pra quem acabou de
 * montar a tela). `switchTab` é idempotente (trocar pra uma aba já
 * ativa não faz nada), então não custa nada incluir o onEnter em mais
 * de um passo do mesmo grupo.
 *
 * Os pills da barra de abas (`.tab[data-tab="..."]`) ficam de fora
 * dessa exigência — a barra em si nunca é escondida, só os painéis de
 * conteúdo abaixo dela — por isso os passos que apontam pra um pill
 * (ex: apresentar a aba email antes de entrar nela) não precisam de
 * onEnter.
 *
 * Nenhum passo aqui usa advanceOn:"interact" em cima de um botão que
 * abre modal a não ser o ÚLTIMO da sequência inteira — ver o
 * comentário equivalente em metas-tips.js (o motor não sabe nada
 * sobre modais: um passo "interact" no MEIO da sequência que abre um
 * modal faz o passo seguinte tentar se posicionar por baixo dele).
 * Aqui isso importa ainda mais: são três botões de "+ adicionar" (um
 * por aba), todos abrindo modal — só o da última aba percorrida
 * (links, agora que a ordem virou github → e-mail → links) pode ser
 * ensinado com clique de verdade; os outros dois só informam.
 */
const SCREEN = "organizacao";

const steps = () => [
  // ─── busca (topo da tela, independe de aba) ──────────────────────────
  {
    id: "busca",
    selector: "#org-search",
    text: t("organizacao_tips.busca_na_web_sem_sair"),
  },
  {
    id: "chave-busca",
    selector: "#org-search-key-badge",
    text: t("organizacao_tips.a_chave_de_busca_e"),
  },
  {
    id: "limpar-busca",
    selector: "#org-search-clear",
    text: t("organizacao_tips.esse_botao_limpa_o_texto"),
  },

  // ─── visão geral das abas ─────────────────────────────────────────────
  {
    id: "abas-2",
    selector: ".tabs",
    text: t("organizacao_tips.organizacao_junta_suas_notas_a"),
  },

  // ─── aba: notas (padrão ao entrar na tela, ORG-01) ─────────────────────
  {
    id: "aba-notas",
    selector: '.tab[data-tab="notas"]',
    text: t("organizacao_tips.notas_texto_com_formatacao_negrito"),
  },
  {
    onEnter: () => switchTab("notas"),
    id: "nova-nota",
    selector: '[data-nt="nova"]',
    text: t("organizacao_tips.nova_nota_comeca_uma_nota"),
  },

  // ─── aba: entrada (ORG-02) ─────────────────────────────────────────────
  {
    id: "aba-entrada",
    selector: '.tab[data-tab="entrada"]',
    text: t("organizacao_tips.entrada_o_que_voce_anotou"),
  },

  // ─── aba: github ───────────────────────────────────────────────────────
  {
    id: "aba-github",
    selector: '.tab[data-tab="github"]',
    text: t("organizacao_tips.aqui_ficam_os_repositorios_que"),
  },
  {
    onEnter: () => switchTab("github"),
    id: "conectar-repo",
    selector: '[data-action="open-repo-modal"]',
    text: t("organizacao_tips.conectar_repositorio_so_precisa_do"),
  },
  {
    onEnter: () => switchTab("github"),
    id: "token-github",
    selector: '[data-action="open-github-token-modal"]',
    text: t("organizacao_tips.o_token_e_opcional_sem"),
  },

  // ─── aba: e-mail ───────────────────────────────────────────────────────
  {
    id: "aba-email-2",
    selector: '.tab[data-tab="email"]',
    text: t("organizacao_tips.proxima_aba_suas_contas_de"),
  },
  {
    onEnter: () => switchTab("email"),
    id: "contas-email",
    selector: '[data-action="open-manage-accounts-modal"]',
    text: t("organizacao_tips.gerenciar_contas_e_onde_tudo"),
  },

  // ─── aba: links ────────────────────────────────────────────────────────
  {
    // ensinar a usar — abre modal, então precisa ser o ÚLTIMO passo da
    // sequência inteira (ver comentário no topo do arquivo)
    onEnter: () => switchTab("links"),
    id: "novo-link",
    selector: '[data-action="open-link-modal"]',
    text: t("organizacao_tips.adicionar_link_cadastra_um_atalho"),
    advanceOn: "interact",
  },
];

let running = false;

/**
 * Replay manual — organizacao.js registra esta função em
 * screen-tips-registry.js ao montar, chamada pelo botão de ajuda
 * global ("rever dicas desta tela") estando em Organização. Roda
 * incondicionalmente, não marca como visto.
 */
export function replayOrganizacaoTips() {
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
const ATE_1_12 = ["busca", "chave-busca", "limpar-busca", "aba-github", "conectar-repo", "token-github", "contas-email", "novo-link"];

/**
 * Ao abrir a tela, mostra as dicas que a pessoa ainda não viu (todas, na
 * primeira vez; só as novas, com o rótulo "novidade", depois) — regras
 * em components/dicas-novas.js. Seguro de chamar várias vezes (mount e
 * store.subscribe do perfil, pra rodar logo depois do tour geral).
 */
export function maybeStartOrganizacaoTips() {
  return mostrarDicasNovas({ tela: SCREEN, passos: () => steps(), ate112: ATE_1_12 });
}
