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
  { value: "#8fbf8f", label: "verde fósforo (padrão)" },
  { value: "#b3a06a", label: "âmbar" },
  { value: "#8fa8bf", label: "azul acinzentado" },
  { value: "#b06060", label: "vermelho fosco" },
  { value: "#c9c9c9", label: "cinza claro (mono puro)" },
  { value: "#c9a0dc", label: "lilás" },
  { value: "#e0c15a", label: "dourado" },
  { value: "#5ac8c8", label: "turquesa" },
  { value: "#e08fa0", label: "coral" },
];

export function accentLabel(hex) {
  return ACCENT_OPTIONS.find((o) => o.value === hex)?.label ?? hex;
}
