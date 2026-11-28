import { t } from "../i18n.js";
/**
 * Paleta de cores de destaque — fonte única.
 *
 * Antes existiam DUAS listas divergentes: esta (usada pelo widget de
 * perfil pra editar accent_color) e outra, com hexadecimais diferentes,
 * duplicada dentro do antigo setup-modal.js (hoje kami-intro.js, etapa
 * 3 do onboarding). Resultado: quem escolhia uma cor no onboarding
 * salvava um hex que não batia com nenhuma opção da tela de perfil —
 * accentLabel() caía no fallback (hex cru) lá. Consolidado aqui; tanto
 * o widget de perfil quanto o diálogo do kami importam deste módulo.
 */

// o rótulo sai no idioma atual na hora de ler (cor.<nome> nos dicionários).
// 2.1.0: as 9 continuam livres; o avatar e o ícone do app não têm mais um
// arquivo por cor — são recoloridos na hora (components/avatar-kami.js,
// src-tauri/src/icone_tema.rs), então qualquer cor serve.
const cor = (value, nome) => ({
  value,
  nome,
  get label() {
    return t(`cor.${nome}`);
  },
});

export const ACCENT_OPTIONS = [
  cor("#8fbf8f", "verde"),
  cor("#b3a06a", "ambar"),
  cor("#8fa8bf", "azul"),
  cor("#b06060", "vermelho"),
  cor("#c9c9c9", "cinza"),
  cor("#c9a0dc", "lilas"),
  cor("#e0c15a", "dourado"),
  cor("#5ac8c8", "turquesa"),
  cor("#e08fa0", "coral"),
];

/** O nome da cor pronta, ou o próprio hex (cor livre). */
export function accentLabel(hex) {
  return ACCENT_OPTIONS.find((o) => o.value === hex?.toLowerCase())?.label ?? hex;
}
