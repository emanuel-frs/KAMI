/**
 * Chama da sequência + proteções (GAM-06). A chama é um SVG em pixel art
 * (grade 10×12, `shape-rendering: crispEdges`) — em tamanho pequeno os
 * caracteres de bloco (░▒▓█) não ficam quadrados e o desenho borrava;
 * pixel de verdade mantém o estilo "terminal/pixel" do app nítido.
 * O mesmo SVG serve no card de perfil e na barra lateral; o tamanho vem
 * do CSS (css/streak-flame.css).
 *
 * Três tons, só da paleta do app: borda (cor de destaque atenuada), corpo
 * (cor de destaque) e miolo (--text-bright). A chama cresce em degraus
 * conforme a sequência (1, 3, 7, 14, 30 dias), alinhada pela base; sem
 * sequência fica só a brasa. Sequência viva que ainda não teve ação hoje
 * aparece apagada (`data-dim`, cinza): "acenda" registrando algo.
 *
 * Blindada (`shield`): ontem passou em branco e uma proteção segurou a
 * sequência, mas hoje ainda não teve ação — a chama apagada ganha um
 * contorno de pixel na cor de destaque (o "escudo"), que some quando a
 * primeira ação do dia reacende a chama. O viewBox tem 1 pixel de folga
 * em volta pra caber o contorno, então o tamanho é o mesmo com ou sem ele.
 *
 * Tremor: o SVG traz dois quadros — o desenho e o mesmo espelhado (as
 * pontas balançam pro outro lado) — e o CSS alterna entre eles só com
 * efeitos "completo" e sem prefers-reduced-motion. Nada de timer no JS.
 *
 * Proteções: "◆" guardada, "◇" espaço livre (máx. vem do backend,
 * streak_protections_max). Ver backend/app/sequencia.py pras regras.
 */

const STAGES = [1, 3, 7, 14, 30];
const W = 10;
const H = 12;

// "." vazio · "a" borda · "b" corpo · "c" miolo — uma string por linha
const ART = [
  // 0 — brasa
  ["..........", "..........", "..........", "..........", "..........", "..........",
   "..........", "..........", "..........", "..........", "...abba...", "..abccba.."],
  // 1 — 1 a 2 dias
  ["..........", "..........", "..........", "..........", "..........", "..........",
   "....a.....", "....ab....", "...abb....", "...abba...", "...bcb....", "....bb...."],
  // 2 — 3 a 6 dias
  ["..........", "..........", "..........", "..........", "....a.....", "...ab.....",
   "...abb.a..", "..abbbab..", "..abbbbb..", "..bbcbb...", "..bcccb...", "...bbb...."],
  // 3 — 7 a 13 dias
  ["..........", "..........", "....a.....", "...ab.....", "...abb.a..", "..abbbab..",
   "..abbbbba.", "..bbbbbbb.", ".abbcbbb..", ".bbcccbb..", "..bcccb...", "...bbb...."],
  // 4 — 14 a 29 dias
  ["....a.....", "...ab.....", "...abb..a.", "..abbb.ab.", "..abbbbbb.", ".abbbbbbba",
   ".abbbcbbba", ".bbbcccbb.", ".bbcccbbb.", "..bcccbb..", "..bbcbb...", "...bbb...."],
  // 5 — 30 dias ou mais
  [".a..a...a.", ".a.ab..ab.", ".abbb..bb.", "aabbbbabba", "abbbbbbbba", "abbbbcbbba",
   "abbbcccbba", "bbbcccccbb", "bbbcccccbb", ".bbcccccb.", ".bbbcccbb.", "..bbbbbb.."],
];

/** Degrau da chama: 0 (só brasa) até 5. */
export function flameStage(days) {
  return STAGES.filter((min) => days >= min).length;
}

/** Retângulos do desenho, juntando pixels vizinhos do mesmo tom na linha. */
function rects(lines) {
  let out = "";
  lines.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const tone = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === tone) end++;
      if (tone !== ".") out += `<rect class="sf-${tone}" x="${x}" y="${y}" width="${end - x}" height="1"/>`;
      x = end;
    }
  });
  return out;
}

/**
 * Contorno do escudo: cada pixel vazio (inclusive na folga de 1 pixel em
 * volta da grade) que encosta, na horizontal ou vertical, num pixel pintado.
 */
function shieldRects(lines) {
  const filled = (x, y) => y >= 0 && y < H && x >= 0 && x < W && lines[y][x] !== ".";
  let out = "";
  for (let y = -1; y <= H; y++) {
    for (let x = -1; x <= W; x++) {
      if (filled(x, y)) continue;
      if (filled(x + 1, y) || filled(x - 1, y) || filled(x, y + 1) || filled(x, y - 1)) {
        out += `<rect class="sf-s" x="${x}" y="${y}" width="1" height="1"/>`;
      }
    }
  }
  return out;
}

/**
 * SVG da chama pra `days` dias de sequência. `dim`: apagada (hoje sem
 * ação); `shield`: apagada E segurada por uma proteção (ver acima).
 */
export function flameSvg(days, { dim = false, shield = false } = {}) {
  const stage = flameStage(days);
  const body = rects(ART[stage]);
  return (
    `<svg class="streak-flame" viewBox="-1 -1 ${W + 2} ${H + 2}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"` +
    ` data-stage="${stage}"${dim || shield ? " data-dim" : ""}${shield ? " data-shield" : ""}>` +
    (shield ? `<g class="sf-shield">${shieldRects(ART[stage])}</g>` : "") +
    `<g class="sf-frame-a">${body}</g>` +
    `<g class="sf-frame-b" transform="matrix(-1 0 0 1 ${W} 0)">${body}</g>` +
    `</svg>`
  );
}

export function protectionsText(count, max) {
  return "◆".repeat(count) + "◇".repeat(Math.max(0, max - count));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Frase das proteções, pra tooltip/leitor de tela. */
export function protectionsSummary(player) {
  const parts = [`${player.streak_protections}/${player.streak_protections_max} proteções guardadas`];
  if (player.streak_protections < player.streak_protections_max) {
    parts.push(`próxima em ${plural(player.streak_next_protection_in, "dia", "dias")} com ação`);
  }
  if (player.streak_protected_yesterday) parts.push("ontem foi protegido");
  return parts.join(" · ");
}

/** Se a chama deve aparecer apagada: sequência viva, mas hoje ainda sem ação. */
export function flameDim(player) {
  return player.streak_current > 0 && !player.active_today;
}

/** Se a chama aparece blindada: ontem foi protegido e hoje ainda sem ação. */
export function flameShield(player) {
  return Boolean(player.streak_protected_yesterday) && !player.active_today;
}

/** Opções de flameSvg a partir do /player. */
export function flameOptions(player) {
  return { dim: flameDim(player), shield: flameShield(player) };
}
