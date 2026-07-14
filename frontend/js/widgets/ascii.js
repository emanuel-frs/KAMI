/**
 * Conversor de imagem -> ASCII e auto-fit de texto monoespaçado.
 * Portado de kami_telas_final.html (capítulo 04_ascii-lab) — mesma lógica
 * de luminância ponderada (Rec. 709) e busca binária de font-size, só
 * fatorada em funções reutilizáveis pro modal de avatar (decisão 18) e
 * pro mini-preview do widget de perfil.
 */

export const ASCII_RAMPS = {
  detalhada: " .:-=+*#%@",
  simples: " .*#@",
  blocos: " ░▒▓█",
  alto_contraste: " .,:;icodxwXWM@",
};

// caracteres monoespaçados são ~2x mais altos que largos — compensa isso
// na hora de derivar quantas linhas (rows) cabem pra uma dada largura (cols)
const CHAR_ASPECT = 0.55;

let measureCanvas = null;

export function measureMonoCharWidth(fontFamily, fontSizePx) {
  measureCanvas = measureCanvas || document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  ctx.font = `${fontSizePx}px ${fontFamily}`;
  return ctx.measureText("0").width;
}

/**
 * Ajusta font-size/line-height de um <pre> via busca binária pra fazer o
 * texto inteiro (todas as linhas/colunas) caber no espaço disponível do
 * container, sem precisar de scroll nem cortar a arte.
 */
export function fitAsciiText(preEl, text, opts = {}) {
  const lines = text.split("\n");
  const cols = Math.max(1, ...lines.map((l) => l.length));
  const rows = Math.max(1, lines.length);
  const container = opts.container || preEl.parentElement;
  const availW = (opts.maxWidth || container.clientWidth) - (opts.paddingX ?? 14);
  const availH = opts.maxHeight ? opts.maxHeight - (opts.paddingY ?? 12) : null;
  const minFont = opts.minFont ?? 1.4;
  const maxFont = opts.maxFont ?? 11;
  const fontFamily = getComputedStyle(preEl).fontFamily;

  let lo = minFont;
  let hi = maxFont;
  let best = minFont;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const charW = measureMonoCharWidth(fontFamily, mid);
    const fitsWidth = charW * cols <= availW;
    const fitsHeight = availH ? mid * rows <= availH : true;
    if (fitsWidth && fitsHeight) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  preEl.style.fontSize = `${best.toFixed(2)}px`;
  preEl.style.lineHeight = `${best.toFixed(2)}px`;
}

/**
 * Converte uma imagem (HTMLImageElement já carregada, via onload) em texto
 * ASCII. `cols` define a resolução horizontal; a altura é derivada da
 * proporção original da imagem, compensando o aspect-ratio do caractere.
 * Aceita um <canvas> reutilizável (opcional) pra evitar recriar um a cada
 * chamada durante o preview ao vivo.
 */
export function imageToAscii(img, { cols = 70, ramp = ASCII_RAMPS.blocos, invert = false, canvas } = {}) {
  const rows = Math.max(1, Math.round(cols * (img.height / img.width) * CHAR_ASPECT));
  const cv = canvas || document.createElement("canvas");
  cv.width = cols;
  cv.height = rows;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, cols, rows);
  ctx.drawImage(img, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const chars = invert ? ramp.split("").reverse().join("") : ramp;

  let out = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const bright = a === 0 ? 0 : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const idx = Math.min(chars.length - 1, Math.floor(bright * chars.length));
      out += chars[idx];
    }
    out += "\n";
  }
  return { ascii: out, cols, rows };
}