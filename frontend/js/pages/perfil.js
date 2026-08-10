import { createDashboardPage } from "./dashboard.js";
import { store } from "../state/store.js";
import { maybeStartPerfilTips, replayPerfilTips } from "./perfil-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";

// Sem title/tag/description -> createDashboardPage não renderiza page-head.
// O widget "profile" (não-removível) é injetado automaticamente pelo
// mecanismo de dashboard.js mesmo que a tela ainda não tenha layout salvo.
//
// onReady/unmount seguem o mesmo padrão de nucleo.js (ver comentário lá
// pra por que a checagem roda duas vezes no primeiro boot).
let currentGrid = null;
let currentContainer = null;
let unsubscribeProfile = null;
let currentReplayFn = null;

const { mount: baseMount, unmount: baseUnmount } = createDashboardPage("perfil", {
  onReady: (grid, container) => {
    currentGrid = grid;
    currentContainer = container;
    maybeStartPerfilTips(currentGrid, currentContainer);
    unsubscribeProfile = store.subscribe("profile", () => maybeStartPerfilTips(currentGrid, currentContainer));

    currentReplayFn = () => replayPerfilTips(currentGrid, currentContainer);
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
