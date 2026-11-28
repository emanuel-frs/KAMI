/**
 * Configurações › aparência › "cores" e "textura" (2.1.0).
 *
 * Estado local = a aparência do perfil (components/aparencia.js::completar)
 * + a cor de destaque. Cada mudança é aplicada na hora (prévia, sem passar
 * pelo store — senão cada passo de uma régua chamaria o Rust do ícone) e
 * salva com um pequeno atraso; o store só recebe o perfil que o backend
 * devolveu. Se o backend recusar (nível, formato), volta ao último salvo.
 *
 * O que o nível libera vem de GET /api/nucleo/recompensas (capacidades,
 * backend/app/aparencia.py::CAPACIDADES): o que ainda não foi liberado
 * aparece travado com "nível N" — dá pra ver o que vem pela frente.
 */
import { getRecompensas } from "../../api/nucleo.js";
import { updateProfile } from "../../api/perfil.js";
import { ACCENT_OPTIONS } from "../../components/accent-colors.js";
import {
  ACCENT_PADRAO, CAL_PADRAO, CORES_BASE_PADRAO, HEX, MEDIDA, PALETAS, TIPOS_CALENDARIO, TOKENS_FIXAVEIS,
  TX_LIMITES, TX_PADRAO, aparenciaPadrao, calcularVisual, completar, contraste, coresCalendario, derivar,
  texturaImagem,
} from "../../components/aparencia.js";
import { typeMeta } from "../../components/event-types.js";
import { icon } from "../../components/icons.js";
import { abrirSeletorCor } from "../../components/seletor-cor.js";
import { aplicar as aplicarVisual } from "../../components/tema.js";
import { showErrorModal } from "../err-modal.js";
import { store } from "../../state/store.js";
import { t } from "../../i18n.js";

// o mesmo de backend/app/aparencia.py::CAPACIDADES — só pra mostrar "nível N"
// se o catálogo não carregar
const NIVEL_PADRAO = {
  texto_tingido: 3, cor_livre: 4, textura_crt: 5, calendario: 6, paleta_ambar: 8,
  paleta_personalizada: 8, texto: 10, avancado: 10, texturas_novas: 12,
};

let st = null; // { ap, accent, salvo: {ap, accent}, caps: Map(chave → {level, unlocked}), avancado }
let wrapEl = null;
let timerSalvar = null;

const nivelDe = (cap) => st.caps.get(cap)?.level ?? NIVEL_PADRAO[cap];
const livre = (cap) => !cap || Boolean(st.caps.get(cap)?.unlocked);
const trava = (cap) => (livre(cap) ? "" : ` · ${icon("lock", { size: 9 })} ${t("aparencia.cap.nivel", { nivel: nivelDe(cap) })}`);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ─── marcação fixa das duas abas ─────────────────────────────────────────
const titulo = (texto, secao) =>
  `<h4 class="cfg-ap-h4">${texto}<button type="button" class="cfg-ap-padrao" data-padrao="${secao}" hidden>${icon("rotate-ccw", { size: 10 })} ${t("aparencia.voltar_ao_padrao")}</button></h4>`;

