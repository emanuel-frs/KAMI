/**
 * i18n.js — o Kami em 10 idiomas (I18N-01; decisões P-74, P-94..P-101).
 *
 * Sem biblioteca: `t("chave", {vars})` procura a chave no dicionário do
 * idioma (`frontend/i18n/<código>.json`) e, se faltar, no português — a
 * língua-fonte, que sempre está carregada e é a reserva. Chave faltando nos
 * dois devolve a própria chave (e avisa no console): o teste
 * tests/frontend/i18n-dicionarios.test.js garante que isso não acontece.
 *
 * Os dicionários são planos ("nav.perfil": "perfil"). Variáveis entre
 * chaves: "faltam {n} dias". Plural: a entrada vira um objeto com as formas
 * do Intl.PluralRules do idioma ({"one": "…", "other": "…"}; japonês,
 * chinês e coreano só têm "other"; a variável `n` escolhe a forma). A forma
 * opcional "zero" vale em qualquer idioma quando n = 0: pela regra do
 * Unicode (CLDR) o português do Brasil e o francês tratam 0 como singular
 * ("0 dia"), e aqui se diz "0 dias" / "nenhum dia".
 *
 * Textos fixos do index.html: `data-i18n="chave"` troca o texto do
 * elemento; `data-i18n-attr="title:chave;aria-label:chave"` troca
 * atributos. `aplicarNoDocumento()` roda a cada troca de idioma.
 *
 * Onde mora a escolha: no perfil (`idioma`, vai junto no backup) e numa
 * cópia no localStorage, pra abertura já sair no idioma certo antes do
 * perfil chegar — a tela de PIN vem antes dele (mesma ideia de
 * restaurarAparencia em components/tema.js). Banco novo começa sem idioma
 * e segue o do sistema (cai pro inglês se não for um dos 10); quem já usava
 * o Kami ficou com "pt" na migração (P-96).
 *
 * Trocar o idioma não recarrega o app: dispara `kami:idioma` e o app.js
 * redesenha a tela aberta e os textos fixos.
 */

export const IDIOMAS = [
  { codigo: "pt", nome: "português", intl: "pt-BR" },
  { codigo: "en", nome: "english", intl: "en-US" },
  { codigo: "es", nome: "español", intl: "es-419" },
  { codigo: "fr", nome: "français", intl: "fr-FR" },
  { codigo: "it", nome: "italiano", intl: "it-IT" },
  { codigo: "de", nome: "Deutsch", intl: "de-DE" },
  { codigo: "zh", nome: "中文（简体）", intl: "zh-CN" },
  { codigo: "ja", nome: "日本語", intl: "ja-JP" },
  { codigo: "ko", nome: "한국어", intl: "ko-KR" },
  { codigo: "hi", nome: "हिन्दी", intl: "hi-IN" },
];

const FONTE = "pt";
const RESERVA_DO_SISTEMA = "en"; // sistema num idioma fora dos 10 (P-74)
const CHAVE_LOCAL = "kami:idioma";

let atual = FONTE;
let dicionario = {};
let fonte = {};
const regrasDePlural = new Map();

const porCodigo = (codigo) => IDIOMAS.find((i) => i.codigo === codigo);

/** O idioma em uso ("pt", "en"…). */
export function idiomaAtual() {
  return atual;
}

/** O locale do Intl do idioma em uso ("pt-BR", "zh-CN"…) — datas e números. */
export function localeAtual() {
  return porCodigo(atual)?.intl || "pt-BR";
}

/** Função pura (testada): o primeiro dos idiomas do sistema que o Kami tem. */
export function idiomaDoSistema(preferidos = (typeof navigator !== "undefined" && navigator.languages) || []) {
  for (const p of preferidos) {
    const base = String(p).toLowerCase().split(/[-_]/)[0];
    if (porCodigo(base)) return base;
  }
  return RESERVA_DO_SISTEMA;
}

