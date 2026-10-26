/**
 * Aba "aparência" das configurações: cor de destaque, ícone do tema,
 * formato das datas, efeitos visuais, sons e recompensas (título/tema).
 * MAN-02: saiu de configuracoes-modal.js.
 */
import { getRecompensas } from "../../api/nucleo.js";
import { getPaisesFeriados, updateProfile } from "../../api/perfil.js";
import { escapeHtml, fmtDataNoFormato, fmtMoeda, moeda } from "../../components/format.js";
import { showErrorModal } from "../err-modal.js";
import { icon } from "../../components/icons.js";
import { ACCENT_OPTIONS } from "../../components/accent-colors.js";
import { store } from "../../state/store.js";
import { playSound } from "../../components/sound.js";
import { estado } from "./estado.js";
import { IDIOMAS, carregarIdioma, idiomaAtual, localeAtual, t } from "../../i18n.js";
import { enhanceSelect, refreshCustomSelect } from "../../components/custom-select.js";
import { openExternal } from "../../components/open-external.js";
import { descricaoTema, rotuloTema, rotuloTitulo } from "../../components/textos-sistema.js";

// I18N-01 (P-84): onde mandar uma correção de tradução
const ISSUES_URL = "https://github.com/emanuel-frs/KAMI/issues/new/choose";

// GAM-04 — ver components/visual-effects.js
// ORG-07 (P-53): formato das datas — o exemplo é preenchido ao abrir
// (o de "sistema" depende do idioma da máquina)
const formatoDataOpcoes = () => [
  { value: "sistema", label: t("aparencia.seguir_o_idioma"), desc: "" },
  { value: "dma", label: t("aparencia.dd_mm_aaaa"), desc: "" },
  { value: "mda", label: t("aparencia.mm_dd_aaaa"), desc: "" },
  { value: "iso", label: t("aparencia.aaaa_mm_dd"), desc: "" },
];

const effectOptions = () => [
  { value: "completo", label: t("aparencia.completo"), desc: t("aparencia.tela_de_subida_de_nivel") },
  { value: "sutil", label: t("aparencia.sutil"), desc: t("aparencia.linhas_de_xp_e_avisos") },
  { value: "desligado", label: t("aparencia.desligado"), desc: t("aparencia.so_os_avisos_sem_nada") },
];

// GAM-13: grupos de som (components/sound.js) — coluna do perfil, rótulo, descrição
const soundGroups = () => [
  { field: "som_progresso", label: t("aparencia.progresso"), desc: t("aparencia.xp_nivel_level_up_conquista") },
  { field: "som_interface", label: t("aparencia.interface"), desc: t("aparencia.todo_botao_com_som_proprio") },
  { field: "som_avisos", label: t("aparencia.avisos"), desc: t("aparencia.notificacoes_erros_confirmacoes_e_arquivos") },
];