export function buildCoresPanel() {
  return `
      <div class="settings-section">
        ${titulo(t("aparencia.cor_de_destaque"), "destaque")}
        <p class="settings-desc">${t("aparencia.destaque_desc")}</p>
        <div class="ki-swatches" id="cfg-accent-swatches"></div>
        <p class="settings-note cfg-ap-nota" id="cfg-ap-livre-nota"></p>
        <p class="settings-status" id="cfg-accent-status"></p>
      </div>
      <div class="settings-section">
        ${titulo(t("aparencia.avatar_titulo"), "avatar")}
        <p class="settings-desc">${t("aparencia.avatar_desc")}</p>
        <div class="cfg-ap-avatar">
          <figure><span style="background:var(--bg)"><img class="kami-avatar-gif" src="assets/logos/logo-kami.gif" alt="" draggable="false"></span>${t("aparencia.sobre_o_fundo")}</figure>
          <figure><span style="background:var(--card)"><img class="kami-avatar-gif" src="assets/logos/logo-kami.gif" alt="" draggable="false"></span>${t("aparencia.sobre_um_card")}</figure>
        </div>
        <div class="cfg-ap-cores" id="cfg-ap-avatar-cores"></div>
        <label class="cfg-toggle" id="cfg-ap-segue-wrap">
          <input type="checkbox" id="cfg-ap-segue">
          <span>${t("aparencia.preenchimento_segue")}<small id="cfg-ap-segue-small">${t("aparencia.preenchimento_segue_desc")}</small></span>
        </label>
        <label class="cfg-toggle" id="cfg-icone-tema-wrap" hidden>
          <input type="checkbox" id="cfg-icone-tema">
          <span>${t("aparencia.icone_do_app_nas_cores")}<small>${t("aparencia.a_janela_e_a_barra")}</small></span>
        </label>
        <p class="settings-note cfg-ap-nota" id="cfg-ap-avatar-nota"></p>
      </div>
      <div class="settings-section">
        ${titulo(t("aparencia.paleta"), "paleta")}
        <p class="settings-desc">${t("aparencia.paleta_desc")}</p>
        <div role="radiogroup" aria-label="${t("aparencia.paleta")}" id="cfg-ap-paletas"></div>
        <div id="cfg-ap-personalizada" hidden>
          <p class="cfg-subhead">${t("aparencia.cores_da_paleta")} <small>${t("aparencia.cores_da_paleta_dica")}</small></p>
          <div class="cfg-ap-cores" id="cfg-ap-paleta-cores"></div>
        </div>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-ap-contraste">
          <span>${t("aparencia.contraste_auto")}<small>${t("aparencia.contraste_auto_desc")}</small></span>
        </label>
        <label class="cfg-toggle" id="cfg-ap-avancado-wrap">
          <input type="checkbox" id="cfg-ap-avancado">
          <span>${t("aparencia.modo_avancado")}<small id="cfg-ap-avancado-small"></small></span>
        </label>
        <div class="cfg-ap-cores" id="cfg-ap-avancado-cores" hidden></div>
      </div>
      <div class="settings-section">
        ${titulo(t("aparencia.cores_do_calendario"), "calendario")}
        <p class="settings-desc">${t("aparencia.cores_do_calendario_desc")}</p>
        <p class="settings-note cfg-ap-nota" id="cfg-ap-cal-nota"></p>
        <div id="cfg-ap-cal"></div>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.restaurar_cores")}</h4>
        <p class="settings-desc">${t("aparencia.restaurar_cores_desc")}</p>
        <button type="button" class="btn sm" id="cfg-ap-restaurar">${t("aparencia.restaurar_todas_as_cores")}</button>
      </div>`;
}

export function buildTexturaPanel() {
  return `
      <div class="settings-section">
        ${titulo(t("aparencia.textura"), "textura")}
        <p class="settings-desc">${t("aparencia.textura_desc")}</p>
        <div role="radiogroup" aria-label="${t("aparencia.textura")}" id="cfg-ap-texturas"></div>
        <div id="cfg-ap-textura-ajustes"></div>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.texto")}</h4>
        <div id="cfg-ap-tingido"></div>
      </div>`;
}

// ─── estado, prévia e gravação ───────────────────────────────────────────
function aplicarPrevia() {
  aplicarVisual(calcularVisual(st.ap, st.accent));
}

/** Muda algo: prévia na hora, redesenha (se pedido) e salva daqui a pouco. */
function mudar({ redesenhar = true, imediato = false } = {}) {
  aplicarPrevia();
  if (redesenhar) desenhar();
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(salvar, imediato ? 0 : 450);
}

async function salvar() {
  timerSalvar = null;
  const enviar = { aparencia: st.ap };
  if (st.accent !== st.salvo.accent) enviar.accent_color = st.accent;
  let perfil;
  try {
    perfil = await updateProfile(enviar);
  } catch (err) {
    showErrorModal(err.message, t("aparencia.erro_ao_salvar_aparencia"));
    st.ap = completar(st.salvo.ap);
    st.accent = st.salvo.accent;
    aplicarPrevia();
    desenhar();
    return;
  }
  st.salvo = { ap: completar(perfil.aparencia), accent: perfil.accent_color };
  // o store espalha pro resto (tema.js, ícone do app, widget de perfil…)
  store.set("profile", { ...store.get("profile"), ...perfil });
  const status = wrapEl?.querySelector("#cfg-accent-status");
  if (status) {
    status.innerHTML = `${icon("check", { size: 12 })} ${t("aparencia.salvo")}`;
    status.classList.add("settings-status--visible");
  }
}

