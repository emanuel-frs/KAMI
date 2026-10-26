/**
 * Aba "sobre" das configurações: versão, diagnóstico para copiar
 * (CONF-06) e relatar um problema.
 * MAN-02: saiu de configuracoes-modal.js.
 */
import { getDiagnostico } from "../../api/sistema.js";
import { copyText } from "../../components/clipboard.js";
import { escapeHtml, localDateKey } from "../../components/format.js";
import { showErrorModal } from "../err-modal.js";
import { icon } from "../../components/icons.js";
import {
  temAtualizador,
  estadoAtualizacao,
  procurarAgora,
  definirProcurar,
  atualizarAgora,
  verNovidades,
  comoAtualiza,
} from "../../components/atualizacao.js";
import { store } from "../../state/store.js";
import { t } from "../../i18n.js";

// CONF-06: relato de problema (templates em .github/ISSUE_TEMPLATE)
const ISSUES_URL = "https://github.com/emanuel-frs/KAMI/issues/new/choose";

// ── aba sobre (CONF-06) ────────────────────────────────────────────────
// Versão do app e o "copiar diagnóstico": versão, sistema, tamanho do
// banco e o fim do kami-backend.log, montado no BACKEND já sem dado
// pessoal (e-mails, chaves, senhas, valores e a pasta pessoal saem —
// ver routers/sistema.py::anonimizar). A prévia mostra exatamente o que
// vai ser copiado/salvo, pra pessoa conferir antes de colar num relato.
export function buildSobrePanel() {
  return `
    <div class="cfg-panel" data-panel="sobre">
      <div class="settings-section" style="padding-top:0;">
        <h4>${t("sobre.kami")}</h4>
        <p class="settings-desc" id="cfg-sobre-versao">${t("sobre.versao")}</p>
      </div>
      <div class="settings-section" id="cfg-atualiza" hidden>
        <h4>${t("sobre.atualizacoes")}</h4>
        <p class="settings-desc">${t("sobre.o_kami_avisa_no_sino")}</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-atualiza-procurar">
          <span>${t("sobre.procurar_atualizacoes")}<small>${t("sobre.desligado_o_kami_nao_faz")}</small></span>
        </label>
        <div class="form-actions">
          <button class="btn sm" id="cfg-atualiza-agora">${t("sobre.procurar_agora")}</button>
          <button class="btn sm primary" id="cfg-atualiza-instalar" hidden>${t("sobre.atualizar_agora")}</button>
          <button class="btn sm" id="cfg-atualiza-novidades" hidden>${t("sobre.ver_novidades")}</button>
        </div>
        <p class="settings-status" id="cfg-atualiza-status" aria-live="polite"></p>
      </div>
      <div class="settings-section">
        <h4>${t("sobre.diagnostico")}</h4>
        <p class="settings-desc">${t("sobre.diag_desc")}</p>
        <div class="form-actions">
          <button class="btn sm" id="cfg-diag-copy">${t("sobre.copiar_diagnostico")}</button>
          <button class="btn sm" id="cfg-diag-save">${t("sobre.salvar_txt")}</button>
          <button class="btn sm" id="cfg-diag-folder" hidden>${t("sobre.abrir_pasta_do_log")}</button>
          <button class="btn sm" id="cfg-diag-report" data-open-link="${ISSUES_URL}">${t("sobre.relatar_um_problema")}</button>
        </div>
        <p class="settings-status" id="cfg-diag-status"></p>
        <pre class="cfg-diag-preview" id="cfg-diag-preview" tabindex="0" aria-label="${t("sobre.previa_do_diagnostico")}">${t("geral.carregando")}</pre>
      </div>
    </div>`;
}

let diagText = "";

async function loadDiagnostico(wrap) {
  const pre = wrap.querySelector("#cfg-diag-preview");
  try {
    const diag = await getDiagnostico();
    diagText = `${diag.texto}\n\n--- tela ---\n${navigator.userAgent}`;
    wrap.querySelector("#cfg-sobre-versao").textContent = t("sobre.versao_n", { versao: diag.versao });
    pre.textContent = diagText;
  } catch (err) {
    diagText = "";
    pre.textContent = t("sobre.erro_diag", { erro: err.message });
  }
}

