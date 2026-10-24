/**
 * Aba "aparência" das configurações: cor de destaque, ícone do tema,
 * formato das datas, efeitos visuais, sons e recompensas (título/tema).
 * MAN-02: saiu de configuracoes-modal.js.
 */
import { getRecompensas } from "../../api/nucleo.js";
import { updateProfile } from "../../api/perfil.js";
import { escapeHtml, fmtDataNoFormato } from "../../components/format.js";
import { showErrorModal } from "../err-modal.js";
import { icon } from "../../components/icons.js";
import { ACCENT_OPTIONS } from "../../components/accent-colors.js";
import { store } from "../../state/store.js";
import { playSound } from "../../components/sound.js";
import { estado } from "./estado.js";
import { IDIOMAS, carregarIdioma, idiomaAtual, t } from "../../i18n.js";
import { enhanceSelect, refreshCustomSelect } from "../../components/custom-select.js";
import { openExternal } from "../../components/open-external.js";

// I18N-01 (P-84): onde mandar uma correção de tradução
const ISSUES_URL = "https://github.com/emanuel-frs/KAMI/issues/new/choose";

// GAM-04 — ver components/visual-effects.js
// ORG-07 (P-53): formato das datas — o exemplo é preenchido ao abrir
// (o de "sistema" depende do idioma da máquina)
const FORMATO_DATA_OPCOES = [
  { value: "sistema", label: "seguir o idioma", desc: "" },
  { value: "dma", label: "dd/mm/aaaa", desc: "" },
  { value: "mda", label: "mm/dd/aaaa", desc: "" },
  { value: "iso", label: "aaaa-mm-dd", desc: "" },
];

const EFFECT_OPTIONS = [
  { value: "completo", label: "completo", desc: "tela de subida de nível, linhas de +xp e avisos" },
  { value: "sutil", label: "sutil", desc: "linhas de +xp e avisos, sem a tela cheia" },
  { value: "desligado", label: "desligado", desc: "só os avisos, sem nada animado" },
];