/** Chamada a cada abertura do modal (o perfil pode ter mudado por outro caminho). */
export async function renderVisual(wrap, profile) {
  wrapEl = wrap;
  st = {
    ap: completar(profile.aparencia),
    accent: (profile.accent_color || ACCENT_PADRAO).toLowerCase(),
    caps: new Map(),
    avancado: false,
  };
  st.salvo = { ap: completar(profile.aparencia), accent: st.accent };
  st.avancado = Object.keys(st.ap.fixos).length > 0;
  renderIconeTema(wrap, profile);
  desenhar();
  try {
    const dados = await getRecompensas();
    st.caps = new Map((dados.capacidades || []).map((c) => [c.key, c]));
  } catch {
    // sem o catálogo: tudo o que depende de nível fica travado (o backend
    // confere de novo de qualquer jeito)
  }
  desenhar();
}

function desenhar() {
  if (!wrapEl || !st) return;
  const v = derivar(st.ap, st.accent);
  desenharDestaque();
  desenharAvatar(v);
  desenharPaleta(v);
  desenharCalendario(v);
  desenharTexturas(v);
  desenharPadroes();
}

// ─── linhas de cor (nome · amostra · hex · contraste · ↺) ────────────────
function linhaCor({ id, rotulo, sub = "", valor, medida = null, v = null, reset = "", extra = "", travado = false }) {
  let tag = "";
  if (medida && v) {
    const [fundo, min] = MEDIDA[medida];
    const r = contraste(v.t[medida], v.t[fundo]);
    const cls = r < min ? "ruim" : v.ajustados[medida] ? "ajustado" : "ok";
    tag = `<span class="cfg-ap-contraste ${cls}" title="${esc(t("aparencia.contraste_contra", { fundo }))}">${r.toFixed(1).replace(".", ",")}:1 ${t(`aparencia.contraste_${cls}`)}</span>`;
  }
  return `<div class="cfg-ap-cor${travado ? " cfg-ap-travado" : ""}" data-linha="${id}">
      <span class="cfg-ap-cor-nome">${rotulo}${extra}<small>${sub}</small>${reset ? `<button type="button" class="cfg-ap-reset" data-reset="${id}">${icon("rotate-ccw", { size: 9 })} ${reset}</button>` : ""}</span>
      <button type="button" class="cfg-ap-amostra" style="background:${valor}" aria-label="${esc(t("aparencia.escolher_cor_de", { nome: rotulo }))}"${travado ? " disabled" : ""}></button>
      <input class="cfg-ap-hex" value="${valor}" maxlength="7" spellcheck="false" aria-label="${esc(t("aparencia.hex_de", { nome: rotulo }))}"${travado ? " disabled" : ""}>
      ${tag || "<span></span>"}
    </div>`;
}

/** Liga amostra (seletor), hex e ↺ de cada linha de um container. */
function ligarLinhas(container, { definir, resetar, rotuloDe }) {
  container.querySelectorAll(".cfg-ap-cor").forEach((row) => {
    const id = row.dataset.linha;
    const amostra = row.querySelector(".cfg-ap-amostra");
    amostra.addEventListener("click", () =>
      abrirSeletorCor(amostra, row.querySelector(".cfg-ap-hex").value, {
        rotulo: rotuloDe?.(id),
        aoMudar: (cor) => {
          definir(id, cor);
          amostra.style.background = cor;
          row.querySelector(".cfg-ap-hex").value = cor;
          aplicarPrevia();
        },
        aoFechar: () => mudar(),
      })
    );
    row.querySelector(".cfg-ap-hex").addEventListener("change", (e) => {
      const cor = e.target.value.trim().toLowerCase();
      if (!HEX.test(cor)) {
        e.target.value = e.target.defaultValue;
        return;
      }
      definir(id, cor);
      mudar();
    });
    row.querySelector(".cfg-ap-reset")?.addEventListener("click", () => {
      resetar(id);
      mudar();
    });
  });
}

