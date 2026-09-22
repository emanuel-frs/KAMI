// js/widgets/attributes.js
import { getAttributes } from "../api/nucleo.js";
import { escapeHtml } from "../components/format.js";

/**
 * Radar pentagonal (SVG pontilhado) — substitui as antigas barras de
 * nível. Um dos 5 atributos por vértice (ordem fixa em VERTEX_ORDER,
 * não a ordem alfabética que a API devolve), com sigla de 3 letras no
 * canto + `data-tooltip` (sistema global em components/tooltip.js) com
 * o nome completo e o nível/progresso.
 *
 * É SVG, não caractere — depois de duas tentativas em grade de texto
 * (onde a proporção do pentágono dependia da métrica exata da fonte
 * renderizada, e sempre saía torto/borrado numa resolução pequena),
 * ficou claro que só geometria de verdade (coordenadas de usuário do
 * SVG, sem depender de largura de glifo) dá o contorno nítido do
 * exemplo. O viewBox tem R igual em X e Y (pentágono regular de
 * verdade) — o "quase ascii" pedido original vira aqui o estilo
 * pontilhado (stroke-dasharray) em vez de caracteres, mesma sensação
 * "técnica/baixa resolução", sem o problema de aspecto.
 */

const VB_W = 120;
const VB_H = 104;
const CX = 60;
const CY = 50;
const R = 46;

// ordem fixa dos vértices, sentido horário a partir do topo — não é a
// ordem alfabética da API (aprendizado, carreira, financas, metas,
// organizacao), é a ordem VISUAL: topo, dir-cima, dir-baixo, esq-baixo,
// esq-cima.
const VERTEX_ORDER = ["aprendizado", "carreira", "financas", "metas", "organizacao"];
const LABEL_CLASS = ["lbl-top", "lbl-ur", "lbl-lr", "lbl-ll", "lbl-ul"];

