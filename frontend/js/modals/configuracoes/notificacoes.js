/**
 * Aba "notificações" das configurações: avisos dentro e fora do app,
 * hora dos vencimentos e janela (bandeja, iniciar com o sistema — ORG-05).
 * MAN-02: saiu de configuracoes-modal.js.
 */
import { updateProfile } from "../../api/perfil.js";
import { showErrorModal } from "../err-modal.js";
import { icon } from "../../components/icons.js";
import { store } from "../../state/store.js";
import { estado } from "./estado.js";
import { configAvisos, definirRegraAviso, voltarAAvisar } from "../../api/avisos.js";
import { checarAvisos } from "../../components/avisos.js";
import { escapeHtml } from "../../components/format.js";
import { t } from "../../i18n.js";

// IA-06: mesma ordem de app/avisos.py::REGRAS
const REGRAS_AVISO = ["categoria_acima", "conta_sem_saldo", "meta_parada", "atributo_esquecido", "trilha_parada"];

export function buildNotificacoesPanel() {
  return `
    <div class="cfg-panel" data-panel="notificacoes">
      <div class="settings-section" style="padding-top:0;">
        <h4>${t("notificacoes.tipos_de_notificacao")}</h4>
        <p class="settings-desc">${t("notificacoes.escolha_o_que_aparece_no")}</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-notif-alerts" checked>
          ${icon("calendar-days", { size: 12 })}
          <span>${t("notificacoes.vencendo_em_breve")} <small>${t("notificacoes.contas_fixas_dividas_assinaturas_e")}</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-notif-email" checked>
          ${icon("mail", { size: 12 })}
          <span>${t("notificacoes.e_mails")} <small>${t("notificacoes.mensagens_nao_lidas_das_contas")}</small></span>
        </label>
        <p class="settings-status" id="cfg-notif-status"></p>
      </div>
      <div class="settings-section" id="cfg-avisos-section">
        <h4>${t("avisos.config.titulo")}</h4>
        <p class="settings-desc">${t("avisos.config.desc")}</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-avisos-todos" checked>
          ${icon("triangle-alert", { size: 12 })}
          <span>${t("avisos.config.ligados")}</span>
        </label>
        <div class="cfg-avisos-regras" id="cfg-avisos-regras">
          ${REGRAS_AVISO.map((r) => `
          <label class="cfg-toggle cfg-sub">
            <input type="checkbox" data-regra-aviso="${r}" checked>
            <span>${t(`avisos.regra.${r}`)} <small>${t(`avisos.regra.${r}_desc`)}</small></span>
          </label>`).join("")}
        </div>
        <h4 class="cfg-avisos-sil-titulo">${t("avisos.config.silenciados")}</h4>
        <div class="cfg-avisos-silenciados" id="cfg-avisos-silenciados"></div>
        <p class="settings-status" id="cfg-avisos-status"></p>
      </div>
      <div class="settings-section">
        <h4>${t("notificacoes.fora_do_kami")}</h4>
        <p class="settings-desc">${t("notificacoes.o_que_tambem_vira_notificacao")}</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-fora-lembretes" checked>
          ${icon("bell-ring", { size: 12 })}
          <span>${t("notificacoes.lembretes")} <small>${t("notificacoes.os_que_voce_criou_calendario")}</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-fora-vencimentos" checked>
          ${icon("receipt", { size: 12 })}
          <span>${t("notificacoes.vencimentos")} <small>${t("notificacoes.um_aviso_por_dia_com")}</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-fora-eventos" checked>
          ${icon("calendar-days", { size: 12 })}
          <span>${t("notificacoes.eventos_do_calendario")} <small>${t("notificacoes.o_aviso_x_min_antes")}</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-ocultar-texto">
          ${icon("lock", { size: 12 })}
          <span>${t("notificacoes.esconder_o_texto")} <small>${t("notificacoes.a_notificacao_diz_so_abra")}</small></span>
        </label>
        <div class="cfg-linha-hora">
          <label for="cfg-avisos-hora">${t("notificacoes.hora_dos_avisos_de_vencimento")}</label>
          <input type="time" id="cfg-avisos-hora" value="09:00">
        </div>
        <p class="settings-desc">${t("notificacoes.lembretes_e_avisos_so_tocam")}</p>
      </div>
      <div class="settings-section" id="cfg-janela-section" hidden>
        <h4>${t("notificacoes.bandeja_e_inicio")}</h4>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-bandeja">
          ${icon("download", { size: 12 })}
          <span>${t("notificacoes.manter_na_bandeja_ao_fechar")} <small>${t("notificacoes.o_esconde_o_kami_em")}</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-iniciar">
          ${icon("zap", { size: 12 })}
          <span>${t("notificacoes.iniciar_com_o_sistema")} <small>${t("notificacoes.com_a_bandeja_ligada_comeca")}</small></span>
        </label>
        <p class="settings-desc" id="cfg-janela-gnome" hidden>${t("notificacoes.no_gnome_fedora_ubuntu_o")}</p>
        <p class="settings-status" id="cfg-janela-status"></p>
      </div>
    </div>`;
}

