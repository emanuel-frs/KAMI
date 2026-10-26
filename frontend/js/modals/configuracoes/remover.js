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
import { t } from "../../i18n.js";

const REMOVER_WORD = "remover";
const NO_WINDOWS = /windows/i.test(navigator.userAgent);

export function removerSectionHtml() {
  return `
      <div class="settings-section settings-danger" id="sm-remover" hidden>
        <h4>${t("remover.remover_tudo_do_kami_deste")}</h4>
        <p class="settings-desc">${t("remover.desc", { onde: NO_WINDOWS ? t("remover.menu_iniciar") : t("remover.lancador") })}</p>
        <p class="settings-desc" id="sm-remover-fica"></p>
        ${
          NO_WINDOWS
            ? `<label class="cfg-toggle">
          <input type="checkbox" id="sm-remover-desinstalar" checked>
          <span>${t("remover.abrir_o_desinstalador_do_programa")}<small>${t("remover.o_mesmo_de_adicionar_ou")}</small></span>
        </label>`
            : ""
        }
        <div class="field">
          <label for="sm-remover-confirm">${t("geral.digite_pra_habilitar", { palavra: `<strong>${REMOVER_WORD}</strong>` })}</label>
          <input type="text" id="sm-remover-confirm" placeholder="${REMOVER_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm" id="sm-remover-exportar">${t("remover.exportar_um_backup_antes")}</button>
          <button class="btn sm danger" id="sm-remover-btn" disabled>${t("remover.remover_tudo_deste_computador")}</button>
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
    ? t("remover.o_programa_continua_instalado_o")
    : t("remover.programa_linux", { apt: "<code>sudo apt remove kami</code>", dnf: "<code>sudo dnf remove kami</code>", yay: "<code>yay -R kami-bin</code>" });
  wrap.querySelector("#sm-remover-fica").innerHTML =
    (pasta ? t("remover.fica_pasta", { pasta: `<code>${escapeHtml(pasta)}</code>` }) : "") + programa;
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
    t("remover.o_kami_vai_apagar_seus"),
    { title: t("remover.remover_o_kami_deste_computador"), confirmText: t("remover.sim_remover_tudo"), danger: true }
  );
  if (!certeza) return;

  estado.busy = true;
  confirmInput.disabled = true;
  btn.disabled = true;
  btn.textContent = t("remover.removendo");
  try {
    await post("/api/sistema/remover-do-computador", { confirmation: REMOVER_WORD });
    // daqui o app fecha (e no Windows abre o desinstalador, se pedido)
    await window.__TAURI__.core.invoke("remover_tudo_do_computador", { abrirDesinstalador });
  } catch (err) {
    showErrorModal(String(err?.message || err), t("remover.nao_deu_pra_remover_tudo"));
    estado.busy = false;
    confirmInput.disabled = false;
    btn.disabled = false;
    btn.textContent = t("remover.remover_tudo_deste_computador");
  }
}
