/**
 * "Remover tudo do Kami deste computador" (DIST-03, P-91/P-92) — fim da
 * zona de perigo em configurações › backup e dados.
 *
 * Diferente do "apagar tudo" de cima (que zera os dados e o Kami continua
 * aberto, como recém-instalado): aqui sai TUDO o que o Kami deixou nesta
 * máquina, menos o programa e a pasta extra das cópias:
 *   1. backend: a chave das senhas sai do cofre do sistema
 *      (POST /api/sistema/remover-do-computador);
 *   2. Rust (src-tauri/src/limpeza.rs): início com o sistema, ícone da cor
 *      no lançador/atalhos, pasta de dados inteira (banco, cópias, log) e,
 *      ao fechar, o cache da tela; no Windows, se pedido, abre o
 *      desinstalador. O app fecha no fim.
 *
 * Confirmação dupla: digitar a palavra e confirmar no modal. Antes, a
 * oferta de exportar (o export de cima, com senha, é o que leva as senhas
 * salvas pra outro computador).
 *
 * Só no app instalado — no navegador de dev não existe o lado do Rust.
 */
import { post } from "../../api/client.js";
import { getBackups } from "../../api/backups.js";
import { escapeHtml } from "../../components/format.js";
import { showConfirmModal } from "../confirm-modal.js";
import { showErrorModal } from "../err-modal.js";
import { estado } from "./estado.js";

const REMOVER_WORD = "remover";
const NO_WINDOWS = /windows/i.test(navigator.userAgent);

export function removerSectionHtml() {
  return `
      <div class="settings-section settings-danger" id="sm-remover" hidden>
        <h4>remover tudo do kami deste computador</h4>
        <p class="settings-desc">pra quem vai parar de usar o kami aqui. apaga seus dados, as cópias automáticas, a chave das senhas no cofre do sistema, o iniciar com o sistema, o ícone da cor no ${NO_WINDOWS ? "menu iniciar" : "lançador"} e o cache da tela — e fecha o kami. não tem volta.</p>
        <p class="settings-desc" id="sm-remover-fica"></p>
        ${
          NO_WINDOWS
            ? `<label class="cfg-toggle">
          <input type="checkbox" id="sm-remover-desinstalar" checked>
          <span>abrir o desinstalador do programa depois<small>o mesmo de "adicionar ou remover programas"</small></span>
        </label>`
            : ""
        }
        <div class="field">
          <label for="sm-remover-confirm">digite <strong>${REMOVER_WORD}</strong> pra habilitar o botão abaixo</label>
          <input type="text" id="sm-remover-confirm" placeholder="${REMOVER_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm" id="sm-remover-exportar">exportar um backup antes</button>
          <button class="btn sm danger" id="sm-remover-btn" disabled>remover tudo deste computador</button>
        </div>
      </div>`;
}

/** O que fica depois: a pasta extra (se houver) e o programa. */
async function renderOQueFica(wrap) {
  let pasta = null;
  try {
    pasta = (await getBackups()).pasta_extra;
  } catch {
    /* sem a lista de cópias: o texto fica sem a pasta extra */
  }
  const programa = NO_WINDOWS
    ? "o programa continua instalado: o desinstalador abre no fim (ou em configurações do Windows › aplicativos)."
    : "o programa continua instalado: <code>sudo apt remove kami</code> (.deb), <code>sudo dnf remove kami</code> (.rpm), <code>yay -R kami-bin</code> (AUR) ou apague o AppImage.";
  wrap.querySelector("#sm-remover-fica").innerHTML =
    (pasta ? `fica: a pasta extra das cópias, <code>${escapeHtml(pasta)}</code> — é a sua cópia fora deste computador. ` : "") + programa;
}

export function wireRemover(wrap, { exportar }) {
  const sec = wrap.querySelector("#sm-remover");
  if (!window.__TAURI__?.core?.invoke) return;
  sec.hidden = false;
  wrap.querySelector('.cfg-tab[data-tab="backup"]').addEventListener("click", () => renderOQueFica(wrap));
  renderOQueFica(wrap);

  const confirmInput = wrap.querySelector("#sm-remover-confirm");
  const btn = wrap.querySelector("#sm-remover-btn");
  confirmInput.addEventListener("input", () => {
    btn.disabled = confirmInput.value.trim().toLowerCase() !== REMOVER_WORD;
  });
  wrap.querySelector("#sm-remover-exportar").addEventListener("click", () => exportar());
  btn.addEventListener("click", () => removerTudo(wrap));
}

async function removerTudo(wrap) {
  if (estado.busy) return;
  const confirmInput = wrap.querySelector("#sm-remover-confirm");
  const btn = wrap.querySelector("#sm-remover-btn");
  if (confirmInput.value.trim().toLowerCase() !== REMOVER_WORD) return;
  const abrirDesinstalador = !!wrap.querySelector("#sm-remover-desinstalar")?.checked;

  const certeza = await showConfirmModal(
    "o kami vai apagar seus dados e tudo o que deixou neste computador e fechar. as cópias automáticas vão junto — só o backup exportado (e a pasta extra, se houver) fica. tem certeza?",
    { title: "remover o kami deste computador", confirmText: "sim, remover tudo", danger: true }
  );
  if (!certeza) return;

  estado.busy = true;
  confirmInput.disabled = true;
  btn.disabled = true;
  btn.textContent = "removendo...";
  try {
    await post("/api/sistema/remover-do-computador", { confirmation: REMOVER_WORD });
    // daqui o app fecha (e no Windows abre o desinstalador, se pedido)
    await window.__TAURI__.core.invoke("remover_tudo_do_computador", { abrirDesinstalador });
  } catch (err) {
    showErrorModal(String(err?.message || err), "não deu pra remover tudo");
    estado.busy = false;
    confirmInput.disabled = false;
    btn.disabled = false;
    btn.textContent = "remover tudo deste computador";
  }
}
