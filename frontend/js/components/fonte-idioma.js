/**
 * components/fonte-idioma.js — aviso de fonte faltando (I18N-04, P-85).
 *
 * O Kami usa as fontes do sistema (css/tokens.css › :lang). Num Linux
 * mínimo pode não haver fonte com ideogramas (zh/ja/ko) ou devanágari
 * (hi): o texto vira quadradinhos. O backend pergunta ao fontconfig
 * (GET /api/sistema/fonte/<idioma>); faltando, um aviso com o pacote de
 * cada distribuição.
 *
 * O aviso é em INGLÊS de propósito: no idioma que está sem fonte ele
 * também sairia em quadradinhos. No máximo uma vez por dia por idioma.
 */
import { get } from "../api/client.js";
import { showToast } from "./toast.js";

const PACOTES = {
  cjk: { fedora: "google-noto-sans-cjk-fonts", debian: "fonts-noto-cjk", arch: "noto-fonts-cjk" },
  hi: { fedora: "google-noto-sans-devanagari-fonts", debian: "fonts-noto-core", arch: "noto-fonts" },
};
const ESCRITA = { zh: "cjk", ja: "cjk", ko: "cjk", hi: "hi" };
const NOME = { zh: "Chinese", ja: "Japanese", ko: "Korean", hi: "Hindi" };

/** Texto do aviso (puro, testado). */
export function textoDoAviso(idioma) {
  const p = PACOTES[ESCRITA[idioma]];
  if (!p) return null;
  return {
    title: `no ${NOME[idioma]} font found on this system`,
    message:
      `the text may show up as empty boxes. install one and reopen kami — ` +
      `Fedora: sudo dnf install ${p.fedora} · Debian/Ubuntu: sudo apt install ${p.debian} · Arch: sudo pacman -S ${p.arch}`,
  };
}

function jaAvisouHoje(idioma) {
  const chave = `kami:fonte-avisada:${idioma}`;
  const hoje = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(chave) === hoje) return true;
    localStorage.setItem(chave, hoje);
  } catch {
    /* sem localStorage: avisa de novo na próxima abertura */
  }
  return false;
}

export async function avisarSeFaltarFonte(idioma) {
  const aviso = textoDoAviso(idioma);
  if (!aviso) return;
  let tem = true;
  try {
    ({ tem } = await get(`/api/sistema/fonte/${idioma}`));
  } catch {
    return; // backend fora: tenta na próxima abertura
  }
  if (tem !== false || jaAvisouHoje(idioma)) return;
  showToast({ ...aviso, iconName: "triangle-alert", duration: 0 });
}
