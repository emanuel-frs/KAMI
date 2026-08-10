import { get, put } from "./client.js";

export const getProfile = () => get("/api/perfil");
export const updateProfile = (data) => put("/api/perfil", data); // { display_name?, accent_color? }
export const updateAvatar = (avatarAscii) => put("/api/perfil/avatar", { avatar_ascii: avatarAscii });
export const updateOnboarding = (completed) => put("/api/perfil/onboarding", { completed });
export const getScreenTipsSeen = () => get("/api/perfil/tips");
export const markScreenTipsSeen = (screen) => put(`/api/perfil/tips/${screen}`);