export function buildAparenciaPanel() {
  return `
    <div class="cfg-panel on" data-panel="aparencia">
      <div class="settings-section" style="padding-top:0;">
        <h4>${t("aparencia.idioma.titulo")}</h4>
        <p class="settings-desc">${t("aparencia.idioma.desc")}</p>
        <div class="field">
          <select id="cfg-idioma" aria-label="${t("aparencia.idioma.titulo")}">
            ${IDIOMAS.map((i) => `<option value="${i.codigo}" lang="${i.intl}">${escapeHtml(i.nome)}</option>`).join("")}
          </select>
        </div>
        <p class="settings-desc" id="cfg-idioma-ia">${t("aparencia.idioma.aviso_ia")} <a href="#" id="cfg-idioma-sugerir">${t("aparencia.idioma.sugerir")}</a></p>
        <p class="settings-status" id="cfg-idioma-status"></p>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.cor_de_destaque")}</h4>
        <p class="settings-desc">${t("aparencia.usada_em_botoes_icones_ativos")}</p>
        <div class="ki-swatches" id="cfg-accent-swatches"></div>
        <p class="settings-status" id="cfg-accent-status"></p>
        <label class="cfg-toggle" id="cfg-icone-tema-wrap" hidden>
          <input type="checkbox" id="cfg-icone-tema">
          <span>${t("aparencia.icone_do_app_na_cor")}<small>${t("aparencia.a_janela_e_a_barra")}</small></span>
        </label>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.efeitos_visuais")}</h4>
        <p class="settings-desc">${t("aparencia.como_o_kami_comemora_seu")}</p>
        <div role="radiogroup" aria-label="${t("aparencia.efeitos_visuais")}" id="cfg-effects">
          ${effectOptions().map((o) => `
          <label class="cfg-toggle">
            <input type="radio" name="cfg-effects" value="${o.value}">
            <span>${o.label}<small>${o.desc}</small></span>
          </label>`).join("")}
        </div>
        <p class="settings-status" id="cfg-effects-status"></p>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.formato_das_datas")}</h4>
        <p class="settings-desc">${t("aparencia.como_as_datas_aparecem_nas")}</p>
        <div role="radiogroup" aria-label="${t("aparencia.formato_das_datas")}" id="cfg-formato-data">
          ${formatoDataOpcoes().map((o) => `
          <label class="cfg-toggle">
            <input type="radio" name="cfg-formato-data" value="${o.value}">
            <span>${o.label}<small data-formato-exemplo="${o.value}">${o.desc}</small></span>
          </label>`).join("")}
        </div>
        <p class="settings-status" id="cfg-formato-data-status"></p>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.moeda.titulo")}</h4>
        <p class="settings-desc">${t("aparencia.moeda.desc")}</p>
        <div class="field">
          <select id="cfg-moeda" aria-label="${t("aparencia.moeda.titulo")}"></select>
        </div>
        <p class="settings-status" id="cfg-moeda-status"></p>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.pais.titulo")}</h4>
        <p class="settings-desc">${t("aparencia.pais.desc")}</p>
        <div class="field">
          <select id="cfg-pais" aria-label="${t("aparencia.pais.titulo")}"></select>
        </div>
        <p class="settings-status" id="cfg-pais-status"></p>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.sons")}</h4>
        <p class="settings-desc">${t("aparencia.bipes_8_bit_gerados_na")}</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-sound-on">
          <span>${t("aparencia.som_ligado")}<small>${t("aparencia.liga_e_desliga_todos_os")}</small></span>
        </label>
        <div class="cfg-sound-volume">
          <label for="cfg-sound-volume">${t("aparencia.volume")}</label>
          <input type="range" id="cfg-sound-volume" min="0" max="100" step="5">
          <span id="cfg-sound-volume-value" aria-hidden="true"></span>
          <button type="button" class="btn sm" id="cfg-sound-test">${t("aparencia.ouvir")}</button>
        </div>
        <div id="cfg-sound-groups">
          ${soundGroups().map((g) => `
          <label class="cfg-toggle">
            <input type="checkbox" data-sound-group="${g.field}">
            <span>${g.label}<small>${g.desc}</small></span>
          </label>`).join("")}
        </div>
        <p class="settings-status" id="cfg-sound-status"></p>
      </div>
      <div class="settings-section">
        <h4>${t("aparencia.recompensas_do_nivel")}</h4>
        <p class="settings-desc" id="cfg-rewards-desc">${t("aparencia.titulos_e_temas_de_terminal")}</p>
        <p class="cfg-subhead">${t("aparencia.titulo")} <small>${t("aparencia.aparece_sob_o_seu_nome")}</small></p>
        <div role="radiogroup" aria-label="${t("aparencia.titulo")}" id="cfg-titles"></div>
        <p class="cfg-subhead">${t("aparencia.tema_de_terminal")} <small>${t("aparencia.por_cima_da_cor_de")}</small></p>
        <div role="radiogroup" aria-label="${t("aparencia.tema_de_terminal")}" id="cfg-themes"></div>
        <p class="settings-status" id="cfg-rewards-status"></p>
      </div>
    </div>`;
}

// ── aba aparência ──────────────────────────────────────────────────────
// (sem wire-up fixo aqui: os swatches são recriados a cada abertura do
// modal via renderAccentSwatches(), chamada em openConfiguracoesModal() —
// precisa ser assim porque o accent_color atual só é conhecido depois
// de buscar o perfil, que é async e não pode travar buildModal().)
export function renderAccentSwatches(wrap, currentColor) {
  const container = wrap.querySelector("#cfg-accent-swatches");
  container.innerHTML = ACCENT_OPTIONS.map((c) => {
    const isSel = c.value === currentColor;
    const sel = isSel ? " ki-swatch--sel" : "";
    const check = icon("check", { size: 12, className: "swatch-check" });
    return `<button type="button" class="ki-swatch${sel}" data-color="${c.value}" data-tooltip="${c.label}" style="--swatch-color:${c.value};" aria-label="${c.label}" aria-pressed="${isSel}">${check}</button>`;
  }).join("");

  container.querySelectorAll(".ki-swatch").forEach((btn) => {
    btn.addEventListener("click", () => selectAccentColor(wrap, btn));
  });
}

