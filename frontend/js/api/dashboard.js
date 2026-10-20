import { get, post, put } from "./client.js";

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

// LAY-02/05: layout padrão da tela (restaurar; tamanho de widget readicionado)
export const getLayoutPadrao = (screen) => get(`/api/dashboard/${screen}/padrao`);
// P-23: o layout padrão mudou desde a última vez? quais telas estão diferentes
export const getNovidadeLayout = () => get(`/api/dashboard/novidade?t=${Date.now()}`);
// aplicar=true devolve { aplicadas, anteriores: { tela: [widgets] } } pro desfazer
export const responderNovidadeLayout = (aplicar) => post("/api/dashboard/novidade", { aplicar });
