// js/api/nucleo.js
import { get, post } from "./client.js";
export const getAttributes = () => get("/api/nucleo/attributes");
export const registerAction = (data) => post("/api/nucleo/actions", data);
export const getLog = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return get(`/api/nucleo/log${qs ? `?${qs}` : ""}`);
};
export const getAchievements = () => get("/api/nucleo/achievements");