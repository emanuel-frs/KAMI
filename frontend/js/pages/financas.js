import { createDashboardPage } from "./dashboard.js";
import { store } from "../state/store.js";
import {
  getIncomeEntries,
  getSummary,
  listDebts,
  listFixedBillPeriods,
  listFixedBills,
  listIncomeSources,
  listTransactions,
} from "../api/financas.js";
import {
  getWalletSummary,
  listBanks,
  listComprasParceladasMes,
  listSubscriptionPeriods,
  listSubscriptions,
} from "../api/carteira.js";
import { maybeStartFinancasTips, replayFinancasTips } from "./financas-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";

// Sem title/tag/description -> createDashboardPage não renderiza page-head.
// Nenhum widget de financas é removable:false, então não há injeção
// automática de widget obrigatório aqui (diferente de perfil/profile) —
// quem chega pela primeira vez encontra o grid vazio de propósito (ver
// financas-tips.js pra como isso afeta a sequência de dicas).
//
// onReady/unmount seguem o mesmo padrão de nucleo.js/perfil.js.
let currentGrid = null;
let currentContainer = null;
let unsubscribeProfile = null;
let currentReplayFn = null;

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Busca os dados dos widgets de finanças durante o boot. O cache do
 * cliente deduplica essas leituras com as chamadas feitas quando os
 * widgets forem montados, deixando a tela pronta sem novo round-trip.
 */
export function preload() {
  const month = currentMonthStr();
  return Promise.allSettled([
    getSummary(month),
    getWalletSummary(),
    listBanks(),
    listIncomeSources(),
    getIncomeEntries(month),
    listFixedBills(),
    listFixedBillPeriods(month),
    listDebts(),
    listTransactions(month),
    listSubscriptions(),
    listSubscriptionPeriods(month),
    listComprasParceladasMes(month),
  ]);
}

const { mount: baseMount, unmount: baseUnmount } = createDashboardPage("financas", {
  onReady: (grid, container) => {
    currentGrid = grid;
    currentContainer = container;
    maybeStartFinancasTips(currentGrid, currentContainer);
    unsubscribeProfile = store.subscribe("profile", () => maybeStartFinancasTips(currentGrid, currentContainer));

    currentReplayFn = () => replayFinancasTips(currentGrid, currentContainer);
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