// ─── cor de destaque ─────────────────────────────────────────────────────
function desenharDestaque() {
  const box = wrapEl.querySelector("#cfg-accent-swatches");
  const pronta = ACCENT_OPTIONS.find((c) => c.value === st.accent);
  const ok = livre("cor_livre");
  const check = icon("check", { size: 12, className: "swatch-check" });
  box.innerHTML =
    ACCENT_OPTIONS.map((c) => {
      const sel = c.value === st.accent;
      return `<button type="button" class="ki-swatch${sel ? " ki-swatch--sel" : ""}" data-color="${c.value}" data-tooltip="${esc(c.label)}" style="--swatch-color:${c.value};" aria-label="${esc(c.label)}" aria-pressed="${sel}">${check}</button>`;
    }).join("") +
    `<button type="button" class="ki-swatch cfg-ap-livre${pronta ? "" : " ki-swatch--sel"}" id="cfg-ap-livre" style="--swatch-color:${st.accent};" aria-label="${esc(t("aparencia.cor_livre"))}" data-tooltip="${esc(t("aparencia.cor_livre"))}" aria-pressed="${!pronta}"${ok ? "" : " disabled"}>${icon(ok ? "plus" : "lock", { size: 12 })}</button>`;
  box.querySelectorAll("[data-color]").forEach((b) =>
    b.addEventListener("click", () => {
      st.accent = b.dataset.color;
      mudar({ imediato: true });
    })
  );
  const livreBtn = box.querySelector("#cfg-ap-livre");
  if (ok) {
    livreBtn.addEventListener("click", () =>
      abrirSeletorCor(livreBtn, st.accent, {
        rotulo: t("aparencia.cor_livre"),
        aoMudar: (cor) => {
          st.accent = cor;
          aplicarPrevia();
        },
        aoFechar: () => mudar(),
      })
    );
  }
  const nota = wrapEl.querySelector("#cfg-ap-livre-nota");
  if (!ok) {
    nota.innerHTML = `${icon("lock", { size: 10 })} ${t("aparencia.cor_livre_trava", { nivel: nivelDe("cor_livre") })}`;
  } else if (!pronta) {
    const r = contraste(st.accent, derivar(st.ap, st.accent).t["--bg"]);
    nota.innerHTML = `${t("aparencia.cor_livre_atual", { cor: st.accent, contraste: r.toFixed(1).replace(".", ",") })}${r < 3 ? ` — <span class="cfg-ap-ruim">${t("aparencia.dificil_de_ler")}</span>` : ""}`;
  } else {
    nota.textContent = "";
  }
}

// ─── avatar ──────────────────────────────────────────────────────────────
function desenharAvatar() {
  const ok = livre("cor_livre");
  const segue = !st.ap.avatar.preenchimento;
  const preench = st.ap.avatar.preenchimento || st.accent;
  const contorno = st.ap.avatar.contorno;
  const box = wrapEl.querySelector("#cfg-ap-avatar-cores");
  box.innerHTML =
    linhaCor({
      id: "preenchimento", rotulo: t("aparencia.preenchimento"), sub: segue ? t("aparencia.a_cor_de_destaque") : t("aparencia.cor_propria"),
      valor: preench, travado: !ok, reset: segue ? "" : t("aparencia.padrao_destaque"),
    }) +
    linhaCor({
      id: "contorno", rotulo: t("aparencia.contorno"), sub: t("aparencia.contorno_desc"), valor: contorno, travado: !ok,
      reset: contorno === "#000000" ? "" : t("aparencia.padrao_preto"),
    });
  ligarLinhas(box, {
    definir: (id, cor) => {
      if (id === "preenchimento") st.ap.avatar.preenchimento = cor;
      else st.ap.avatar.contorno = cor;
    },
    resetar: (id) => {
      if (id === "preenchimento") st.ap.avatar.preenchimento = null;
      else st.ap.avatar.contorno = "#000000";
    },
    rotuloDe: (id) => t(id === "preenchimento" ? "aparencia.preenchimento" : "aparencia.contorno"),
  });
  const segueInput = wrapEl.querySelector("#cfg-ap-segue");
  segueInput.checked = segue;
  segueInput.disabled = !ok;
  wrapEl.querySelector("#cfg-ap-segue-wrap").classList.toggle("cfg-toggle--locked", !ok);
  const r = contraste(contorno, preench);
  const nota = wrapEl.querySelector("#cfg-ap-avatar-nota");
  if (!ok) nota.innerHTML = `${icon("lock", { size: 10 })} ${t("aparencia.avatar_trava", { nivel: nivelDe("cor_livre") })}`;
  else if (r < 1.6) nota.innerHTML = `<span class="cfg-ap-ruim">${t("aparencia.avatar_mancha", { contraste: r.toFixed(1).replace(".", ",") })}</span>`;
  else nota.textContent = t("aparencia.avatar_nota");
}

