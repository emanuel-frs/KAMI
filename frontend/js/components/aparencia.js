/**
 * Aparência personalizável (2.1.0) — a parte
 * pura: dado o `profile.aparencia` (backend/app/aparencia.py) e a cor de
 * destaque, calcula TODOS os tokens de cor do app, a textura e a matriz que
 * recolore o avatar da Kami. Quem aplica no <html> é components/tema.js.
 *
 * Por que o cálculo fica aqui e não em color-mix() no CSS: o contraste. Com
 * cor livre, um tom derivado pode ficar ilegível, e o CSS não sabe medir —
 * aqui cada tom apagado é empurrado até o mínimo do WCAG (4,5:1 no texto,
 * 3:1 nas bordas de botão) quando "ajustar contraste" está ligado.
 *
 * As duas paletas prontas têm os tokens EXATOS de sempre (tokens.css e o
 * antigo tema âmbar) — só a personalizada é derivada das 4 cores-base.
 */
import { ACCENT_OPTIONS } from "./accent-colors.js";

export const CORES_PRONTAS = ACCENT_OPTIONS.map((o) => o.value);
export const ACCENT_PADRAO = "#8fbf8f";

// tokens.css — o tema de sempre
const TOKENS_PADRAO = {
  "--bg": "#000000", "--bg-alt": "#0a0a0a", "--panel": "#050505", "--card": "#0d0d0d",
  "--border": "#3c3c3c", "--border-soft": "#242424", "--border-interactive": "#5c5c5c",
  "--text": "#c9c9c9", "--text-bright": "#f2f2f2", "--text-dim": "#8a8a8a", "--text-faint": "#7c7c7c",
};
// o antigo tema "âmbar clássico" (GAM-10, nível 15)
const TOKENS_AMBAR = {
  "--bg": "#080603", "--bg-alt": "#0f0b06", "--panel": "#0b0805", "--card": "#14100a",
  "--border": "#40352a", "--border-soft": "#2a2218", "--border-interactive": "#6b5a43",
  "--text": "#d8cbb2", "--text-bright": "#f6ecd6", "--text-dim": "#a09279", "--text-faint": "#8f826a",
};
export const PALETAS = { padrao: TOKENS_PADRAO, ambar: TOKENS_AMBAR };
export const SEMANTICAS_PADRAO = { "--red": "#b36767", "--green": "#7fd97f", "--amber": "#b3a06a" };

// as 4 cores-base da paleta personalizada (começa com as do tema padrão)
export const CORES_BASE_PADRAO = { bg: "#000000", superficie: "#0d0d0d", borda: "#3c3c3c", texto: "#c9c9c9" };

export const TEXTURAS = ["nenhuma", "scanline", "crt", "grade", "pontilhado"];
// ajustes de cada textura: espaçamento (px), espessura/tamanho do ponto (px)
// e intensidade (1–10; 3 = a opacidade de sempre) — mesmos limites do backend
export const TX_PADRAO = {
  scanline: { esp: 3, gros: 1, int: 3 }, crt: { esp: 3, gros: 1, int: 3 },
  grade: { esp: 8, gros: 1, int: 3 }, pontilhado: { esp: 3, gros: 1, int: 3 },
};
export const TX_LIMITES = {
  scanline: { esp: [2, 16], gros: [1, 6] }, crt: { esp: [2, 16], gros: [1, 6] },
  grade: { esp: [4, 64], gros: [1, 8] }, pontilhado: { esp: [2, 32], gros: [1, 12] },
};
const TX_OPAC = { scanline: 0.018, crt: 0.05, grade: 0.03, pontilhado: 0.05 };

