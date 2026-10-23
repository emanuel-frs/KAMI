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
        <h4>kami</h4>
        <p class="settings-desc" id="cfg-sobre-versao">versão —</p>
      </div>
      <div class="settings-section" id="cfg-atualiza" hidden>
        <h4>atualizações</h4>
        <p class="settings-desc">o kami avisa no sino quando sai uma versão nova — nunca baixa nem instala sozinho. pra saber, ele consulta só a lista de versões da página do kami no GitHub (ao abrir e uma vez por dia); nada seu vai junto.</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-atualiza-procurar">
          <span>procurar atualizações<small>desligado, o kami não faz essa consulta nunca — dá pra ver as versões em github.com/emanuel-frs/KAMI/releases.</small></span>
        </label>
        <div class="form-actions">
          <button class="btn sm" id="cfg-atualiza-agora">procurar agora</button>
          <button class="btn sm primary" id="cfg-atualiza-instalar" hidden>atualizar agora</button>
          <button class="btn sm" id="cfg-atualiza-novidades" hidden>ver novidades</button>
        </div>
        <p class="settings-status" id="cfg-atualiza-status" aria-live="polite"></p>
      </div>
      <div class="settings-section">
        <h4>diagnóstico</h4>
        <p class="settings-desc">quando algo der errado, o diagnóstico junta a versão, o sistema e o fim do log do kami num texto pronto pra colar num relato de problema. e-mails, chaves, senhas, valores em R$ e o nome da sua pasta pessoal saem antes — confira abaixo o que vai.</p>
        <div class="form-actions">
          <button class="btn sm" id="cfg-diag-copy">copiar diagnóstico</button>
          <button class="btn sm" id="cfg-diag-save">salvar .txt</button>
          <button class="btn sm" id="cfg-diag-folder" hidden>abrir pasta do log</button>
          <button class="btn sm" id="cfg-diag-report" data-open-link="${ISSUES_URL}">relatar um problema</button>
        </div>
        <p class="settings-status" id="cfg-diag-status"></p>
        <pre class="cfg-diag-preview" id="cfg-diag-preview" tabindex="0" aria-label="prévia do diagnóstico">carregando…</pre>
      </div>
    </div>`;
}

let diagText = "";

async function loadDiagnostico(wrap) {
  const pre = wrap.querySelector("#cfg-diag-preview");
  try {
    const diag = await getDiagnostico();
    diagText = `${diag.texto}\n\n--- tela ---\n${navigator.userAgent}`;
    wrap.querySelector("#cfg-sobre-versao").textContent = `versão ${diag.versao}`;
    pre.textContent = diagText;
  } catch (err) {
    diagText = "";
    pre.textContent = `não deu pra gerar o diagnóstico: ${err.message}`;
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
  instalar.textContent = instalando ? "atualizando…" : "atualizar agora";
  wrap.querySelector("#cfg-atualiza-novidades").hidden = !disponivel;
  const pulada = disponivel && disponivel.versao === store.get("profile")?.atualizacao_pulada;
  const status = wrap.querySelector("#cfg-atualiza-status");
  if (disponivel) {
    status.textContent = `versão ${disponivel.versao} disponível${pulada ? " (pulada no sino)" : ""} — ${comoAtualiza(disponivel)}.`;
  } else if (ultimaConsulta) {
    status.textContent = `você está na versão mais recente (conferido às ${String(ultimaConsulta.getHours()).padStart(2, "0")}:${String(ultimaConsulta.getMinutes()).padStart(2, "0")}).`;
  } else {
    status.textContent = ligado ? "" : "procura desligada.";
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
      showErrorModal(err.message, "erro ao salvar");
    }
  });
  const agora = wrap.querySelector("#cfg-atualiza-agora");
  agora.addEventListener("click", async () => {
    const status = wrap.querySelector("#cfg-atualiza-status");
    agora.disabled = true;
    status.textContent = "procurando…";
    status.classList.add("settings-status--visible");
    try {
      await procurarAgora();
      renderAtualizacao(wrap);
    } catch (err) {
      status.textContent = `não deu pra procurar agora (${String(err?.message || err)}). confira a internet e tente de novo.`;
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
    diagStatus(wrap, ok ? `${icon("check", { size: 12 })} diagnóstico copiado` : "não deu pra copiar — selecione o texto abaixo e copie à mão");
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
    diagStatus(wrap, `${icon("check", { size: 12 })} salvo como ${escapeHtml(filename)} (confira sua pasta de downloads)`);
  });
  // abrir a pasta é do app instalado (comando do Rust, CONF-02) — no navegador de dev não existe
  const folderBtn = wrap.querySelector("#cfg-diag-folder");
  if (window.__TAURI__?.core?.invoke) {
    folderBtn.hidden = false;
    folderBtn.addEventListener("click", async () => {
      try {
        await window.__TAURI__.core.invoke("open_log_folder");
      } catch (err) {
        showErrorModal(String(err), "não deu pra abrir a pasta");
      }
    });
  }
}
