// 2.1.0 — aparência personalizável: a parte pura (components/aparencia.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CORES_PRONTAS, aparenciaPadrao, calcularVisual, completar, contraste, coresAvatar, coresCalendario, derivar,
  deHsl, matrizAvatar, mix, paraHsl, texturaImagem,
} from "../../frontend/js/components/aparencia.js";

const TOKENS_CSS = readFileSync(new URL("../../frontend/css/tokens.css", import.meta.url), "utf8");
const doCss = (nome) => TOKENS_CSS.match(new RegExp(`\\n\\s*${nome}:\\s*(#[0-9a-f]{6})`, "i"))[1].toLowerCase();

test("a paleta padrão calcula exatamente os tokens de sempre (tokens.css)", () => {
  const { t, ajustados } = derivar(aparenciaPadrao(), "#8fbf8f");
  for (const k of ["--bg", "--bg-alt", "--panel", "--card", "--border", "--border-soft", "--border-interactive",
    "--text", "--text-bright", "--text-dim", "--text-faint", "--red", "--green", "--amber"]) {
    assert.equal(t[k], doCss(k), k);
  }
  assert.deepEqual(ajustados, {}, "o tema padrão já passa no contraste — nada a ajustar");
  // --accent-dim = color-mix(accent 58%, black); --accent-texto = color-mix(accent 80%, text)
  assert.equal(t["--accent-dim"], mix("#8fbf8f", "#000000", 0.42));
  assert.equal(t["--accent-texto"], mix("#8fbf8f", "#c9c9c9", 0.2));
});

test("a personalizada com as cores do padrão dá o mesmo que o padrão", () => {
  const pad = derivar(aparenciaPadrao()).t;
  const pers = derivar({ ...aparenciaPadrao(), paleta: "personalizada" }).t;
  for (const k of Object.keys(pad)) assert.equal(pers[k], pad[k], k);
});

test("fundo claro: os tons apagados e as semânticas ficam legíveis (contraste automático)", () => {
  const ap = { paleta: "personalizada", cores: { bg: "#f2efe6", superficie: "#e6e1d4", borda: "#b5ab96", texto: "#383228" } };
  const { t, extremo, escuro, ajustados } = derivar(ap, "#2e7d6b");
  assert.equal(escuro, false);
  assert.equal(extremo, "#000000");
  for (const k of ["--text", "--text-dim", "--text-faint", "--red", "--green", "--amber"]) {
    assert.ok(contraste(t[k], t["--card"]) >= 4.5, `${k} ${t[k]} contra ${t["--card"]}`);
  }
  assert.ok(contraste(t["--border-interactive"], t["--bg"]) >= 3);
  assert.ok(ajustados["--green"], "o verde de sempre (#7fd97f) não se lê no claro");
  // sem o ajuste, fica como está (e a tela avisa)
  const cru = derivar({ ...ap, contraste_auto: false }, "#2e7d6b").t;
  assert.equal(cru["--green"], "#7fd97f");
  // num fundo claro as cores fixas do calendário também escurecem
  assert.ok(contraste(coresCalendario(ap, t).lembrete, t["--card"]) >= 3);
});

test("texto tingido = o antigo tema fósforo; modo avançado fixa à mão", () => {
  const { t } = derivar({ texto_tingido: true }, "#8fbf8f");
  assert.equal(t["--text"], mix("#e6e6e6", "#8fbf8f", 0.55));
  const f = derivar({ fixos: { "--red": "#FF0000", "--bg": "#ffffff" } }).t;
  assert.equal(f["--red"], "#ff0000");
  assert.equal(f["--bg"], "#000000", "--bg não é fixável no modo avançado");
});

test("calendário: a cor fixada ou a de sempre", () => {
  const { t } = derivar(aparenciaPadrao());
  const c = coresCalendario({ calendario: { evento: "#FF8A3D" } }, t);
  assert.equal(c.evento, "#ff8a3d");
  assert.equal(c.divida, t["--red"]);
  assert.equal(c.lembrete, "#c9a0dc");
});

test("textura: tile e tamanho de cada uma; espessura nunca passa do espaçamento", () => {
  assert.deepEqual(texturaImagem({ textura: "nenhuma" }, "#ffffff"), { img: "none", tam: "auto" });
  const scan = texturaImagem({}, "#ffffff");
  assert.equal(scan.tam, "1px 3px");
  assert.match(decodeURIComponent(scan.img), /fill-opacity='0\.018'/);
  const grade = texturaImagem({ textura: "grade", textura_ajustes: { grade: { esp: 24, gros: 30, int: 6 } } }, "#000000");
  assert.equal(grade.tam, "24px 24px");
  assert.match(decodeURIComponent(grade.img), /width='23'/);
  assert.equal(texturaImagem({ textura: "pontilhado" }, "#fff", { escala: 4 }).tam, "12px 12px");
});

test("avatar: preenchimento segue o destaque; a matriz leva o verde do gif às duas cores", () => {
  assert.deepEqual(coresAvatar({}, "#e08fa0"), { contorno: "#000000", preenchimento: "#e08fa0" });
  assert.deepEqual(coresAvatar({ avatar: { contorno: "#2a1640", preenchimento: "#f2d16b" } }, "#e08fa0"), { contorno: "#2a1640", preenchimento: "#f2d16b" });
  // preto/verde de sempre → só o canal verde escala (o gif fica igual)
  const linhas = matrizAvatar("#000000", "#8fbf8f").split(/\s{2}/);
  assert.equal(linhas.length, 4);
  assert.equal(linhas[1], "0 1.0000 0 0 0.0000");
});

test("completar: lixo vira o padrão; o que é conhecido fica", () => {
  assert.deepEqual(completar(null), aparenciaPadrao());
  const c = completar({ paleta: "neon", textura: "xadrez", cores: { bg: "azul", texto: "#ABCDEF" }, calendario: { evento: "x" } });
  assert.equal(c.paleta, "padrao");
  assert.equal(c.textura, "scanline");
  assert.equal(c.cores.bg, "#000000");
  assert.equal(c.cores.texto, "#ABCDEF");
  assert.deepEqual(c.calendario, {});
});

test("calcularVisual: data-* só dos lugares ligados; nada com textura 'nenhuma'", () => {
  const v = calcularVisual({ textura_lugares: { tela: true, menu: false, componentes: false } }, "#8fbf8f");
  assert.deepEqual(v.dados, { textura: "scanline", txTela: "", txMenu: null, txComp: null, tingido: null, claro: null });
  assert.equal(calcularVisual({ textura: "nenhuma" }).dados.txTela, null);
  assert.equal(v.vars["--cal-meta"], "#8fbf8f");
});

test("hsl ida e volta; as 9 cores prontas", () => {
  for (const c of CORES_PRONTAS) assert.equal(deHsl(...paraHsl(c)), c);
  assert.equal(CORES_PRONTAS.length, 9);
});

test("destaque apagado: igual ao de sempre no escuro (mesmo abaixo de 3:1); legível no claro", () => {
  const escuro = derivar({}, "#b06060").t;
  assert.equal(escuro["--accent-dim"], mix("#b06060", "#000000", 0.42));
  const claro = derivar({ paleta: "personalizada", cores: { bg: "#f2efe6", superficie: "#e6e1d4", borda: "#b5ab96", texto: "#383228" } }, "#2e7d6b").t;
  assert.ok(contraste(claro["--accent-dim"], claro["--card"]) >= 3);
});
