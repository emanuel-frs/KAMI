import { createDashboardPage } from "./dashboard.js";

// Sem title/tag/description -> createDashboardPage não renderiza page-head.
// Nenhum widget de financas é removable:false, então não há injeção
// automática de widget obrigatório aqui (diferente de perfil/profile).
export const { mount, unmount } = createDashboardPage("financas");