/**
 * Aba "sobre" das configurações: versão, relatar um erro ou dar uma
 * ideia (EST-01) e diagnóstico para copiar (CONF-06).
 * MAN-02: saiu de configuracoes-modal.js.
 */
import { getDiagnostico, contasParaRetorno, enviarRetorno } from "../../api/sistema.js";
import { navigateTo } from "../../components/navigate.js";
import { copyText } from "../../components/clipboard.js";
import { escapeHtml, localDateKey } from "../../components/format.js";
import { showErrorModal } from "../err-modal.js";
import { openExternal } from "../../components/open-external.js";
import { EMAIL, linkEmail, linkGithub } from "../../components/retorno.js";
import { icon } from "../../components/icons.js";
import { enhanceSelect, refreshCustomSelect } from "../../components/custom-select.js";
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
        <h4>${t("sobre.retorno.titulo")}</h4>
        <p class="settings-desc">${escapeHtml(t("sobre.retorno.desc", { email: EMAIL }))}</p>
        <div class="field">
          <select id="cfg-ret-tipo" aria-label="${t("sobre.retorno.tipo")}">
            <option value="bug">${t("sobre.retorno.tipo_bug")}</option>
            <option value="ideia">${t("sobre.retorno.tipo_ideia")}</option>
          </select>
        </div>
        <div class="field">
          <textarea id="cfg-ret-texto" rows="4" maxlength="4000" aria-label="${t("sobre.retorno.mensagem")}" placeholder="${t("sobre.retorno.placeholder")}"></textarea>
        </div>
        <div class="field" id="cfg-ret-de-campo" hidden>
          <select id="cfg-ret-de" aria-label="${t("sobre.retorno.enviar_de")}"></select>
        </div>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-ret-diag" checked>
          <span>${t("sobre.retorno.incluir_diag")}<small>${t("sobre.retorno.incluir_diag_desc")}</small></span>
        </label>
        <div class="form-actions">
          <button class="btn sm primary" id="cfg-ret-email">${t("sobre.retorno.enviar_email")}</button>
          <button class="btn sm" id="cfg-ret-github">${t("sobre.retorno.abrir_github")}</button>
        </div>
        <p class="settings-status" id="cfg-ret-status" aria-live="polite"></p>
        <div id="cfg-ret-falta-conta" hidden>
          <p class="settings-desc">${t("sobre.retorno.sem_conta")}</p>
          <div class="form-actions">
            <button class="btn sm primary" id="cfg-ret-ligar">${t("sobre.retorno.ligar_conta")}</button>
            <button class="btn sm" id="cfg-ret-mailto">${t("sobre.retorno.abrir_programa")}</button>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <h4>${t("sobre.diagnostico")}</h4>
        <p class="settings-desc">${t("sobre.diag_desc")}</p>
        <div class="form-actions">
          <button class="btn sm" id="cfg-diag-copy">${t("sobre.copiar_diagnostico")}</button>
          <button class="btn sm" id="cfg-diag-save">${t("sobre.salvar_txt")}</button>
          <button class="btn sm" id="cfg-diag-folder" hidden>${t("sobre.abrir_pasta_do_log")}</button>
        </div>
        <p class="settings-status" id="cfg-diag-status"></p>
        <pre class="cfg-diag-preview" id="cfg-diag-preview" tabindex="0" aria-label="${t("sobre.previa_do_diagnostico")}">${t("geral.carregando")}</pre>
      </div>
    </div>`;
}

let diagText = "";
let versao = "";

async function loadDiagnostico(wrap) {
  const pre = wrap.querySelector("#cfg-diag-preview");
  try {
    const diag = await getDiagnostico();
    diagText = `${diag.texto}\n\n--- tela ---\n${navigator.userAgent}`;
    versao = diag.versao;
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

// ── relatar um erro ou dar uma ideia (EST-01, P-194) ───────────────────
// Erro já leva o diagnóstico marcado; ideia, desmarcado. "enviar por
// e-mail" manda direto pela conta ligada em organização › e-mail (SMTP no
// backend, routers/retorno.py); sem conta, o aviso leva até lá — e o
// programa de e-mail (mailto) fica como saída de quem não quer ligar uma.
let contasRetorno = null;

async function carregarContasRetorno(wrap) {
  try {
    contasRetorno = await contasParaRetorno();
  } catch {
    contasRetorno = [];
  }
  const campo = wrap.querySelector("#cfg-ret-de-campo");
  const sel = wrap.querySelector("#cfg-ret-de");
  sel.innerHTML = contasRetorno
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)} · ${escapeHtml(c.username)}</option>`)
    .join("");
  campo.hidden = contasRetorno.length < 2;
  refreshCustomSelect(sel);
  return contasRetorno;
}

