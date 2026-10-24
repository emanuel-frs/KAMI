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

export function buildNotificacoesPanel() {
  return `
    <div class="cfg-panel" data-panel="notificacoes">
      <div class="settings-section" style="padding-top:0;">
        <h4>tipos de notificação</h4>
        <p class="settings-desc">escolha o que aparece no sino de notificações (rodapé da sidebar). desmarcar um tipo some com ele por completo ali, incluindo do contador do sino.</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-notif-alerts" checked>
          ${icon("calendar-days", { size: 12 })}
          <span>vencendo em breve <small>contas fixas, dívidas, assinaturas e metas perto do prazo</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-notif-email" checked>
          ${icon("mail", { size: 12 })}
          <span>e-mails <small>mensagens não lidas das contas conectadas em organização</small></span>
        </label>
        <p class="settings-status" id="cfg-notif-status"></p>
      </div>
      <div class="settings-section">
        <h4>fora do kami</h4>
        <p class="settings-desc">o que também vira notificação do sistema (aquela que aparece no canto da tela mesmo com o kami em segundo plano). dentro do kami — aviso e sino — tudo continua aparecendo.</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-fora-lembretes" checked>
          ${icon("bell-ring", { size: 12 })}
          <span>lembretes <small>os que você criou (calendário, captura "@", botão "lembrar")</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-fora-vencimentos" checked>
          ${icon("receipt", { size: 12 })}
          <span>vencimentos <small>um aviso por dia com o que vence hoje e amanhã</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-fora-eventos" checked>
          ${icon("calendar-days", { size: 12 })}
          <span>eventos do calendário <small>o aviso "X min antes" de cada evento</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-ocultar-texto">
          ${icon("lock", { size: 12 })}
          <span>esconder o texto <small>a notificação diz só "abra o kami pra ver" — ela aparece até na tela de bloqueio. liga sozinho quando o PIN é ativado.</small></span>
        </label>
        <div class="cfg-linha-hora">
          <label for="cfg-avisos-hora">hora dos avisos de vencimento</label>
          <input type="time" id="cfg-avisos-hora" value="09:00">
        </div>
        <p class="settings-desc">lembretes e avisos só tocam com o kami aberto — ou na bandeja, se ligar abaixo.</p>
      </div>
      <div class="settings-section" id="cfg-janela-section" hidden>
        <h4>bandeja e início</h4>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-bandeja">
          ${icon("download", { size: 12 })}
          <span>manter na bandeja ao fechar <small>o ✕ esconde o kami em vez de sair; ele continua avisando. pra sair de vez: menu da bandeja › sair.</small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-iniciar">
          ${icon("zap", { size: 12 })}
          <span>iniciar com o sistema <small>com a bandeja ligada, começa escondido nela; sem ela, abre a janela.</small></span>
        </label>
        <p class="settings-desc" id="cfg-janela-gnome" hidden>no GNOME (Fedora, Ubuntu…) o ícone da bandeja só aparece com a extensão "AppIndicator and KStatusNotifierItem Support". sem ela o kami continua rodando escondido — abrir o kami de novo traz a janela de volta.</p>
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
      showErrorModal(err.message, "erro ao salvar preferências de notificação");
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
      showErrorModal(err.message, "erro ao salvar a hora dos avisos");
      return;
    }
    store.set("profile", { ...store.get("profile"), avisos_hora: valor });
    statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
    statusEl.classList.add("settings-status--visible");
  });

  const janelaStatus = wrap.querySelector("#cfg-janela-status");
  async function salvarJanela(campo, checkbox) {
    const invoke = invokeTauri();
    if (!invoke) return;
    try {
      await invoke("janela_definir", { campo, valor: checkbox.checked });
    } catch (err) {
      checkbox.checked = !checkbox.checked;
      showErrorModal(String(err), "erro ao salvar");
      return;
    }
    janelaStatus.innerHTML = `${icon("check", { size: 12 })} salvo`;
    janelaStatus.classList.add("settings-status--visible");
  }
  wrap.querySelector("#cfg-bandeja").addEventListener("change", (e) => salvarJanela("bandeja", e.target));
  wrap.querySelector("#cfg-iniciar").addEventListener("change", (e) => salvarJanela("iniciar_com_sistema", e.target));
}