function vertex(i, frac) {
  const angle = ((i * 72) / 180) * Math.PI;
  return { x: CX + frac * R * Math.sin(angle), y: CY - frac * R * Math.cos(angle) };
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// hash determinístico (não Math.random) — a nuvem de pontos internos
// tem que ficar igual toda vez que o widget renderiza, não piscar
// diferente a cada refresh
function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function polygonPath(pts) {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function buildSvg(fracs) {
  const outer = [0, 1, 2, 3, 4].map((i) => vertex(i, 1));
  const mid = [0, 1, 2, 3, 4].map((i) => vertex(i, 0.66));
  const inner = [0, 1, 2, 3, 4].map((i) => vertex(i, 0.33));
  const dataPts = fracs.map((f, i) => vertex(i, Math.max(f, 0.08)));

  const spokes = outer
    .map((v) => `<line x1="${CX}" y1="${CY}" x2="${v.x.toFixed(1)}" y2="${v.y.toFixed(1)}" class="pg-spoke" />`)
    .join("");

  // nuvem de pontos internos ao polígono de dados — textura tipo
  // "ruído" (mais densa perto do centroide), não um preenchimento
  // sólido — mesmo efeito visual do exemplo (grafico de habilidades)
  const cxData = dataPts.reduce((s, p) => s + p.x, 0) / dataPts.length;
  const cyData = dataPts.reduce((s, p) => s + p.y, 0) / dataPts.length;
  let stipple = "";
  for (let n = 0; n < 90; n++) {
    const hx = hash(n * 3.1);
    const hy = hash(n * 7.7 + 1);
    const px = CX - R + hx * R * 2;
    const py = CY - R + hy * R * 2;
    if (!pointInPolygon(px, py, dataPts)) continue;
    const d = Math.hypot(px - cxData, py - cyData);
    if (hash(n * 5.3 + 2) > Math.max(0.15, 1 - d / (R * 0.8))) continue; // mais rarefeito longe do centroide
    stipple += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="0.55" class="pg-stipple" />`;
  }

  return `
    <svg viewBox="0 0 ${VB_W} ${VB_H}" class="pg-svg" preserveAspectRatio="xMidYMid meet">
      <polygon points="${polygonPath(outer)}" class="pg-outer" />
      <polygon points="${polygonPath(mid)}" class="pg-mid" />
      <polygon points="${polygonPath(inner)}" class="pg-inner" />
      ${spokes}
      <circle cx="${CX}" cy="${CY}" r="1" class="pg-center-dot" />
      ${stipple}
      <polygon points="${polygonPath(dataPts)}" class="pg-data-poly" />
      ${dataPts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.6" class="pg-data-dot" />`).join("")}
    </svg>`;
}

function labelStyle(i) {
  const v = vertex(i, 1);
  return `left:${((v.x / VB_W) * 100).toFixed(1)}%;top:${((v.y / VB_H) * 100).toFixed(1)}%`;
}

/** Radar pentagonal — clicar num vértice filtra o widget log.js (evento global). */
export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando atributos…</div>';
  let attributes;
  try {
    attributes = await getAttributes();
  } catch (err) {
    el.innerHTML = `<div class="empty-state">erro ao carregar atributos: ${err.message}</div>`;
    return;
  }

  // reordena pra VERTEX_ORDER; atributo que a API não devolveu (banco
  // fora de sincronia com DEFAULT_ATTRIBUTES) some do desenho em vez
  // de quebrar o layout
  const byName = new Map(attributes.map((a) => [a.name, a]));
  const vertices = VERTEX_ORDER.map((name) => byName.get(name)).filter(Boolean);

  let activeFilter = "all";

  function draw() {
    // o pentágono compara NÍVEL entre as áreas, não o progresso dentro
    // do nível atual (isso já fica só no tooltip, com "faltam X%") —
    // sem um teto fixo de nível no backend (curva RPG em xp.py é
    // aberta), a normalização usa o maior nível do grupo como
    // denominador — MAS com um piso (LEVEL_SCALE_FLOOR): sem ele, uma
    // conta nova (todo mundo nível 1) vira 1/1 = 100% em todo eixo, e
    // o pentágono nasce parecendo "maxado" em vez de "começando agora".
    // Com o piso, o desenho começa pequeno/perto do centro e só passa
    // a comparar de verdade (relativo ao mais alto do grupo) depois
    // que alguém ultrapassa o piso.
    const LEVEL_SCALE_FLOOR = 10;
    const maxLevel = Math.max(LEVEL_SCALE_FLOOR, ...vertices.map((a) => a.current_level));
    const fracs = vertices.map((a) =>
      activeFilter === "all" || activeFilter === a.name ? a.current_level / maxLevel : 0
    );

    const labels = vertices
      .map((a, i) => {
        const cls = LABEL_CLASS[i] || "";
        const sigla = a.name.slice(0, 3).toUpperCase();
        const tip = `${a.name} — nível ${a.current_level} · faltam ${100 - a.pct}% pro próximo nível`;
        const on = activeFilter === a.name ? " on" : "";
        return `<span class="pg-label ${cls}${on}" style="${labelStyle(i)}" data-filter="${escapeHtml(
          a.name
        )}" data-tooltip="${escapeHtml(tip)}">${sigla}</span>`;
      })
      .join("");

    el.innerHTML = `
      <div class="pg-center">
        <div class="pg-wrap">
          ${buildSvg(fracs)}
          ${labels}
        </div>
      </div>`;
  }

  draw();

  el.addEventListener("click", (e) => {
    const label = e.target.closest("[data-filter]");
    const name = label ? label.dataset.filter : null;
    activeFilter = name && activeFilter !== name ? name : "all";
    draw();
    window.dispatchEvent(
      new CustomEvent("kami:nucleo-filter", { detail: { attribute: activeFilter } })
    );
  });

  // atualiza níveis/pct quando uma ação é registrada em outro widget da tela
  window.addEventListener("kami:action-registered", async () => {
    try {
      attributes = await getAttributes();
      const updated = new Map(attributes.map((a) => [a.name, a]));
      vertices.forEach((v, i) => {
        const fresh = updated.get(v.name);
        if (fresh) vertices[i] = fresh;
      });
      draw();
    } catch {
      /* silencioso — próxima ação ou reload manual resolve */
    }
  });
}