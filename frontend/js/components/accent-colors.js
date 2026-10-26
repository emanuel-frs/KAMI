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

// o rótulo sai no idioma atual na hora de ler (cor.<icone> nos dicionários)
const cor = (value, avatar, icone) => ({
  value,
  avatar,
  icone,
  get label() {
    return t(`cor.${icone}`);
  },
});

export const ACCENT_OPTIONS = [
  cor("#8fbf8f", "assets/logos/logo-kami.gif", "verde"),
  cor("#b3a06a", "assets/logos/logo-kami-ambar.gif", "ambar"),
  cor("#8fa8bf", "assets/logos/logo-kami-azul.gif", "azul"),
  cor("#b06060", "assets/logos/logo-kami-vermelho.gif", "vermelho"),
  cor("#c9c9c9", "assets/logos/logo-kami-cinza.gif", "cinza"),
  cor("#c9a0dc", "assets/logos/logo-kami-lilas.gif", "lilas"),
  cor("#e0c15a", "assets/logos/logo-kami-dourado.gif", "dourado"),
  cor("#5ac8c8", "assets/logos/logo-kami-turquesa.gif", "turquesa"),
  cor("#e08fa0", "assets/logos/logo-kami-coral.gif", "coral"),
];

export function accentLabel(hex) {
  return ACCENT_OPTIONS.find((o) => o.value === hex)?.label ?? hex;
}

export function accentAvatar(hex) {
  return ACCENT_OPTIONS.find((o) => o.value === hex)?.avatar ?? ACCENT_OPTIONS[0].avatar;
}
// ICO-01: nome do ícone do app nessa cor (src-tauri/icons/themes/<nome>/)
export function accentIcone(hex) {
  return ACCENT_OPTIONS.find((o) => o.value === hex)?.icone ?? "verde";
}
