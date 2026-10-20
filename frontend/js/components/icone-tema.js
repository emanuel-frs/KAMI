/**
 * Ícone do app na cor de destaque (ICO-01) — opcional, desligado por
 * padrão (P-08), em configurações › aparência.
 *
 * Quem troca o ícone é o Rust (src-tauri/src/icone_tema.rs): janela e barra
 * de tarefas na hora; atalho do Menu Iniciar (Windows) e lançador (Linux)
 * na próxima abertura. Aqui só se decide QUANDO chamar: na abertura (o
 * ícone da janela não fica salvo entre execuções) e sempre que a cor ou a
 * opção mudam no perfil. Fora do app instalado (navegador do modo dev) não
 * faz nada.
 */
import { store } from "../state/store.js";
import { accentIcone } from "./accent-colors.js";

const JA_APLICOU_KEY = "kami:icone-tema-aplicado";
let aplicado = null; // nome da cor aplicada nesta execução, ou "padrao"

function lembrar(valor) {
  try {
    if (valor) localStorage.setItem(JA_APLICOU_KEY, "1");
    else localStorage.removeItem(JA_APLICOU_KEY);
  } catch {
    // sem localStorage: no pior caso desfaz de novo na próxima abertura
  }
}

function jaAplicouAntes() {
  try {
    return localStorage.getItem(JA_APLICOU_KEY) === "1";
  } catch {
    return true;
  }
}

async function sincronizar(invoke) {
  const profile = store.get("profile");
  if (!profile) return;
  const cor = profile.icone_tema ? accentIcone(profile.accent_color) : null;
  const chave = cor ?? "padrao";
  if (chave === aplicado) return;
  // desligado e nunca ligado antes: não há nada pra desfazer (evita rodar o
  // PowerShell dos atalhos a cada abertura no Windows)
  if (!cor && aplicado === null && !jaAplicouAntes()) {
    aplicado = "padrao";
    return;
  }
  aplicado = chave;
  try {
    await invoke("aplicar_icone_tema", { cor });
    lembrar(Boolean(cor));
  } catch (err) {
    aplicado = null; // tenta de novo na próxima mudança do perfil
    console.warn("não deu pra trocar o ícone do app:", err);
  }
}

let desinscrever = null;

export function wireIconeTema() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;
  desinscrever?.(); // chamado de novo: substitui, não acumula
  desinscrever = store.subscribe("profile", () => sincronizar(invoke));
  sincronizar(invoke);
}

export function _resetIconeTemaForTests() {
  desinscrever?.();
  desinscrever = null;
  aplicado = null;
}