function regra(locale) {
  if (!regrasDePlural.has(locale)) regrasDePlural.set(locale, new Intl.PluralRules(locale));
  return regrasDePlural.get(locale);
}

function interpolar(texto, vars) {
  return texto.replace(/\{(\w+)\}/g, (inteiro, nome) => (nome in vars ? String(vars[nome]) : inteiro));
}

/**
 * O texto de `chave` no idioma em uso. `vars.n` escolhe o plural quando a
 * entrada tem formas ({one, other…}).
 */
export function t(chave, vars = {}) {
  let entrada = dicionario[chave] ?? fonte[chave];
  if (entrada === undefined) {
    console.warn(`i18n: chave sem texto: ${chave}`);
    return chave;
  }
  if (typeof entrada === "object") {
    const n = Number(vars.n ?? 0);
    const forma = n === 0 && entrada.zero ? "zero" : regra(localeAtual()).select(n);
    entrada = entrada[forma] ?? entrada.other ?? Object.values(entrada)[0];
  }
  return interpolar(entrada, vars);
}

/**
 * Pra texto que vem pronto do backend com uma chave (conquistas, missões,
 * registro de atividade): o texto de `chave` se ela existe no dicionário,
 * senão a `reserva` (o português que o backend mandou) — sem aviso, porque
 * chave nenhuma (conquista criada pela pessoa) ou desconhecida (banco mais
 * novo que o app) é o caso normal aqui.
 */
export function tOu(chave, reserva, vars = {}) {
  if (!chave || (dicionario[chave] ?? fonte[chave]) === undefined) return reserva;
  return t(chave, vars);
}

/** Troca os textos fixos marcados com data-i18n / data-i18n-attr. */
export function aplicarNoDocumento(raiz = document) {
  raiz.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  raiz.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const par of el.dataset.i18nAttr.split(";")) {
      const [attr, chave] = par.split(":").map((s) => s.trim());
      if (attr && chave) el.setAttribute(attr, t(chave));
    }
  });
}

async function baixar(codigo) {
  const resp = await fetch(new URL(`../i18n/${codigo}.json`, import.meta.url));
  if (!resp.ok) throw new Error(`dicionário ${codigo}: ${resp.status}`);
  return resp.json();
}

/** Testes: usa dicionários já em memória, sem fetch. */
export function usarDicionarios(codigo, dic, dicFonte = dic) {
  atual = porCodigo(codigo) ? codigo : FONTE;
  dicionario = dic;
  fonte = dicFonte;
}

/** O idioma guardado da última vez (abertura antes do perfil). */
export function idiomaGuardado() {
  try {
    const c = localStorage.getItem(CHAVE_LOCAL);
    return porCodigo(c) ? c : null;
  } catch {
    return null;
  }
}

/**
 * Carrega e aplica `codigo` (sem recarregar o app). Idioma desconhecido cai
 * no português. Dicionário que não carrega fica no português, sem quebrar
 * a abertura.
 */
export async function carregarIdioma(codigo) {
  const alvo = porCodigo(codigo) ? codigo : FONTE;
  if (!Object.keys(fonte).length) {
    try {
      fonte = await baixar(FONTE);
    } catch (err) {
      console.warn("i18n: sem o dicionário português", err);
    }
  }
  let novo = fonte;
  if (alvo !== FONTE) {
    try {
      novo = await baixar(alvo);
    } catch (err) {
      console.warn(`i18n: sem o dicionário ${alvo}, ficando em português`, err);
    }
  }
  const mudou = alvo !== atual || novo !== dicionario;
  atual = novo === fonte ? FONTE : alvo;
  dicionario = novo;
  try {
    localStorage.setItem(CHAVE_LOCAL, atual);
  } catch {
    /* sem localStorage: a próxima abertura usa o do perfil */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = localeAtual();
    aplicarNoDocumento();
    if (mudou) window.dispatchEvent(new CustomEvent("kami:idioma", { detail: { idioma: atual } }));
  }
  return atual;
}