// ─── paleta ──────────────────────────────────────────────────────────────
function opcaoRadio(name, valor, rotulo, desc, cap, marcado) {
  const ok = livre(cap);
  return `<label class="cfg-toggle${ok ? "" : " cfg-toggle--locked"}">
      <input type="radio" name="${name}" value="${valor}"${marcado ? " checked" : ""}${ok ? "" : " disabled"}>
      <span>${rotulo}<small>${desc}${trava(cap)}</small></span>
    </label>`;
}

function desenharPaleta(v) {
  const paletas = [
    ["padrao", "aparencia.paleta_padrao", null],
    ["ambar", "aparencia.paleta_ambar", "paleta_ambar"],
    ["personalizada", "aparencia.paleta_personalizada", "paleta_personalizada"],
  ];
  const box = wrapEl.querySelector("#cfg-ap-paletas");
  box.innerHTML = paletas.map(([k, rot, cap]) => opcaoRadio("cfg-ap-paleta", k, t(rot), t(`${rot}_desc`), cap, st.ap.paleta === k)).join("");
  box.querySelectorAll("input").forEach((i) =>
    i.addEventListener("change", () => {
      // a personalizada começa das cores da paleta que estava em uso
      if (i.value === "personalizada" && st.ap.paleta !== "personalizada") {
        const p = PALETAS[st.ap.paleta];
        st.ap.cores = { bg: p["--bg"], superficie: p["--card"], borda: p["--border"], texto: p["--text"] };
      }
      st.ap.paleta = i.value;
      mudar({ imediato: true });
    })
  );

  const pers = wrapEl.querySelector("#cfg-ap-personalizada");
  pers.hidden = st.ap.paleta !== "personalizada";
  if (!pers.hidden) {
    const linhas = [
      ["bg", "aparencia.cor_fundo", "aparencia.cor_fundo_desc", null, "paleta_personalizada"],
      ["superficie", "aparencia.cor_superficie", "aparencia.cor_superficie_desc", null, "paleta_personalizada"],
      ["borda", "aparencia.cor_borda", "aparencia.cor_borda_desc", "--border-interactive", "paleta_personalizada"],
      ["texto", "aparencia.cor_texto", "aparencia.cor_texto_desc", "--text", "texto"],
    ];
    const box2 = wrapEl.querySelector("#cfg-ap-paleta-cores");
    box2.innerHTML = linhas.map(([k, rot, sub, medida, cap]) => {
      const valor = st.ap.cores[k];
      const pad = CORES_BASE_PADRAO[k];
      return linhaCor({
        id: k, rotulo: t(rot), sub: t(sub), valor, medida, v, travado: !livre(cap),
        extra: livre(cap) ? "" : `<span class="cfg-ap-trava">${icon("lock", { size: 9 })} ${t("aparencia.cap.nivel", { nivel: nivelDe(cap) })}</span>`,
        reset: valor === pad ? "" : t("aparencia.padrao_hex", { hex: pad }),
      });
    }).join("");
    ligarLinhas(box2, {
      definir: (id, cor) => (st.ap.cores[id] = cor),
      resetar: (id) => (st.ap.cores[id] = CORES_BASE_PADRAO[id]),
      rotuloDe: (id) => t(linhas.find((l) => l[0] === id)[1]),
    });
  }

  wrapEl.querySelector("#cfg-ap-contraste").checked = st.ap.contraste_auto;
  const avOk = livre("avancado");
  const avInput = wrapEl.querySelector("#cfg-ap-avancado");
  avInput.disabled = !avOk;
  avInput.checked = st.avancado && avOk;
  wrapEl.querySelector("#cfg-ap-avancado-wrap").classList.toggle("cfg-toggle--locked", !avOk);
  wrapEl.querySelector("#cfg-ap-avancado-small").innerHTML = `${t("aparencia.modo_avancado_desc")}${trava("avancado")}`;

  const av = wrapEl.querySelector("#cfg-ap-avancado-cores");
  av.hidden = !(st.avancado && avOk);
  if (av.hidden) return;
  const rotulos = {
    "--bg-alt": "menu_lateral", "--panel": "paineis", "--border-soft": "divisores", "--border-interactive": "contorno_botao",
    "--text-bright": "titulos", "--text-dim": "texto_secundario", "--text-faint": "rotulos_pequenos", "--accent-dim": "destaque_apagado",
    "--red": "saida_erro", "--green": "entrada_concluido", "--amber": "aviso",
  };
  av.innerHTML = TOKENS_FIXAVEIS.map((k) => {
    const fixo = k in st.ap.fixos;
    return linhaCor({
      id: k, rotulo: k.slice(2), sub: t(`aparencia.token.${rotulos[k]}`) + (fixo ? "" : ` · ${t("aparencia.calculado")}`),
      valor: v.t[k], medida: MEDIDA[k] ? k : null, v, reset: fixo ? t("aparencia.padrao_calculado") : "",
    });
  }).join("");
  ligarLinhas(av, {
    definir: (id, cor) => (st.ap.fixos[id] = cor),
    resetar: (id) => delete st.ap.fixos[id],
    rotuloDe: (id) => id.slice(2),
  });
}

