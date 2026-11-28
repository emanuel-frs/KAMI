/**
 * O avatar da Kami (assets/logos/logo-kami.gif) nas duas cores da pessoa
 * (2.1.0): um <filter> SVG escondido no <body>, que qualquer <img> com a
 * classe .kami-avatar-gif usa (css/temas.css). Um GIF só, recolorido na
 * hora — continua animado. A matriz vem de components/aparencia.js.
 *
 * Cuidado: `filter` pinta também o background do próprio <img> — quem
 * quiser um fundo atrás do avatar põe num elemento em volta.
 */
const ID = "kami-avatar-cores";

function garantirFiltro() {
  let matriz = document.getElementById(`${ID}-matriz`);
  if (matriz) return matriz;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  const filtro = document.createElementNS(ns, "filter");
  filtro.id = ID;
  filtro.setAttribute("color-interpolation-filters", "sRGB");
  matriz = document.createElementNS(ns, "feColorMatrix");
  matriz.id = `${ID}-matriz`;
  matriz.setAttribute("type", "matrix");
  filtro.appendChild(matriz);
  svg.appendChild(filtro);
  document.body.appendChild(svg);
  return matriz;
}

/** `valores`: a saída de aparencia.matrizAvatar(). */
export function definirCoresAvatar(valores) {
  if (!document.body) return;
  garantirFiltro().setAttribute("values", valores);
}
