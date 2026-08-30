import { createDashboardPage } from "./dashboard.js";

/**
 * Tela parte 1 da fundação (ver carreira-regras-de-negocio.md).
 * Mesmo mecanismo de dashboard configurável de perfil/núcleo/finanças
 * (createDashboardPage), sem cabeçalho de página (mesmo padrão de
 * perfil.js/nucleo.js — sem title/tag/description).
 *
 * Sem sequência de dicas contextuais ainda nesta parte (diferente de
 * financas.js/nucleo.js) — entra numa parte futura junto do resto do
 * polish da tela.
 */
export const { mount, unmount } = createDashboardPage("carreira");