// ── atualizações (DIST-01) ─────────────────────────────────────────────
// Só no app instalado (quem consulta é o Rust). Mostra sempre a versão
// encontrada, mesmo a que foi "pulada" no sino.
function renderAtualizacao(wrap) {
  const sec = wrap.querySelector("#cfg-atualiza");
  if (!sec) return;
  const { disponivel, ultimaConsulta, ligado, instalando } = estadoAtualizacao();
  wrap.querySelector("#cfg-atualiza-procurar").checked = ligado;
  const instalar = wrap.querySelector("#cfg-atualiza-instalar");
  instalar.hidden = !disponivel?.instalavel;
  instalar.disabled = instalando;
  instalar.textContent = instalando ? "atualizando…" : t("sobre.atualizar_agora");
  wrap.querySelector("#cfg-atualiza-novidades").hidden = !disponivel;
  const pulada = disponivel && disponivel.versao === store.get("profile")?.atualizacao_pulada;
  const status = wrap.querySelector("#cfg-atualiza-status");
  if (disponivel) {
    status.textContent = t("sobre.versao_disponivel", { versao: disponivel.versao, pulada: pulada ? t("sobre.pulada_no_sino") : "", como: comoAtualiza(disponivel) });
  } else if (ultimaConsulta) {
    status.textContent = t("sobre.mais_recente", { hora: `${String(ultimaConsulta.getHours()).padStart(2, "0")}:${String(ultimaConsulta.getMinutes()).padStart(2, "0")}` });
  } else {
    status.textContent = ligado ? "" : t("sobre.procura_desligada");
  }
  status.classList.toggle("settings-status--visible", !!status.textContent);
}

function wireAtualizacao(wrap) {
  const sec = wrap.querySelector("#cfg-atualiza");
  if (!temAtualizador()) return;
  sec.hidden = false;
  window.addEventListener("kami:atualizacao", () => renderAtualizacao(wrap));
  wrap.querySelector("#cfg-atualiza-procurar").addEventListener("change", async (e) => {
    try {
      await definirProcurar(e.target.checked);
    } catch (err) {
      e.target.checked = !e.target.checked;
      showErrorModal(err.message, t("sobre.erro_ao_salvar"));
    }
  });
  const agora = wrap.querySelector("#cfg-atualiza-agora");
  agora.addEventListener("click", async () => {
    const status = wrap.querySelector("#cfg-atualiza-status");
    agora.disabled = true;
    status.textContent = t("sobre.procurando");
    status.classList.add("settings-status--visible");
    try {
      await procurarAgora();
      renderAtualizacao(wrap);
    } catch (err) {
      // o Rust já manda a mensagem pronta (sem rede, sem a lista de versões...)
      status.textContent = String(err?.message || err);
      status.classList.add("settings-status--visible");
    } finally {
      agora.disabled = false;
    }
  });
  wrap.querySelector("#cfg-atualiza-instalar").addEventListener("click", () => atualizarAgora());
  wrap.querySelector("#cfg-atualiza-novidades").addEventListener("click", () => verNovidades());
}

function diagStatus(wrap, html) {
  const el = wrap.querySelector("#cfg-diag-status");
  el.innerHTML = html;
  el.classList.add("settings-status--visible");
}

export function wireSobreTab(wrap) {
  wrap.querySelector('.cfg-tab[data-tab="sobre"]').addEventListener("click", () => {
    loadDiagnostico(wrap);
    renderAtualizacao(wrap);
  });
  wireAtualizacao(wrap);
  wrap.querySelector("#cfg-diag-copy").addEventListener("click", async () => {
    if (!diagText) await loadDiagnostico(wrap);
    const ok = diagText && (await copyText(diagText));
    diagStatus(wrap, ok ? `${icon("check", { size: 12 })} ${t("sobre.diag_copiado")}` : t("sobre.nao_deu_pra_copiar_selecione"));
  });
  wrap.querySelector("#cfg-diag-save").addEventListener("click", async () => {
    if (!diagText) await loadDiagnostico(wrap);
    if (!diagText) return;
    const url = URL.createObjectURL(new Blob([diagText], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    const filename = `kami-diagnostico-${localDateKey()}.txt`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    diagStatus(wrap, `${icon("check", { size: 12 })} ${escapeHtml(t("sobre.salvo_como", { arquivo: filename }))}`);
  });
  // abrir a pasta é do app instalado (comando do Rust, CONF-02) — no navegador de dev não existe
  const folderBtn = wrap.querySelector("#cfg-diag-folder");
  if (window.__TAURI__?.core?.invoke) {
    folderBtn.hidden = false;
    folderBtn.addEventListener("click", async () => {
      try {
        await window.__TAURI__.core.invoke("open_log_folder");
      } catch (err) {
        showErrorModal(String(err), t("sobre.nao_deu_pra_abrir_a"));
      }
    });
  }
}