// ── aba notificações ─────────────────────────────────────────────────
// (mesmo padrão da aba aparência: estado atual só é conhecido depois
// de buscar o perfil, então o preenchimento de verdade acontece em
// renderNotificacoesTab(), chamada em openConfiguracoesModal() —
// wireNotificacoesTab() aqui embaixo só liga os listeners, que já
// aplicam e persistem na hora, sem botão "salvar".)
export function renderNotificacoesTab(wrap, profile) {
  wrap.querySelector("#cfg-notif-alerts").checked = profile.notif_alerts_enabled !== false;
  wrap.querySelector("#cfg-notif-email").checked = profile.notif_email_enabled !== false;
  // ORG-05
  wrap.querySelector("#cfg-fora-lembretes").checked = profile.notif_fora_lembretes !== false;
  wrap.querySelector("#cfg-fora-vencimentos").checked = profile.notif_fora_vencimentos !== false;
  wrap.querySelector("#cfg-fora-eventos").checked = profile.notif_fora_eventos !== false;
  wrap.querySelector("#cfg-ocultar-texto").checked = !!profile.notif_ocultar_texto;
  wrap.querySelector("#cfg-avisos-hora").value = profile.avisos_hora || "09:00";
  renderJanela(wrap);
  configAvisos().then((cfg) => renderAvisosConfig(wrap, cfg)).catch(() => (wrap.querySelector("#cfg-avisos-section").hidden = true));
}

// ── IA-06: avisos do kami (P-140: tudo ou por regra; P-147: silenciados) ──
function renderAvisosConfig(wrap, cfg) {
  wrap.querySelector("#cfg-avisos-section").hidden = false;
  wrap.querySelector("#cfg-avisos-todos").checked = cfg.ligados;
  wrap.querySelectorAll("[data-regra-aviso]").forEach((el) => {
    el.checked = cfg.regras[el.dataset.regraAviso] !== false;
    el.disabled = !cfg.ligados;
  });
  const lista = wrap.querySelector("#cfg-avisos-silenciados");
  lista.innerHTML = cfg.silenciados.length
    ? cfg.silenciados
        .map((s) => `
      <div class="cfg-aviso-sil">
        <span class="cfg-aviso-sil-nome">${escapeHtml(s.regra === "atributo_esquecido" ? t(`atributo.${s.nome}`) : s.nome || "—")} <small>${t(`avisos.regra.${s.regra}`)}</small></span>
        <button type="button" class="btn sm" data-voltar-aviso="${escapeHtml(s.regra)}" data-alvo="${escapeHtml(s.alvo_id)}">${t("avisos.config.voltar_a_avisar")}</button>
      </div>`)
        .join("")
    : `<p class="settings-desc">${t("avisos.config.nenhum_silenciado")}</p>`;
}

// ── ORG-05: bandeja e iniciar com o sistema (lado Rust: src-tauri/src/janela.rs).
// Ficam num arquivo da máquina (não no banco/backup): levar o backup pra
// outro computador não liga o início automático de lá.
function invokeTauri() {
  return window.__TAURI__?.core?.invoke ?? null;
}

async function renderJanela(wrap) {
  const invoke = invokeTauri();
  const section = wrap.querySelector("#cfg-janela-section");
  if (!invoke) {
    section.hidden = true; // navegador (dev): não tem bandeja
    return;
  }
  try {
    const prefs = await invoke("janela_preferencias");
    wrap.querySelector("#cfg-bandeja").checked = !!prefs.bandeja;
    wrap.querySelector("#cfg-iniciar").checked = !!prefs.iniciar_com_sistema;
    wrap.querySelector("#cfg-janela-gnome").hidden = !/linux/i.test(navigator.userAgent);
    section.hidden = false;
  } catch (err) {
    console.error("configurações: preferências da janela indisponíveis", err);
    section.hidden = true;
  }
}

