import { createDashboardPage } from "./dashboard.js";

// Sem title/tag/description -> createDashboardPage não renderiza page-head.
export const { mount, unmount } = createDashboardPage("nucleo");