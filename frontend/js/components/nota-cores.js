// ORG-01: cor opcional da nota — a mesma paleta da cor de destaque do app
// (accent-colors.js), guardada pelo nome ("ambar", "azul"…), não pelo hex.
import { ACCENT_OPTIONS } from "./accent-colors.js";

export const CORES_NOTA = ACCENT_OPTIONS.map((o) => ({
  nome: o.icone,
  hex: o.value,
  get rotulo() {
    return o.label.replace(/ \(.*\)$/, "");
  },
}));
export const corDaNota = (nome) => CORES_NOTA.find((c) => c.nome === nome)?.hex || null;