export function wireNotificacoesTab(wrap) {
  const statusEl = wrap.querySelector("#cfg-notif-status");

  async function onToggle(field, checkbox) {
    if (estado.busy) return;
    const value = checkbox.checked;
    statusEl.textContent = "";
    statusEl.classList.remove("settings-status--visible");

    try {
      await updateProfile({ [field]: value });
    } catch (err) {
      checkbox.checked = !value; // desfaz o toggle otimista — a chamada falhou
      showErrorModal(err.message, t("notificacoes.erro_ao_salvar_preferencias_de"));
      return;
    }

    // propaga pro store — o modal de notificações e o badge do sino
    // (components/notification-bell.js) leem store.get("profile") toda
    // vez que precisam decidir o que mostrar, então já refletem o novo
    // valor sem precisar de reload.
    store.set("profile", { ...store.get("profile"), [field]: value });

    statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
    statusEl.classList.add("settings-status--visible");
  }

  wrap.querySelector("#cfg-notif-alerts").addEventListener("change", (e) => onToggle("notif_alerts_enabled", e.target));
  wrap.querySelector("#cfg-notif-email").addEventListener("change", (e) => onToggle("notif_email_enabled", e.target));
  // ORG-05
  wrap.querySelector("#cfg-fora-lembretes").addEventListener("change", (e) => onToggle("notif_fora_lembretes", e.target));
  wrap.querySelector("#cfg-fora-vencimentos").addEventListener("change", (e) => onToggle("notif_fora_vencimentos", e.target));
  wrap.querySelector("#cfg-fora-eventos").addEventListener("change", (e) => onToggle("notif_fora_eventos", e.target));
  wrap.querySelector("#cfg-ocultar-texto").addEventListener("change", (e) => onToggle("notif_ocultar_texto", e.target));
  wrap.querySelector("#cfg-avisos-hora").addEventListener("change", async (e) => {
    const valor = e.target.value;
    if (!/^\d{2}:\d{2}$/.test(valor)) return;
    try {
      await updateProfile({ avisos_hora: valor });
    } catch (err) {
      showErrorModal(err.message, t("notificacoes.erro_ao_salvar_a_hora"));
      return;
    }
    store.set("profile", { ...store.get("profile"), avisos_hora: valor });
    statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
    statusEl.classList.add("settings-status--visible");
  });

  // IA-06
  const avisosStatus = wrap.querySelector("#cfg-avisos-status");
  async function salvarAvisos(chamada, desfazer) {
    let cfg;
    try {
      cfg = await chamada();
    } catch (err) {
      desfazer?.();
      showErrorModal(err.message, t("notificacoes.erro_ao_salvar"));
      return;
    }
    renderAvisosConfig(wrap, cfg);
    checarAvisos(); // o sino reflete na hora
    avisosStatus.innerHTML = `${icon("check", { size: 12 })} salvo`;
    avisosStatus.classList.add("settings-status--visible");
  }
  wrap.querySelector("#cfg-avisos-todos").addEventListener("change", (e) =>
    salvarAvisos(() => definirRegraAviso("*", e.target.checked), () => (e.target.checked = !e.target.checked)),
  );
  wrap.querySelector("#cfg-avisos-regras").addEventListener("change", (e) => {
    const regra = e.target.dataset.regraAviso;
    if (regra) salvarAvisos(() => definirRegraAviso(regra, e.target.checked), () => (e.target.checked = !e.target.checked));
  });
  wrap.querySelector("#cfg-avisos-silenciados").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-voltar-aviso]");
    if (btn) salvarAvisos(() => voltarAAvisar(btn.dataset.voltarAviso, btn.dataset.alvo));
  });

  const janelaStatus = wrap.querySelector("#cfg-janela-status");
  async function salvarJanela(campo, checkbox) {
    const invoke = invokeTauri();
    if (!invoke) return;
    try {
      await invoke("janela_definir", { campo, valor: checkbox.checked });
    } catch (err) {
      checkbox.checked = !checkbox.checked;
      showErrorModal(String(err), t("notificacoes.erro_ao_salvar"));
      return;
    }
    janelaStatus.innerHTML = `${icon("check", { size: 12 })} salvo`;
    janelaStatus.classList.add("settings-status--visible");
  }
  wrap.querySelector("#cfg-bandeja").addEventListener("change", (e) => salvarJanela("bandeja", e.target));
  wrap.querySelector("#cfg-iniciar").addEventListener("change", (e) => salvarJanela("iniciar_com_sistema", e.target));
}