export const TIPOS_CALENDARIO = [
  "conta_fixa", "divida", "assinatura", "parcela", "meta", "acao",
  "evento", "contrato_fim", "revisao_salarial", "lembrete",
];
// a cor "de sempre" de cada tipo (tokens.css) — o que "padrão" quer dizer
export const CAL_PADRAO = {
  conta_fixa: "--text-dim", divida: "--red", assinatura: "--amber", parcela: "--text-faint",
  meta: "--accent", acao: "--accent-dim", evento: "#7fa8d9", contrato_fim: "--red",
  revisao_salarial: "--amber", lembrete: "#c9a0dc",
};
export const TOKENS_FIXAVEIS = [
  "--bg-alt", "--panel", "--border-soft", "--border-interactive", "--text-bright",
  "--text-dim", "--text-faint", "--accent-dim", "--red", "--green", "--amber",
];

export const aparenciaPadrao = () => ({
  paleta: "padrao",
  cores: { ...CORES_BASE_PADRAO },
  fixos: {},
  contraste_auto: true,
  textura: "scanline",
  textura_lugares: { tela: true, menu: true, componentes: true },
  textura_ajustes: JSON.parse(JSON.stringify(TX_PADRAO)),
  texto_tingido: false,
  avatar: { contorno: "#000000", preenchimento: null },
  calendario: {},
});

/** Completa uma aparência parcial (cache antigo, perfil sem a chave) com o padrão. */
export function completar(ap) {
  const p = aparenciaPadrao();
  if (!ap || typeof ap !== "object") return p;
  const hexOk = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => HEX.test(v)));
  return {
    ...p,
    ...ap,
    paleta: ["padrao", "ambar", "personalizada"].includes(ap.paleta) ? ap.paleta : "padrao",
    textura: TEXTURAS.includes(ap.textura) ? ap.textura : "scanline",
    cores: { ...p.cores, ...hexOk(ap.cores) },
    fixos: hexOk(ap.fixos),
    calendario: hexOk(ap.calendario),
    textura_lugares: { ...p.textura_lugares, ...(ap.textura_lugares || {}) },
    textura_ajustes: Object.fromEntries(Object.keys(TX_PADRAO).map((k) => [k, { ...TX_PADRAO[k], ...(ap.textura_ajustes?.[k] || {}) }])),
    avatar: { ...p.avatar, ...(ap.avatar || {}) },
  };
}

