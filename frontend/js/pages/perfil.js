import { createDashboardPage } from "./dashboard.js";

// Sem title/tag/description -> createDashboardPage não renderiza page-head.
// O widget "profile" (não-removível) é injetado automaticamente pelo
// mecanismo de dashboard.js mesmo que a tela ainda não tenha layout salvo.
export const { mount, unmount } = createDashboardPage("perfil");