// ICO-01: só no app instalado (quem troca o ícone é o Rust); o perfil
// guarda a escolha e components/icone-tema.js aplica ao mudar o store
export function renderIconeTema(wrap, profile) {
  const label = wrap.querySelector("#cfg-icone-tema-wrap");
  label.hidden = !window.__TAURI__?.core?.invoke;
  const input = wrap.querySelector("#cfg-icone-tema");
  input.checked = Boolean(profile.icone_tema);
  if (input.dataset.wired) return;
  input.dataset.wired = "1";
  input.addEventListener("change", async () => {
    const statusEl = wrap.querySelector("#cfg-accent-status");
    try {
      await updateProfile({ icone_tema: input.checked });
    } catch (err) {
      input.checked = !input.checked;
      showErrorModal(err.message, t("aparencia.erro_ao_salvar_o_icone"));
      return;
    }
    store.set("profile", { ...store.get("profile"), icone_tema: input.checked });
    statusEl.innerHTML = `${icon("check", { size: 12 })} ${input.checked ? t("aparencia.icone_na_cor_de_destaque") : t("aparencia.icone_padrao_de_volta")}`;
    statusEl.classList.add("settings-status--visible");
  });
}

// ── idioma (I18N-01) ───────────────────────────────────────────────────
// Salva no perfil e carrega o dicionário; o app redesenha a tela aberta e
// este modal (configuracoes-modal.js ouve o kami:idioma). O português não
// mostra o aviso de tradução — é a língua em que o Kami foi escrito.
export function renderIdioma(wrap) {
  const select = wrap.querySelector("#cfg-idioma");
  select.value = idiomaAtual();
  refreshCustomSelect(select);
  wrap.querySelector("#cfg-idioma-ia").hidden = idiomaAtual() === "pt";
}

export function wireIdioma(wrap) {
  const select = wrap.querySelector("#cfg-idioma");
  enhanceSelect(select);
  select.addEventListener("change", async () => {
    const idioma = select.value;
    try {
      store.set("profile", await updateProfile({ idioma }));
    } catch (err) {
      select.value = idiomaAtual();
      refreshCustomSelect(select);
      showErrorModal(err.message, t("aparencia.erro_ao_salvar_o_idioma"));
      return;
    }
    await carregarIdioma(idioma);
  });
  wrap.querySelector("#cfg-idioma-sugerir").addEventListener("click", (e) => {
    e.preventDefault();
    openExternal(ISSUES_URL);
  });
}

// ── moeda e país (I18N-06) ──────────────────────────────────────────────
// Moeda: só o símbolo e o formato, nunca converte. As mais usadas primeiro,
// depois todas as que o Intl conhece. País: os que têm calendário de
// feriados (backend); o atual entra mesmo sem calendário (dia útil =
// segunda a sexta).
const MOEDAS_COMUNS = ["BRL", "USD", "EUR", "GBP", "JPY", "CNY", "KRW", "INR", "CAD", "AUD", "CHF", "MXN", "ARS", "CLP", "COP", "PEN", "UYU", "SEK", "NOK", "PLN"];

function nomeDe(tipo, codigo) {
  try {
    return new Intl.DisplayNames(localeAtual(), { type: tipo }).of(codigo) || codigo;
  } catch {
    return codigo;
  }
}

function opcoesDeMoeda(atual) {
  let todas = [];
  try {
    todas = Intl.supportedValuesOf("currency");
  } catch {
    /* Intl antigo: só as comuns */
  }
  const ordem = [...new Set([...MOEDAS_COMUNS, atual, ...todas.filter((c) => !MOEDAS_COMUNS.includes(c))])];
  return ordem
    .map((c) => `<option value="${c}">${escapeHtml(`${nomeDe("currency", c)} — ${fmtMoeda(1234.5, { moeda: c })}`)}</option>`)
    .join("");
}

