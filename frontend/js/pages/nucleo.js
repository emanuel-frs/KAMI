import { createDashboardPage } from "./dashboard.js";
import { store } from "../state/store.js";
import { maybeStartNucleoTips, replayNucleoTips } from "./nucleo-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";

// Sem title/tag/description -> createDashboardPage não renderiza page-head.
//
// onReady (etapa 5): dispara a checagem das
// dicas contextuais assim que o grid monta, e de novo via
// store.subscribe("profile") sempre que o perfil mudar — necessário
// porque no primeiro boot o Núcleo já monta ANTES do onboarding geral
// terminar (ver boot() em app.js: showPage("nucleo") roda antes de
// openKamiIntro/openOnboardingModal), então a primeira checagem aqui
// sempre falha o gate de onboarding_completed; a segunda, disparada
// quando onboarding-modal.js atualiza o store ao fechar, é quem
// efetivamente inicia a sequência pra quem está de fato num boot novo.
let currentGrid = null;
let currentContainer = null;
let unsubscribeProfile = null;
let currentReplayFn = null;

const { mount: baseMount, unmount: baseUnmount } = createDashboardPage("nucleo", {
  onReady: (grid, container) => {
    currentGrid = grid;
    currentContainer = container;
    maybeStartNucleoTips(currentGrid, currentContainer);
    unsubscribeProfile = store.subscribe("profile", () => maybeStartNucleoTips(currentGrid, currentContainer));

    // etapa 6: expõe o replay pro botão de ajuda global (ver
    // screen-tips-registry.js) — "rever dicas desta tela" chama isso
    // quando o usuário está no Núcleo.
    currentReplayFn = () => replayNucleoTips(currentGrid, currentContainer);
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