function wireRetorno(wrap) {
  const tipo = wrap.querySelector("#cfg-ret-tipo");
  const texto = wrap.querySelector("#cfg-ret-texto");
  const comDiag = wrap.querySelector("#cfg-ret-diag");
  const status = wrap.querySelector("#cfg-ret-status");
  const semConta = wrap.querySelector("#cfg-ret-falta-conta");
  const botaoEmail = wrap.querySelector("#cfg-ret-email");
  const avisar = (msg) => {
    status.textContent = msg;
    status.classList.toggle("settings-status--visible", !!msg);
  };
  enhanceSelect(tipo);
  enhanceSelect(wrap.querySelector("#cfg-ret-de"));
  tipo.addEventListener("change", () => {
    comDiag.checked = tipo.value === "bug";
  });
  const montar = async () => {
    const msg = texto.value.trim();
    if (!msg) {
      avisar(t("sobre.retorno.escreva_antes"));
      texto.focus();
      return null;
    }
    if (!diagText) await loadDiagnostico(wrap);
    return {
      tipo: tipo.value,
      texto: msg,
      diag: comDiag.checked ? diagText : "",
      versao,
      separador: t("sobre.retorno.separador"),
      assunto: `Kami ${versao} · ${t(`sobre.retorno.tipo_${tipo.value}`)}`,
    };
  };
  const abrirLink = async (onde) => {
    const dados = await montar();
    if (!dados) return;
    const { url, copiar } = onde === "email" ? linkEmail(dados) : linkGithub(dados);
    if (copiar && !(await copyText(copiar))) {
      avisar(t("sobre.nao_deu_pra_copiar_selecione"));
      return;
    }
    openExternal(url);
    if (copiar) avisar(t(onde === "email" ? "sobre.retorno.copiado_email" : "sobre.retorno.copiado_github"));
    else avisar(onde === "email" ? t("sobre.retorno.abrindo_email", { email: EMAIL }) : t("sobre.retorno.abrindo_github"));
  };
  const enviarPorEmail = async () => {
    semConta.hidden = true;
    const dados = await montar();
    if (!dados) return;
    // sem conta na última leitura: lê de novo (pode ter ligado uma agora)
    const contas = contasRetorno?.length ? contasRetorno : await carregarContasRetorno(wrap);
    if (!contas.length) {
      avisar("");
      semConta.hidden = false;
      wrap.querySelector("#cfg-ret-ligar").focus();
      return;
    }
    botaoEmail.disabled = true;
    avisar(t("sobre.retorno.enviando"));
    try {
      const r = await enviarRetorno({
        conta_id: wrap.querySelector("#cfg-ret-de").value || contas[0].id,
        assunto: dados.assunto,
        mensagem: dados.texto,
        diagnostico: dados.diag ? `${dados.separador}\n${dados.diag}` : "",
      });
      avisar(t("sobre.retorno.enviado", { de: r.de, para: r.para }));
      texto.value = "";
    } catch (err) {
      avisar(err.message);
    } finally {
      botaoEmail.disabled = false;
    }
  };
  botaoEmail.addEventListener("click", enviarPorEmail);
  wrap.querySelector("#cfg-ret-github").addEventListener("click", () => abrirLink("github"));
  wrap.querySelector("#cfg-ret-mailto").addEventListener("click", () => abrirLink("email"));
  wrap.querySelector("#cfg-ret-ligar").addEventListener("click", () => {
    // a mensagem escrita fica no campo: o modal só fecha, não é destruído
    wrap.classList.remove("open");
    contasRetorno = null; // ao voltar, lê as contas de novo
    navigateTo("organizacao", { tab: "email", novaContaEmail: true });
  });
}

export function wireSobreTab(wrap) {
  wrap.querySelector('.cfg-tab[data-tab="sobre"]').addEventListener("click", () => {
    loadDiagnostico(wrap);
    renderAtualizacao(wrap);
    carregarContasRetorno(wrap);
  });
  wireAtualizacao(wrap);
  wireRetorno(wrap);
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
