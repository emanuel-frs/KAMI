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

function diagStatus(wrap, html) {
  const el = wrap.querySelector("#cfg-diag-status");
  el.innerHTML = html;
  el.classList.add("settings-status--visible");
}

export function wireSobreTab(wrap) {
  wrap.querySelector('.cfg-tab[data-tab="sobre"]').addEventListener("click", () => loadDiagnostico(wrap));
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