// GAM-13: grupos de som (components/sound.js) — coluna do perfil, rótulo, descrição
const SOUND_GROUPS = [
  { field: "som_progresso", label: "progresso", desc: "+xp, nível, LEVEL UP, conquista, missão e sequência salva" },
  { field: "som_interface", label: "interface", desc: "todo botão (com som próprio pra confirmar, apagar, abas e opções), abrir e fechar janelas, trocar de tela, a voz da kami e a abertura do app" },
  { field: "som_avisos", label: "avisos", desc: "notificações, erros, confirmações e arquivos baixados" },
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
        <h4>cor de destaque</h4>
        <p class="settings-desc">usada em botões, ícones ativos, gráficos e bordas em todo o app.</p>
        <div class="ki-swatches" id="cfg-accent-swatches"></div>
        <p class="settings-status" id="cfg-accent-status"></p>
        <label class="cfg-toggle" id="cfg-icone-tema-wrap" hidden>
          <input type="checkbox" id="cfg-icone-tema">
          <span>ícone do app na cor de destaque<small>a janela e a barra de tarefas mudam na hora; o atalho do menu iniciar (windows) e o lançador (linux) na próxima vez que o kami abrir.</small></span>
        </label>
      </div>
      <div class="settings-section">
        <h4>efeitos visuais</h4>
        <p class="settings-desc">como o kami comemora seu progresso. com o sistema em "reduzir movimento", nada se mexe em nenhuma opção.</p>
        <div role="radiogroup" aria-label="efeitos visuais" id="cfg-effects">
          ${EFFECT_OPTIONS.map((o) => `
          <label class="cfg-toggle">
            <input type="radio" name="cfg-effects" value="${o.value}">
            <span>${o.label}<small>${o.desc}</small></span>
          </label>`).join("")}
        </div>
        <p class="settings-status" id="cfg-effects-status"></p>
      </div>
      <div class="settings-section">
        <h4>formato das datas</h4>
        <p class="settings-desc">como as datas aparecem nas telas. "seguir o idioma" usa a ordem do idioma do kami; os campos de data dos formulários seguem sempre o idioma do sistema.</p>
        <div role="radiogroup" aria-label="formato das datas" id="cfg-formato-data">
          ${FORMATO_DATA_OPCOES.map((o) => `
          <label class="cfg-toggle">
            <input type="radio" name="cfg-formato-data" value="${o.value}">
            <span>${o.label}<small data-formato-exemplo="${o.value}">${o.desc}</small></span>
          </label>`).join("")}
        </div>
        <p class="settings-status" id="cfg-formato-data-status"></p>
      </div>
      <div class="settings-section">
        <h4>sons</h4>
        <p class="settings-desc">bipes 8-bit gerados na hora, no estilo terminal. cada grupo liga e desliga sozinho.</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-sound-on">
          <span>som ligado<small>liga e desliga todos os sons de uma vez</small></span>
        </label>
        <div class="cfg-sound-volume">
          <label for="cfg-sound-volume">volume</label>
          <input type="range" id="cfg-sound-volume" min="0" max="100" step="5">
          <span id="cfg-sound-volume-value" aria-hidden="true"></span>
          <button type="button" class="btn sm" id="cfg-sound-test">ouvir</button>
        </div>
        <div id="cfg-sound-groups">
          ${SOUND_GROUPS.map((g) => `
          <label class="cfg-toggle">
            <input type="checkbox" data-sound-group="${g.field}">
            <span>${g.label}<small>${g.desc}</small></span>
          </label>`).join("")}
        </div>
        <p class="settings-status" id="cfg-sound-status"></p>
      </div>
      <div class="settings-section">
        <h4>recompensas do nível</h4>
        <p class="settings-desc" id="cfg-rewards-desc">títulos e temas de terminal liberados conforme seu nível geral sobe.</p>
        <p class="cfg-subhead">título <small>(aparece sob o seu nome no perfil)</small></p>
        <div role="radiogroup" aria-label="título" id="cfg-titles"></div>
        <p class="cfg-subhead">tema de terminal <small>(por cima da cor de destaque)</small></p>
        <div role="radiogroup" aria-label="tema de terminal" id="cfg-themes"></div>
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
      showErrorModal(err.message, "erro ao salvar o ícone do app");
      return;
    }
    store.set("profile", { ...store.get("profile"), icone_tema: input.checked });
    statusEl.innerHTML = `${icon("check", { size: 12 })} ${input.checked ? "ícone na cor de destaque" : "ícone padrão de volta"}`;
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
      showErrorModal(err.message, "erro ao salvar o idioma");
      return;
    }
    await carregarIdioma(idioma);
  });
  wrap.querySelector("#cfg-idioma-sugerir").addEventListener("click", (e) => {
    e.preventDefault();
    openExternal(ISSUES_URL);
  });
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
    showErrorModal(err.message, "erro ao salvar o formato das datas");
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
    showErrorModal(err.message, "erro ao salvar efeitos visuais");
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
    showErrorModal(err.message, "erro ao salvar sons");
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
  const lock = item.unlocked ? "" : ` · liberado no nível ${item.level}`;
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
    wrap.querySelector("#cfg-rewards-desc").textContent = "não deu pra carregar as recompensas agora.";
    return;
  }
  wrap.querySelector("#cfg-rewards-desc").textContent =
    `títulos e temas de terminal liberados conforme seu nível geral sobe — você está no nível ${data.level}.`;
  const auto = { key: "auto", label: "automático", description: "o título mais alto que você já liberou", unlocked: true };
  wrap.querySelector("#cfg-titles").innerHTML = [auto, ...data.titulos]
    .map((t) => rewardOption("cfg-title", t, (profile.titulo ?? "auto") === t.key))
    .join("");
  wrap.querySelector("#cfg-themes").innerHTML = data.temas
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
    showErrorModal(err.message, "erro ao salvar recompensa");
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
    showErrorModal(err.message, "erro ao salvar cor de destaque");
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