// ─── cor: conversões, mistura e contraste (WCAG 2.1) ─────────────────────
export const HEX = /^#[0-9a-f]{6}$/i;
export const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
/** mistura `a` com `b` — t=0 é `a`, t=1 é `b` */
export const mix = (a, b, t) => {
  const x = rgb(a), y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * t));
};
export function luminancia(h) {
  const [r, g, b] = rgb(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
export function paraHsl(h) {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s * 100, l * 100];
}
export function deHsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
/** puxa `cor` na direção de `alvo` até ter `min`:1 contra `fundo` */
function garantir(cor, fundo, min, alvo) {
  let c = cor;
  for (let i = 0; i < 60 && contraste(c, fundo) < min; i++) c = mix(c, alvo, 0.06);
  return c;
}

// o que cada token é medido contra (e o mínimo), pra tela mostrar o contraste
export const MEDIDA = {
  "--text": ["--card", 4.5], "--text-bright": ["--card", 4.5], "--text-dim": ["--card", 4.5],
  "--text-faint": ["--card", 4.5], "--border-interactive": ["--bg", 3], "--accent": ["--bg", 3],
  "--red": ["--card", 4.5], "--green": ["--card", 4.5], "--amber": ["--card", 4.5], "--accent-dim": ["--card", 3],
};

/**
 * Todos os tokens de cor da aparência. Devolve { t, extremo, escuro, ajustados }:
 * `t` = token → hex; `ajustados` = os que o contraste automático mexeu.
 */
export function derivar(apIn, accent = ACCENT_PADRAO) {
  const ap = completar(apIn);
  const acc = HEX.test(accent || "") ? accent.toLowerCase() : ACCENT_PADRAO;
  let t;
  if (ap.paleta === "personalizada") {
    const c = ap.cores;
    const extremoBase = luminancia(c.bg) < 0.4 ? "#ffffff" : "#000000";
    t = {
      "--bg": c.bg, "--card": c.superficie,
      // mesmas relações do tema padrão: 38% e 77% do fundo à superfície,
      // borda suave a 60%, texto apagado a 68,7% / 61,7% (#8a8a8a / #7c7c7c)
      "--panel": mix(c.bg, c.superficie, 0.38), "--bg-alt": mix(c.bg, c.superficie, 0.77),
      "--border": c.borda, "--border-soft": mix(c.bg, c.borda, 0.6),
      "--border-interactive": mix(c.borda, c.texto, 0.23),
      "--text": c.texto, "--text-bright": mix(c.texto, extremoBase, 0.75),
      "--text-dim": mix(c.bg, c.texto, 0.687), "--text-faint": mix(c.bg, c.texto, 0.617),
    };
  } else {
    t = { ...PALETAS[ap.paleta] };
  }
  const escuro = luminancia(t["--bg"]) < 0.4;
  const extremo = escuro ? "#ffffff" : "#000000";

  // texto tingido (o antigo tema "fósforo"): no escuro, as mesmas contas
  // de antes (bases #e6e6e6 / #fff / #9a9a9a); no claro, a partir do texto
  if (ap.texto_tingido) {
    const [tx, br, dm] = escuro ? ["#e6e6e6", "#ffffff", "#9a9a9a"] : [t["--text"], t["--text-bright"], t["--text-dim"]];
    t["--text"] = mix(tx, acc, 0.55);
    t["--text-bright"] = mix(br, acc, 0.3);
    t["--text-dim"] = mix(dm, acc, 0.45);
  }

  t["--accent"] = acc;
  t["--accent-dim"] = mix(acc, t["--bg"], 0.42); // = color-mix(accent 58%, black) no tema padrão
  Object.assign(t, SEMANTICAS_PADRAO);

  const ajustados = {};
  if (ap.contraste_auto) {
    const regras = [
      ["--text", "--card", 4.5, extremo], ["--text-dim", "--card", 4.5, t["--text"]],
      ["--text-faint", "--card", 4.5, t["--text"]], ["--border-interactive", "--bg", 3, t["--text"]],
      ["--red", "--card", 4.5, t["--text"]], ["--green", "--card", 4.5, t["--text"]], ["--amber", "--card", 4.5, t["--text"]],
    ];
    // o destaque apagado (ícone da ação no calendário, ramo do menu): no
    // escuro ele é apagado de propósito (EST-03 — pra texto há o
    // --accent-texto); num fundo claro, misturado ao fundo, sumiria
    if (!escuro) regras.push(["--accent-dim", "--card", 3, t["--text"]]);
    for (const [k, fundo, min, alvo] of regras) {
      const novo = garantir(t[k], t[fundo], min, alvo);
      if (novo !== t[k]) {
        ajustados[k] = true;
        t[k] = novo;
      }
    }
  }
  for (const [k, v] of Object.entries(ap.fixos)) if (TOKENS_FIXAVEIS.includes(k)) t[k] = v.toLowerCase();
  t["--accent-texto"] = mix(acc, t["--text"], 0.2); // = color-mix(accent 80%, text)
  return { t, extremo, escuro, ajustados };
}

/** As cores do calendário: a fixada pela pessoa, ou a de sempre (resolvida). */
export function coresCalendario(apIn, t) {
  const ap = completar(apIn);
  return Object.fromEntries(TIPOS_CALENDARIO.map((k) => {
    const fixa = ap.calendario[k];
    if (fixa) return [k, fixa.toLowerCase()];
    const p = CAL_PADRAO[k];
    let cor = p.startsWith("--") ? t[p] : p;
    // as duas de hex fixo (evento, lembrete) acompanham o contraste num fundo claro
    if (!p.startsWith("--") && ap.contraste_auto) cor = garantir(cor, t["--card"], 3, t["--text"]);
    return [k, cor];
  }));
}

/** O tile SVG da textura (url(...)) e o tamanho dele — `escala`/`reforco` são da prévia. */
export function texturaImagem(apIn, extremo, { escala = 1, reforco = 1 } = {}) {
  const ap = completar(apIn);
  if (ap.textura === "nenhuma") return { img: "none", tam: "auto" };
  const a = ap.textura_ajustes[ap.textura];
  const esp = a.esp, g = Math.max(1, Math.min(a.gros, esp - 1));
  const op = Math.min(0.6, ((TX_OPAC[ap.textura] * a.int) / 3) * reforco).toFixed(3);
  // tile 1:1, crispEdges — gradiente com stop sub-pixel borra no WebKitGTK
  // (ver o comentário antigo da scanline em base.css)
  const svg = (w, h, corpo) =>
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' shape-rendering='crispEdges'>${corpo}</svg>`)}")`;
  const rect = (x, y, w, h, o = op, c = extremo) => `<rect x='${x}' y='${y}' width='${w}' height='${h}' fill='${c}' fill-opacity='${o}'/>`;
  const tam = (w, h) => `${w * escala}px ${h * escala}px`;
  switch (ap.textura) {
    case "crt": {
      const escura = esp - g > 1 ? rect(0, esp - 1, 1, 1, Math.min(0.6, (0.16 * a.int) / 3 * reforco).toFixed(3), "#000000") : "";
      return { img: svg(1, esp, rect(0, 0, 1, g) + escura), tam: tam(1, esp) };
    }
    case "grade":
      return { img: svg(esp, esp, rect(0, 0, esp, g) + rect(0, 0, g, esp)), tam: tam(esp, esp) };
    case "pontilhado":
      return { img: svg(esp, esp, rect(0, 0, g, g)), tam: tam(esp, esp) };
    default:
      return { img: svg(1, esp, rect(0, 0, 1, g)), tam: tam(1, esp) };
  }
}

/** As duas cores do avatar: o preenchimento segue o destaque quando não fixado. */
export function coresAvatar(apIn, accent = ACCENT_PADRAO) {
  const ap = completar(apIn);
  return { contorno: ap.avatar.contorno, preenchimento: ap.avatar.preenchimento || accent };
}

/**
 * feColorMatrix que recolore o logo-kami.gif: ele só tem preto (contorno) e
 * #8fbf8f (preenchimento), então o canal verde (0…191) é a "posição" entre
 * as duas — cada canal de saída = contorno + (preench − contorno) × G/0,749.
 */
export function matrizAvatar(contorno, preenchimento) {
  const A = rgb(contorno).map((v) => v / 255), B = rgb(preenchimento).map((v) => v / 255), G0 = 191 / 255;
  const linha = (i) => `0 ${((B[i] - A[i]) / G0).toFixed(4)} 0 0 ${A[i].toFixed(4)}`;
  return `${linha(0)}  ${linha(1)}  ${linha(2)}  0 0 0 1 0`;
}

/** Tudo o que vai no <html>: variáveis CSS e atributos data-*. */
export function calcularVisual(apIn, accent) {
  const ap = completar(apIn);
  const { t, extremo, escuro } = derivar(ap, accent);
  const vars = { ...t, "--extremo": extremo, "--sombra": escuro ? "#000000" : mix(t["--bg"], "#000000", 0.35) };
  for (const [k, v] of Object.entries(coresCalendario(ap, t))) vars[`--cal-${k}`] = v;
  const { img, tam } = texturaImagem(ap, extremo);
  vars["--kami-textura"] = img;
  vars["--kami-textura-tam"] = tam;
  const lugares = ap.textura === "nenhuma" ? {} : ap.textura_lugares;
  const dados = {
    textura: ap.textura,
    txTela: lugares.tela ? "" : null,
    txMenu: lugares.menu ? "" : null,
    txComp: lugares.componentes ? "" : null,
    tingido: ap.texto_tingido ? "" : null,
    claro: escuro ? null : "",
  };
  const av = coresAvatar(ap, vars["--accent"]);
  return { vars, dados, avatar: matrizAvatar(av.contorno, av.preenchimento) };
}
