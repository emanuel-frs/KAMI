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

export const ACCENT_OPTIONS = [
  { value: "#8fbf8f", label: "verde fósforo (padrão)", avatar: "assets/logos/logo-kami.gif" },
  { value: "#b3a06a", label: "âmbar", avatar: "assets/logos/logo-kami-ambar.gif" },
  { value: "#8fa8bf", label: "azul acinzentado", avatar: "assets/logos/logo-kami-azul.gif" },
  { value: "#b06060", label: "vermelho fosco", avatar: "assets/logos/logo-kami-vermelho.gif" },
  { value: "#c9c9c9", label: "cinza claro (mono puro)", avatar: "assets/logos/logo-kami-cinza.gif" },
  { value: "#c9a0dc", label: "lilás", avatar: "assets/logos/logo-kami-lilas.gif" },
  { value: "#e0c15a", label: "dourado", avatar: "assets/logos/logo-kami-dourado.gif" },
  { value: "#5ac8c8", label: "turquesa", avatar: "assets/logos/logo-kami-turquesa.gif" },
  { value: "#e08fa0", label: "coral", avatar: "assets/logos/logo-kami-coral.gif" },
];

export function accentLabel(hex) {
  return ACCENT_OPTIONS.find((o) => o.value === hex)?.label ?? hex;
}

export function accentAvatar(hex) {
  return ACCENT_OPTIONS.find((o) => o.value === hex)?.avatar ?? ACCENT_OPTIONS[0].avatar;
}