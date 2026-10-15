import { store } from "../state/store.js";

/**
 * Tema de terminal escolhido (GAM-10, recompensa por nível) espelhado em
 * <html data-tema="..."> — o visual de cada um está em css/temas.css.
 * "padrao" não põe atributo nenhum (o tema de sempre, tokens.css).
 */
export const THEMES = ["padrao", "fosforo", "crt", "ambar"];

function applyTheme() {
  const tema = store.get("profile")?.tema;
  if (tema && tema !== "padrao" && THEMES.includes(tema)) document.documentElement.dataset.tema = tema;
  else delete document.documentElement.dataset.tema;
}

export function wireTheme() {
  applyTheme();
  store.subscribe("profile", applyTheme);
}