// ─── calendário ──────────────────────────────────────────────────────────
function desenharCalendario(v) {
  const ok = livre("calendario");
  const meta = typeMeta();
  const cores = coresCalendario(st.ap, v.t);
  wrapEl.querySelector("#cfg-ap-cal-nota").innerHTML = ok ? "" : `${icon("lock", { size: 10 })} ${t("aparencia.calendario_trava", { nivel: nivelDe("calendario") })}`;
  const box = wrapEl.querySelector("#cfg-ap-cal");
  box.innerHTML = TIPOS_CALENDARIO.map((k) => {
    const fixa = st.ap.calendario[k];
    return `<div class="cfg-ap-cal-tipo${ok ? "" : " cfg-ap-travado"}" data-tipo="${k}">
        <span class="cal-chip" style="--type-color:${cores[k]}">${icon(meta[k].icon, { size: 12 })}</span>
        <span>${esc(meta[k].label)}</span>
        <button type="button" class="cfg-ap-amostra" style="background:${cores[k]}" aria-label="${esc(t("aparencia.escolher_cor_de", { nome: meta[k].label }))}"${ok ? "" : " disabled"}></button>
        <input class="cfg-ap-hex" value="${cores[k]}" maxlength="7" spellcheck="false" aria-label="${esc(t("aparencia.hex_de", { nome: meta[k].label }))}"${ok ? "" : " disabled"}>
        ${fixa ? `<button type="button" class="cfg-ap-reset" data-reset="${k}">${icon("rotate-ccw", { size: 9 })} ${t("aparencia.padrao")}</button>` : `<span class="cfg-ap-contraste">${t("aparencia.padrao")}</span>`}
      </div>`;
  }).join("");
  box.querySelectorAll(".cfg-ap-cal-tipo").forEach((row) => {
    const k = row.dataset.tipo;
    const amostra = row.querySelector(".cfg-ap-amostra");
    amostra.addEventListener("click", () =>
      abrirSeletorCor(amostra, row.querySelector(".cfg-ap-hex").value, {
        rotulo: meta[k].label,
        aoMudar: (cor) => {
          st.ap.calendario[k] = cor;
          amostra.style.background = cor;
          row.querySelector(".cal-chip").style.setProperty("--type-color", cor);
          aplicarPrevia();
        },
        aoFechar: () => mudar(),
      })
    );
    row.querySelector(".cfg-ap-hex").addEventListener("change", (e) => {
      const cor = e.target.value.trim().toLowerCase();
      if (HEX.test(cor)) {
        st.ap.calendario[k] = cor;
        mudar();
      } else e.target.value = cores[k];
    });
    row.querySelector(".cfg-ap-reset")?.addEventListener("click", () => {
      delete st.ap.calendario[k];
      mudar();
    });
  });
}

// ─── texturas ────────────────────────────────────────────────────────────
const CAP_TEXTURA = { nenhuma: null, scanline: null, crt: "textura_crt", grade: "texturas_novas", pontilhado: "texturas_novas" };

function desenharTexturas(v) {
  const box = wrapEl.querySelector("#cfg-ap-texturas");
  box.innerHTML = Object.keys(CAP_TEXTURA)
    .map((k) => opcaoRadio("cfg-ap-textura", k, t(`aparencia.textura_${k}`), t(`aparencia.textura_${k}_desc`), CAP_TEXTURA[k], st.ap.textura === k))
    .join("");
  box.querySelectorAll("input").forEach((i) =>
    i.addEventListener("change", () => {
      st.ap.textura = i.value;
      mudar({ imediato: true });
    })
  );
  desenharAjustes(v);

  const ok = livre("texto_tingido");
  const tg = wrapEl.querySelector("#cfg-ap-tingido");
  tg.innerHTML = `<label class="cfg-toggle${ok ? "" : " cfg-toggle--locked"}">
      <input type="checkbox" id="cfg-ap-tingido-input"${st.ap.texto_tingido ? " checked" : ""}${ok ? "" : " disabled"}>
      <span>${t("aparencia.texto_tingido")}<small>${t("aparencia.texto_tingido_desc")}${trava("texto_tingido")}</small></span>
    </label>`;
  tg.querySelector("input").addEventListener("change", (e) => {
    st.ap.texto_tingido = e.target.checked;
    mudar({ imediato: true });
  });
}

