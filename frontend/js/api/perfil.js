import { get, put } from "./client.js";

export const getProfile = () => get("/api/perfil");
export const updateProfile = (data) => put("/api/perfil", data); // { display_name?, accent_color?, notif_alerts_enabled?, notif_email_enabled?, efeitos_visuais?, titulo?, tema? }
export const getPaisesFeriados = () => get("/api/perfil/paises-feriados"); // I18N-06: { paises: ["BR", …] }
export const updateAvatar = (avatarAscii) => put("/api/perfil/avatar", { avatar_ascii: avatarAscii });
export const updateOnboarding = (completed) => put("/api/perfil/onboarding", { completed });
// MAN-05: "visto" por dica ('<tela>/<id>'); as rotas antigas /tips (por
// tela) continuam no backend, mas o app não grava mais nelas
export const getDicasVistas = () => get("/api/perfil/dicas"); // { vistas: [...], telas_antigas: [...] }
export const marcarDicasVistas = (dicas) => put("/api/perfil/dicas", { dicas });