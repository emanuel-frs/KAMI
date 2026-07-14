import { get, put } from "./client.js";

/**
 * Layout de widgets por tela ('perfil' | 'nucleo').
 * getLayout: GET  /api/dashboard/{screen}
 * saveLayout: PUT /api/dashboard/{screen} — REPLACE COMPLETO (manda a
 * lista inteira; ver decisão 17 no kami_projeto.txt pra contexto de
 * por que não é CRUD incremental por item).
 */
export const getLayout = (screen) => get(`/api/dashboard/${screen}`);

export const saveLayout = (screen, widgets) =>
  put(`/api/dashboard/${screen}`, { widgets });
// widgets: [{ widget_type, width, height?, config_json? }, ...]