function desenharAjustes(v) {
  const box = wrapEl.querySelector("#cfg-ap-textura-ajustes");
  const tx = st.ap.textura;
  if (tx === "nenhuma") {
    box.innerHTML = "";
    return;
  }
  const a = st.ap.textura_ajustes[tx];
  const lim = TX_LIMITES[tx];
  const pad = TX_PADRAO[tx];
  const mudou = a.esp !== pad.esp || a.gros !== pad.gros || a.int !== pad.int;
  // tela · menu · componentes (as chaves de textura_lugares)
  const lugares = Object.keys(st.ap.textura_lugares).map((k) => [k, `aparencia.lugar_${k}`]);
  const semLugar = !Object.values(st.ap.textura_lugares).some(Boolean);
  const regua = (campo, rot, [min, max], un) => `
      <label class="cfg-ap-regua">${rot}
        <input type="range" data-tx="${campo}" min="${min}" max="${max}" value="${a[campo]}">
        <output>${a[campo]}${un}</output>
      </label>`;
  box.innerHTML = `
      <p class="cfg-subhead">${t("aparencia.onde_aparece")} <small>${t("aparencia.onde_aparece_dica")}</small></p>
      <div class="cfg-ap-seg" role="group" aria-label="${t("aparencia.onde_aparece")}">
        ${lugares.map(([k, rot]) => `<button type="button" data-lugar="${k}" aria-pressed="${st.ap.textura_lugares[k]}">${t(rot)}</button>`).join("")}
      </div>
      ${semLugar ? `<p class="settings-note">${t("aparencia.nenhum_lugar")}</p>` : ""}
      <p class="cfg-subhead cfg-ap-ajustes-titulo">${t("aparencia.ajustes", { textura: t(`aparencia.textura_${tx}`) })}
        ${mudou ? `<button type="button" class="cfg-ap-reset" id="cfg-ap-tx-reset">${icon("rotate-ccw", { size: 9 })} ${t("aparencia.padrao_desta_textura")}</button>` : ""}</p>
      <div class="cfg-ap-ajustes">
        <div>
          ${regua("esp", t("aparencia.espacamento"), lim.esp, "px")}
          ${regua("gros", t(tx === "pontilhado" ? "aparencia.tamanho_do_ponto" : "aparencia.espessura"), [lim.gros[0], Math.min(lim.gros[1], a.esp - 1)], "px")}
          ${regua("int", t("aparencia.intensidade"), [1, 10], "")}
        </div>
        <div><div class="cfg-ap-zoom"></div><div class="cfg-ap-zoom-rot">${t("aparencia.previa_ampliada")}</div></div>
      </div>`;
  const zoom = box.querySelector(".cfg-ap-zoom");
  const pintarZoom = () => {
    // via style (não no atributo): a url tem aspas duplas
    const { img, tam } = texturaImagem(st.ap, v.extremo, { escala: 4, reforco: 6 });
    zoom.style.backgroundImage = img;
    zoom.style.backgroundSize = tam;
  };
  pintarZoom();
  box.querySelectorAll("[data-lugar]").forEach((b) =>
    b.addEventListener("click", () => {
      st.ap.textura_lugares[b.dataset.lugar] = !st.ap.textura_lugares[b.dataset.lugar];
      mudar({ imediato: true });
    })
  );
  // durante o arraste só reaplica a textura e os números (redesenhar
  // soltaria a régua); ao soltar, redesenha e salva
  box.querySelectorAll("[data-tx]").forEach((r) => {
    r.addEventListener("input", () => {
      a[r.dataset.tx] = Number(r.value);
      if (a.gros >= a.esp) a.gros = a.esp - 1;
      const gros = box.querySelector('[data-tx="gros"]');
      gros.max = Math.min(lim.gros[1], a.esp - 1);
      gros.value = a.gros;
      box.querySelectorAll("[data-tx]").forEach((x) => (x.nextElementSibling.textContent = a[x.dataset.tx] + (x.dataset.tx === "int" ? "" : "px")));
      pintarZoom();
      aplicarPrevia();
    });
    r.addEventListener("change", () => mudar());
  });
  box.querySelector("#cfg-ap-tx-reset")?.addEventListener("click", () => {
    st.ap.textura_ajustes[tx] = { ...pad };
    mudar();
  });
}

