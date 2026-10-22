import { get, post, put } from "./client.js";

// CONF-08: cópias automáticas do banco (app/backup_auto.py)
export const getBackups = () => get(`/api/backups?t=${Date.now()}`);
export const verificarBackups = () => post("/api/backups/verificar", {});
export const copiarAgora = () => post("/api/backups/agora", {});
export const definirPastaExtra = (pasta) => put("/api/backups/pasta-extra", { pasta: pasta || null });
export const restaurarCopia = (nome) => post("/api/backups/restaurar", { nome, confirmation: "restaurar" });
