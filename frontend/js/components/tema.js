import { store } from "../state/store.js";

/**
 * Tema de terminal escolhido (GAM-10, recompensa por nível) espelhado em
 * <html data-tema="..."> — o visual de cada um está em css/temas.css.
 * "padrao" não põe atributo nenhum (o tema de sempre, tokens.css).
 */
export const THEMES = ["padrao", "fosforo", "crt", "ambar"];

// Cor de destaque e tema guardados no próprio navegador do app, pra pintar
// a tela ANTES de o perfil chegar do backend: o splash e, principalmente,
// a tela do PIN (SEG-02), que abre com o backend bloqueado — sem isto ela
// aparecia na cor padrão. Não é dado sensível (só a aparência).
const APARENCIA_KEY = "kami:aparencia";
const ACCENT_RE = /^#[0-9a-f]{6}$/i;

function setTheme(tema) {
  if (tema && tema !== "padrao" && THEMES.includes(tema)) document.documentElement.dataset.tema = tema;
  else delete document.documentElement.dataset.tema;
}

function applyTheme() {
  const profile = store.get("profile");
  if (!profile) return; // sem perfil ainda: fica o que restaurarAparencia() pôs
  setTheme(profile.tema);
  try {
    localStorage.setItem(APARENCIA_KEY, JSON.stringify({ accent: profile.accent_color, tema: profile.tema }));
  } catch {
    // sem localStorage: só perde a cor na próxima tela do PIN
  }
}

/** Chamada no comecinho do boot, antes do splash e da tela do PIN. */
export function restaurarAparencia() {
  let salva = null;
  try {
    salva = JSON.parse(localStorage.getItem(APARENCIA_KEY) || "null");
  } catch {
    return;
  }
  if (!salva) return;
  if (typeof salva.accent === "string" && ACCENT_RE.test(salva.accent)) {
    document.documentElement.style.setProperty("--accent", salva.accent);
  }
  setTheme(salva.tema);
}

export function wireTheme() {
  applyTheme();
  store.subscribe("profile", applyTheme);
}