export async function renderMoedaEPais(wrap, profile) {
  const selMoeda = wrap.querySelector("#cfg-moeda");
  const atualMoeda = profile.moeda || moeda();
  selMoeda.innerHTML = opcoesDeMoeda(atualMoeda);
  selMoeda.value = atualMoeda;
  refreshCustomSelect(selMoeda);

  const selPais = wrap.querySelector("#cfg-pais");
  let comFeriados = [];
  try {
    comFeriados = (await getPaisesFeriados()).paises;
  } catch {
    /* sem a lista: fica só o atual */
  }
  const atualPais = profile.pais || "BR";
  const codigos = [...new Set([...comFeriados, atualPais])];
  selPais.innerHTML = codigos
    .map((c) => ({ c, nome: nomeDe("region", c) + (comFeriados.includes(c) ? "" : ` ${t("aparencia.pais.sem_feriados")}`) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, localeAtual()))
    .map(({ c, nome }) => `<option value="${c}">${escapeHtml(nome)}</option>`)
    .join("");
  selPais.value = atualPais;
  refreshCustomSelect(selPais);
}

export function wireMoedaEPais(wrap) {
  for (const [id, campo, erro] of [
    ["#cfg-moeda", "moeda", "aparencia.moeda.erro"],
    ["#cfg-pais", "pais", "aparencia.pais.erro"],
  ]) {
    const select = wrap.querySelector(id);
    enhanceSelect(select);
    select.addEventListener("change", async () => {
      const antes = store.get("profile")?.[campo];
      try {
        // a moeda nova vale na hora: o app remonta a tela aberta
        store.set("profile", await updateProfile({ [campo]: select.value }));
      } catch (err) {
        if (antes) select.value = antes;
        refreshCustomSelect(select);
        showErrorModal(err.message, t(erro));
      }
    });
  }
}

export function renderFormatoData(wrap, current) {
  const atual = current || "sistema";
  wrap.querySelectorAll("[data-formato-exemplo]").forEach((el) => {
    const v = el.dataset.formatoExemplo;
    const ex = fmtDataNoFormato("2026-10-21", v);
    el.textContent = v === "sistema" ? `agora: ${ex}` : `ex: ${ex}`;
  });
  wrap.querySelectorAll('input[name="cfg-formato-data"]').forEach((input) => {
    input.checked = input.value === atual;
  });
}

export async function selectFormatoData(wrap, value) {
  const statusEl = wrap.querySelector("#cfg-formato-data-status");
  statusEl.classList.remove("settings-status--visible");
  try {
    await updateProfile({ formato_data: value });
  } catch (err) {
    showErrorModal(err.message, t("aparencia.erro_ao_salvar_o_formato"));
    renderFormatoData(wrap, store.get("profile")?.formato_data);
    return;
  }
  // app.js ouve o perfil: aplica o formato e remonta a tela de trás
  store.set("profile", { ...store.get("profile"), formato_data: value });
  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}

export function renderEffectsOptions(wrap, current) {
  wrap.querySelectorAll('input[name="cfg-effects"]').forEach((input) => {
    input.checked = input.value === (current || "completo");
  });
}

export async function selectEffectsMode(wrap, value) {
  const statusEl = wrap.querySelector("#cfg-effects-status");
  statusEl.classList.remove("settings-status--visible");
  try {
    await updateProfile({ efeitos_visuais: value });
  } catch (err) {
    showErrorModal(err.message, t("aparencia.erro_ao_salvar_efeitos_visuais"));
    renderEffectsOptions(wrap, store.get("profile")?.efeitos_visuais);
    return;
  }
  store.set("profile", { ...store.get("profile"), efeitos_visuais: value });
  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}

// ── sons (GAM-13) ──────────────────────────────────────────────────────
export function renderSoundOptions(wrap, profile) {
  wrap.querySelector("#cfg-sound-on").checked = Boolean(profile.som_ativo);
  wrap.querySelector("#cfg-sound-volume").value = profile.som_volume ?? 60;
  wrap.querySelector("#cfg-sound-volume-value").textContent = profile.som_volume ?? 60;
  wrap.querySelectorAll("[data-sound-group]").forEach((input) => {
    input.checked = Boolean(profile[input.dataset.soundGroup]);
  });
  syncSoundDisabled(wrap);
}

// com o som desligado, volume e grupos ficam visíveis mas desabilitados
function syncSoundDisabled(wrap) {
  const on = wrap.querySelector("#cfg-sound-on").checked;
  wrap.querySelectorAll("#cfg-sound-volume, [data-sound-group]").forEach((el) => (el.disabled = !on));
}

export async function saveSound(wrap, change) {
  const statusEl = wrap.querySelector("#cfg-sound-status");
  statusEl.classList.remove("settings-status--visible");
  syncSoundDisabled(wrap);
  let saved;
  try {
    saved = await updateProfile(change);
  } catch (err) {
    showErrorModal(err.message, t("aparencia.erro_ao_salvar_sons"));
    renderSoundOptions(wrap, store.get("profile") ?? {});
    return;
  }
  const fields = ["som_ativo", "som_volume", "som_progresso", "som_interface", "som_avisos"];
  store.set("profile", { ...store.get("profile"), ...Object.fromEntries(fields.map((f) => [f, saved[f]])) });
  // ao ligar, um bipe confirma que o áudio está funcionando
  if (change.som_ativo) playSound("aviso", { force: true });
  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}

// ── recompensas do nível (GAM-10) ──────────────────────────────────────
// Título e tema de terminal liberados pelo nível geral (catálogo e regra em
// backend/app/recompensas.py). O que ainda não foi liberado aparece
// desabilitado com "nível N" — dá pra ver o que vem pela frente.
function rewardOption(name, item, checked) {
  const lock = item.unlocked ? "" : t("aparencia.liberado_nivel", { nivel: item.level });
  const desc = item.description ? `${item.description}${lock}` : lock.replace(/^ · /, "");
  return `
    <label class="cfg-toggle${item.unlocked ? "" : " cfg-toggle--locked"}">
      <input type="radio" name="${name}" value="${escapeHtml(item.key)}"${checked ? " checked" : ""}${item.unlocked ? "" : " disabled"}>
      <span>${escapeHtml(item.label)}${desc ? `<small>${escapeHtml(desc)}</small>` : ""}</span>
    </label>`;
}

export async function renderRewards(wrap, profile) {
  let data;
  try {
    data = await getRecompensas();
  } catch {
    wrap.querySelector("#cfg-rewards-desc").textContent = t("aparencia.nao_deu_pra_carregar_as");
    return;
  }
  wrap.querySelector("#cfg-rewards-desc").textContent =
    t("aparencia.recompensas_desc", { nivel: data.level });
  const auto = { key: "auto", label: t("aparencia.automatico"), description: t("aparencia.o_titulo_mais_alto_que"), unlocked: true };
  const titulos = data.titulos.map((t) => ({ ...t, label: rotuloTitulo(t.key, t.label) }));
  wrap.querySelector("#cfg-titles").innerHTML = [auto, ...titulos]
    .map((t) => rewardOption("cfg-title", t, (profile.titulo ?? "auto") === t.key))
    .join("");
  wrap.querySelector("#cfg-themes").innerHTML = data.temas
    .map((t) => ({ ...t, label: rotuloTema(t.key, t.label), description: descricaoTema(t.key, t.description) }))
    .map((t) => rewardOption("cfg-theme", t, (profile.tema ?? "padrao") === t.key))
    .join("");
}

export async function selectReward(wrap, field, value) {
  const statusEl = wrap.querySelector("#cfg-rewards-status");
  statusEl.classList.remove("settings-status--visible");
  let saved;
  try {
    saved = await updateProfile({ [field]: value });
  } catch (err) {
    showErrorModal(err.message, t("aparencia.erro_ao_salvar_recompensa"));
    renderRewards(wrap, store.get("profile") ?? {});
    return;
  }
  // o tema vale na hora (components/tema.js escuta o store); o título
  // aparece no card de perfil (widgets/profile.js também escuta)
  store.set("profile", { ...store.get("profile"), titulo: saved.titulo, tema: saved.tema });
  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}

async function selectAccentColor(wrap, btn) {
  if (estado.busy) return;
  const statusEl = wrap.querySelector("#cfg-accent-status");
  const color = btn.dataset.color;

  wrap.querySelectorAll(".ki-swatch").forEach((b) => {
    const isSel = b === btn;
    b.classList.toggle("ki-swatch--sel", isSel);
    b.setAttribute("aria-pressed", String(isSel));
  });
  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  try {
    await updateProfile({ accent_color: color });
  } catch (err) {
    showErrorModal(err.message, t("aparencia.erro_ao_salvar_cor_de"));
    return;
  }

  // aplica globalmente na hora, igual o boot faz em app.js e o
  // widget de perfil faz ao salvar (document.documentElement, não
  // só dentro do modal).
  document.documentElement.style.setProperty("--accent", color);

  // propaga pro store — mantém qualquer outro lugar que leia o
  // perfil (ex: widget de perfil) em sync sem precisar recarregar.
  store.set("profile", { ...store.get("profile"), accent_color: color });

  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}
