import { createDashboardPage } from "./dashboard.js";
import { store } from "../state/store.js";
import { maybeStartCarreiraTips, replayCarreiraTips } from "./carreira-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";

/**
 * Tela parte 1 da fundação (ver carreira-regras-de-negocio.md).
 * Mesmo mecanismo de dashboard configurável de perfil/núcleo/finanças
 * (createDashboardPage), sem cabeçalho de página (mesmo padrão de
 * perfil.js/nucleo.js — sem title/tag/description).
 *
 * Agora com sequência de dicas contextuais (etapa 5, seção 8 item 5),
 * mesmo fiação de nucleo.js/financas.js: onReady guarda grid/container
 * pra poder chamar maybeStartCarreiraTips de novo quando o onboarding
 * geral terminar depois do mount (store.subscribe), e registra a
 * função de replay pro botão de ajuda global (etapa 6).
 */
let currentGrid = null;
let currentContainer = null;
let unsubscribeProfile = null;
let currentReplayFn = null;

const { mount: baseMount, unmount: baseUnmount } = createDashboardPage("carreira", {
  onReady: (grid, container) => {
    currentGrid = grid;
    currentContainer = container;
    maybeStartCarreiraTips(currentGrid, currentContainer);
    unsubscribeProfile = store.subscribe("profile", () => maybeStartCarreiraTips(currentGrid, currentContainer));

    currentReplayFn = () => replayCarreiraTips(currentGrid, currentContainer);
    registerScreenTipsReplay(currentReplayFn);
  },
});

export const mount = baseMount;

export function unmount() {
  cancelActiveTipSequence();
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  currentGrid = null;
  currentContainer = null;
  if (currentReplayFn) clearScreenTipsReplay(currentReplayFn);
  currentReplayFn = null;
  baseUnmount();
}
