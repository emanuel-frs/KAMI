import { store } from "../state/store.js";
import { ACCENT_PADRAO, CORES_PRONTAS, HEX, TEXTURAS, calcularVisual } from "./aparencia.js";
import { definirCoresAvatar } from "./avatar-kami.js";

/**
 * Aparência da pessoa (2.1.0 — antes, GAM-10, um "tema de terminal" de 4)
 * aplicada no <html>: as variáveis de cor calculadas em
 * components/aparencia.js vão no style do <html>, e os data-* dizem onde a
 * textura aparece (css/temas.css). Muda na hora sempre que o perfil muda.
 */

// O visual calculado fica guardado no próprio navegador do app, pra pintar
// a tela ANTES de o perfil chegar do backend: o splash e, principalmente,
// a tela do PIN (SEG-02), que abre com o backend bloqueado — sem isto ela
// aparecia na cor padrão. Não é dado sensível (só a aparência).
const APARENCIA_KEY = "kami:aparencia";

// o que pode vir do cache (que mora no localStorage — tratado como entrada
// de fora: só nomes conhecidos e valores no formato que nós mesmos geramos)
const VALOR_OK = [
  HEX,
  /^url\("data:image\/svg\+xml,[A-Za-z0-9%._~'()!*-]*"\)$/,
  /^\d{1,3}px \d{1,3}px$/,
  /^(none|auto)$/,
];
const DADOS = ["textura", "txTela", "txMenu", "txComp", "tingido", "claro"];
const NOME_VAR = /^--[a-z][a-z_-]*$/;
const MATRIZ_OK = /^[-0-9. ]+$/;

/** Põe um visual (aparencia.calcularVisual) no <html> — a apresentação usa pra prévia. */
export function aplicar({ vars, dados, avatar }) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  for (const k of DADOS) {
    const v = dados[k];
    if (v === null || v === undefined) delete root.dataset[k];
    else root.dataset[k] = v;
  }
  definirCoresAvatar(avatar);
}

function applyTheme() {
  const profile = store.get("profile");
  if (!profile) return; // sem perfil ainda: fica o que restaurarAparencia() pôs
  const visual = calcularVisual(profile.aparencia, profile.accent_color);
  aplicar(visual);
  try {
    localStorage.setItem(APARENCIA_KEY, JSON.stringify(visual));
  } catch {
    // sem localStorage: só perde a aparência na próxima tela do PIN
  }
}

function doCache(salva) {
  // cache de antes da 2.1.0: { accent, tema }
  if (salva && typeof salva.accent === "string" && !salva.vars) {
    const tema = { fosforo: { texto_tingido: true }, crt: { textura: "crt" }, ambar: { paleta: "ambar" } }[salva.tema] || {};
    return calcularVisual(tema, HEX.test(salva.accent) ? salva.accent : ACCENT_PADRAO);
  }
  if (!salva || typeof salva.vars !== "object" || typeof salva.dados !== "object") return null;
  const vars = Object.fromEntries(
    Object.entries(salva.vars).filter(([k, v]) => NOME_VAR.test(k) && typeof v === "string" && VALOR_OK.some((re) => re.test(v)))
  );
  const dados = Object.fromEntries(DADOS.map((k) => {
    const v = salva.dados[k];
    if (k === "textura") return [k, TEXTURAS.includes(v) ? v : "scanline"];
    return [k, v === "" ? "" : null];
  }));
  const avatar = typeof salva.avatar === "string" && MATRIZ_OK.test(salva.avatar) ? salva.avatar : calcularVisual({}, CORES_PRONTAS[0]).avatar;
  return { vars, dados, avatar };
}

/** Chamada no comecinho do boot, antes do splash e da tela do PIN. */
export function restaurarAparencia() {
  let salva = null;
  try {
    salva = JSON.parse(localStorage.getItem(APARENCIA_KEY) || "null");
  } catch {
    return;
  }
  const visual = doCache(salva);
  if (visual) aplicar(visual);
}

export function wireTheme() {
  applyTheme();
  store.subscribe("profile", applyTheme);
}
