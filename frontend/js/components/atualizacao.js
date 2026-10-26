import { store } from "../state/store.js";
import { updateProfile } from "../api/perfil.js";
import { post } from "../api/client.js";
import { showToast } from "./toast.js";
import { openExternal } from "./open-external.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { t } from "../i18n.js";

/**
 * components/atualizacao.js — aviso de versão nova (DIST-01, P-75).
 *
 * O kami SÓ AVISA: nada é baixado nem instalado sem a pessoa pedir.
 *   - procura ao abrir (1 min depois, sem disputar com a abertura) e uma
 *     vez por dia com o app aberto — e só com "procurar atualizações"
 *     ligado em configurações › sobre (P-88: ligado por padrão). Desligado,
 *     nenhuma requisição sai (quem consulta é o Rust, e só quando chamado
 *     daqui — src-tauri/src/atualizacao.rs);
 *   - achou: entra no sino. O badge conta a versão UMA vez (abrir o sino
 *     marca `atualizacao_avisada`) — o aviso não insiste; "pular esta
 *     versão" tira do sino; configurações › sobre mostra sempre;
 *   - "atualizar agora" (Windows e AppImage): confirma, faz a cópia
 *     `kami-antes-de-atualizar` (P-90), baixa com o progresso num aviso e
 *     instala. `.deb`/`.rpm`/AUR: só o aviso e a página da versão — o
 *     gerenciador de pacotes do sistema é quem atualiza.
 *
 * Fora do app instalado (navegador de dev) nada disso existe.
 */

const PRIMEIRA = 60 * 1000;
const INTERVALO = 24 * 60 * 60 * 1000;
const RELEASES = "https://github.com/emanuel-frs/KAMI/releases";
const NO_WINDOWS = /windows/i.test(navigator.userAgent);

let disponivel = null; // { versao, atual, notas, data, instalavel }
let ultimaConsulta = null; // Date da última consulta que respondeu
let timer = null;
let instalando = false;

const invoke = (cmd) => window.__TAURI__.core.invoke(cmd);
export const temAtualizador = () => !!window.__TAURI__?.core?.invoke;
const ligado = () => store.get("profile")?.atualizacoes_procurar !== false;

function avisarMudou() {
  window.dispatchEvent(new CustomEvent("kami:atualizacao"));
}

export function estadoAtualizacao() {
  return { disponivel, ultimaConsulta, ligado: ligado(), instalando };
}

/** Consulta agora. Devolve a versão nova (ou null); erro sobe pra quem chamou. */
export async function procurarAgora() {
  disponivel = await invoke("atualizacao_procurar");
  ultimaConsulta = new Date();
  avisarMudou();
  return disponivel;
}

/** A consulta automática (exportada pro teste): desligado, não sai nada. */
export async function rodada() {
  if (!ligado()) return;
  try {
    await procurarAgora();
  } catch {
    // sem internet, GitHub fora... normal — tenta na próxima rodada
  }
}

export function iniciarAtualizacoes() {
  if (timer || !temAtualizador()) return;
  timer = setTimeout(function proxima() {
    rodada();
    timer = setTimeout(proxima, INTERVALO);
  }, PRIMEIRA);
}

// ── sino ───────────────────────────────────────────────────────────────

/** Função pura (testada): a versão entra no sino? e conta no badge? */
export function situacaoNoSino(versao, { atualizacao_avisada, atualizacao_pulada } = {}) {
  if (!versao || versao === atualizacao_pulada) return { mostrar: false, contar: false };
  return { mostrar: true, contar: versao !== atualizacao_avisada };
}

export function noSino() {
  return situacaoNoSino(disponivel?.versao, store.get("profile") || {});
}

async function salvarPerfil(campos) {
  const perfil = await updateProfile(campos);
  store.set("profile", perfil);
}

/** O sino abriu com a versão nova à vista: ela já não conta mais no badge. */
export async function marcarAvisada() {
  if (!noSino().contar) return;
  try {
    await salvarPerfil({ atualizacao_avisada: disponivel.versao });
  } catch {
    /* conta de novo na próxima — sem prejuízo */
  }
}

export async function pularVersao() {
  if (!disponivel) return;
  await salvarPerfil({ atualizacao_pulada: disponivel.versao });
  avisarMudou();
}

export async function definirProcurar(valor) {
  await salvarPerfil({ atualizacoes_procurar: valor });
  if (!valor) disponivel = null;
  avisarMudou();
}

export function verNovidades(versao = disponivel?.versao) {
  openExternal(versao ? `${RELEASES}/tag/v${versao}` : RELEASES);
}

/** Texto curto de como essa instalação é atualizada (sino e sobre). */
export function comoAtualiza(d = disponivel) {
  if (!d) return "";
  if (d.instalavel) return NO_WINDOWS ? t("atualizacao.o_kami_baixa_instala_e") : t("atualizacao.o_kami_troca_o_appimage");
  return t("atualizacao.esta_instalacao_e_atualizada_pelo");
}

// ── instalar ───────────────────────────────────────────────────────────

export async function atualizarAgora() {
  if (!disponivel?.instalavel || instalando) return;
  const { versao } = disponivel;
  const ok = await showConfirmModal(
    t("atualizacao.confirmar", { versao }) + (NO_WINDOWS ? ` ${t("atualizacao.o_windows_pode_mostrar_o")}` : ""),
    { title: t("atualizacao.atualizar_para", { versao }), confirmText: t("atualizacao.atualizar_agora") }
  );
  if (!ok) return;

  instalando = true;
  avisarMudou();
  let fecharAviso = null;
  let msgEl = null;
  try {
    await post("/api/backups/antes-de-atualizar", {});
    fecharAviso = showToast({
      title: t("atualizacao.baixando", { versao }),
      message: "0%",
      iconName: "download",
      duration: 0,
      sound: false,
    });
    msgEl = [...document.querySelectorAll(".toast-item")].pop()?.querySelector(".toast-message");
    const parar = await window.__TAURI__.event.listen("kami://atualizacao-progresso", ({ payload }) => {
      if (!msgEl) return;
      const { baixado, total } = payload;
      msgEl.textContent = total ? `${Math.min(100, Math.round((baixado / total) * 100))}%` : `${(baixado / 1048576).toFixed(1)} MB`;
    });
    try {
      // daqui o app fecha e reabre na versão nova (no Windows, pelo instalador)
      await invoke("atualizacao_instalar");
    } finally {
      parar();
    }
  } catch (err) {
    fecharAviso?.();
    instalando = false;
    avisarMudou();
    showErrorModal(String(err?.message || err), t("atualizacao.nao_deu_pra_atualizar"));
  }
}