// ─── "voltar ao padrão" de cada seção ────────────────────────────────────
const SECOES = {
  destaque: { mudou: () => st.accent !== ACCENT_PADRAO, zerar: () => (st.accent = ACCENT_PADRAO) },
  avatar: {
    mudou: () => st.ap.avatar.contorno !== "#000000" || Boolean(st.ap.avatar.preenchimento),
    zerar: () => (st.ap.avatar = { contorno: "#000000", preenchimento: null }),
  },
  paleta: {
    mudou: () => st.ap.paleta !== "padrao" || Object.keys(st.ap.fixos).length > 0 || !st.ap.contraste_auto,
    zerar: () => {
      const p = aparenciaPadrao();
      Object.assign(st.ap, { paleta: p.paleta, cores: p.cores, fixos: {}, contraste_auto: true });
      st.avancado = false;
    },
  },
  calendario: { mudou: () => Object.keys(st.ap.calendario).length > 0, zerar: () => (st.ap.calendario = {}) },
  textura: {
    mudou: () => {
      const p = aparenciaPadrao();
      return st.ap.textura !== p.textura || JSON.stringify(st.ap.textura_lugares) !== JSON.stringify(p.textura_lugares) ||
        JSON.stringify(st.ap.textura_ajustes) !== JSON.stringify(p.textura_ajustes);
    },
    zerar: () => {
      const p = aparenciaPadrao();
      Object.assign(st.ap, { textura: p.textura, textura_lugares: p.textura_lugares, textura_ajustes: p.textura_ajustes });
    },
  },
};

function desenharPadroes() {
  for (const [k, sec] of Object.entries(SECOES)) {
    const b = wrapEl.querySelector(`[data-padrao="${k}"]`);
    if (b) b.hidden = !sec.mudou();
  }
}

// ─── ícone do app (ICO-01) ───────────────────────────────────────────────
// só no app instalado (quem troca o ícone é o Rust); o perfil guarda a
// escolha e components/icone-tema.js aplica ao mudar o store
function renderIconeTema(wrap, profile) {
  const label = wrap.querySelector("#cfg-icone-tema-wrap");
  label.hidden = !window.__TAURI__?.core?.invoke;
  wrap.querySelector("#cfg-icone-tema").checked = Boolean(profile.icone_tema);
}

/** Uma vez, quando o modal é montado. */
export function wireVisual(wrap) {
  wrap.querySelectorAll("[data-padrao]").forEach((b) =>
    b.addEventListener("click", () => {
      SECOES[b.dataset.padrao].zerar();
      mudar({ imediato: true });
    })
  );
  wrap.querySelector("#cfg-ap-restaurar").addEventListener("click", () => {
    for (const k of ["destaque", "avatar", "paleta", "calendario"]) SECOES[k].zerar();
    mudar({ imediato: true });
  });
  wrap.querySelector("#cfg-ap-segue").addEventListener("change", (e) => {
    st.ap.avatar.preenchimento = e.target.checked ? null : st.accent;
    mudar({ imediato: true });
  });
  wrap.querySelector("#cfg-ap-contraste").addEventListener("change", (e) => {
    st.ap.contraste_auto = e.target.checked;
    mudar({ imediato: true });
  });
  wrap.querySelector("#cfg-ap-avancado").addEventListener("change", (e) => {
    st.avancado = e.target.checked;
    desenhar();
  });
  const icone = wrap.querySelector("#cfg-icone-tema");
  icone.addEventListener("change", async () => {
    try {
      await updateProfile({ icone_tema: icone.checked });
    } catch (err) {
      icone.checked = !icone.checked;
      showErrorModal(err.message, t("aparencia.erro_ao_salvar_o_icone"));
      return;
    }
    store.set("profile", { ...store.get("profile"), icone_tema: icone.checked });
  });
}

/** Ao fechar o modal: o que ainda estava esperando pra salvar vai agora. */
export function salvarPendente() {
  if (!timerSalvar) return;
  clearTimeout(timerSalvar);
  timerSalvar = null;
  if (st) salvar();
}

export const _paraTestes = { estado: () => st, SECOES, CAL_PADRAO };
