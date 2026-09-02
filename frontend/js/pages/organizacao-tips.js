import { store } from "../state/store.js";
import { getScreenTipsSeen, markScreenTipsSeen } from "../api/perfil.js";
import { startTipSequence } from "../components/tip-sequence.js";
import { switchTab } from "./organizacao.js";

/**
 * Dicas contextuais de Organização (etapa 5,
 * seção 8 item 5). Segunda das três telas de layout fixo — mesmo
 * modelo de lista manual de Metas (metas-tips.js), mas com uma
 * complicação nova: três abas fixas (links/github/e-mail), e só a aba
 * ativa fica com `display` visível — as outras duas somem via CSS
 * (ver switchTab() em organizacao.js), embora continuem no DOM.
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
 * aba, não só "links" (a aba padrão só vale pra quem acabou de montar
 * a tela). `switchTab` é idempotente (trocar pra uma aba já ativa não
 * faz nada), então não custa nada incluir o onEnter em mais de um
 * passo do mesmo grupo.
 *
 * Os pills da barra de abas (`.tab[data-tab="..."]`) ficam de fora
 * dessa exigência — a barra em si nunca é escondida, só os painéis de
 * conteúdo abaixo dela — por isso os passos que apontam pra um pill
 * (ex: apresentar a aba github antes de entrar nela) não precisam de
 * onEnter.
 *
 * Nenhum passo aqui usa advanceOn:"interact" em cima de um botão que
 * abre modal a não ser o ÚLTIMO da sequência inteira — ver o
 * comentário equivalente em metas-tips.js (o motor não sabe nada
 * sobre modais: um passo "interact" no MEIO da sequência que abre um
 * modal faz o passo seguinte tentar se posicionar por baixo dele).
 * Aqui isso importa ainda mais: são três botões de "+ adicionar" (um
 * por aba), todos abrindo modal — só o da última aba percorrida
 * (e-mail) pode ser ensinado com clique de verdade; os outros dois só
 * informam.
 */
const SCREEN = "organizacao";

const STEPS = [
  // ─── busca (topo da tela, independe de aba) ──────────────────────────
  {
    selector: "#org-search",
    text: "busca na web sem sair do kami — funciona em qualquer uma das três abas abaixo.",
  },
  {
    selector: "#org-search-key-badge",
    text: "a chave de busca é opcional: sem ela, o resultado abre direto no duckduckgo; com uma chave configurada aqui, você vê um resumo direto nesta tela.",
  },
  {
    selector: "#org-search-clear",
    text: "esse botão limpa o texto e o resultado da última busca.",
  },

  // ─── visão geral das abas ─────────────────────────────────────────────
  {
    selector: ".tabs",
    text: "organização guarda três tipos de fonte — links, repositórios do github e e-mail — cada um na sua aba.",
  },

  // ─── aba: links ────────────────────────────────────────────────────────
  {
    onEnter: () => switchTab("links"),
    selector: '[data-action="open-link-modal"]',
    text: "\"+ adicionar link\" cadastra um atalho novo. a categoria é livre — você escolhe os nomes, e os links viram grupos por categoria aqui embaixo.",
  },

  // ─── aba: github ───────────────────────────────────────────────────────
  {
    selector: '.tab[data-tab="github"]',
    text: "aqui ficam os repositórios que você conectar — estrelas, issues, atividade de commit, sem precisar abrir o github.",
  },
  {
    onEnter: () => switchTab("github"),
    selector: '[data-action="open-repo-modal"]',
    text: "\"+ conectar repositório\" só precisa do nome usuario/repositorio — se colar a url inteira do github sem querer, o kami entende do mesmo jeito.",
  },
  {
    onEnter: () => switchTab("github"),
    selector: '[data-action="open-github-token-modal"]',
    text: "o token é opcional: sem ele você só vê repositórios públicos, com 60 requisições/hora. com um token de leitura, também vê privados e sobe pra 5000/hora.",
  },

  // ─── aba: e-mail ───────────────────────────────────────────────────────
  {
    selector: '.tab[data-tab="email"]',
    text: "e a última aba: suas contas de e-mail (imap) e o que chegou nelas, guardado em cache local.",
  },
  {
    // ensinar a usar — abre modal, então precisa ser o ÚLTIMO passo da
    // sequência inteira (ver comentário no topo do arquivo)
    onEnter: () => switchTab("email"),
    selector: '[data-action="open-account-modal"]',
    text: "toda conta de e-mail nova começa aqui.",
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
  startTipSequence(STEPS, {
    onFinish: () => {
      running = false;
    },
  });
}

/**
 * Dispara a sequência se: (a) o onboarding geral já foi concluído e
 * (b) Organização ainda não está em screen_tips_seen. Mesmo guard de
 * chamada repetida que as outras telas.
 */
export async function maybeStartOrganizacaoTips() {
  if (running) return;
  const profile = store.get("profile");
  if (!profile?.onboarding_completed) return;

  running = true;
  let seen;
  try {
    seen = await getScreenTipsSeen();
  } catch (err) {
    console.error("erro ao checar dicas já vistas de organização:", err);
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
        console.error("erro ao marcar dicas de organização como vistas:", err);
      }
    },
  });
}