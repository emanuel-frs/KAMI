// js/api/nucleo.js
import { get, post } from "./client.js";
export const getAttributes = () => get("/api/nucleo/attributes");
export const registerAction = (data) => post("/api/nucleo/actions", data);
export const getLog = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return get(`/api/nucleo/log${qs ? `?${qs}` : ""}`);
};
export const getAchievements = () => get("/api/nucleo/achievements");
export const getPlayer = () => get("/api/nucleo/player");
// GAM-06: aviso "sequência salva" já mostrado (components/streak-notice.js)
export const markStreakSavedSeen = (days) => post("/api/nucleo/streak-saved/seen", { days });
// revisão do xp antigo (app/revisao_xp.py): GET só simula, POST aplica
// (e guarda uma cópia do banco antes)
export const previewXpReview = () => get("/api/nucleo/xp-review");
export const applyXpReview = () => post("/api/nucleo/xp-review", {});