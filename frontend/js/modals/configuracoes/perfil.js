/**
 * Aba "perfil" das configurações: nome e avatar.
 * MAN-02: saiu de configuracoes-modal.js.
 */
import { updateProfile, updateAvatar } from "../../api/perfil.js";
import { showErrorModal } from "../err-modal.js";
import { openAvatarModal } from "../avatar-modal.js";
import { icon } from "../../components/icons.js";
import { fitAsciiText } from "../../components/ascii.js";
import { store } from "../../state/store.js";
import { openConfiguracoesModal, closeConfiguracoesModal } from "../configuracoes-modal.js";
import { estado } from "./estado.js";

export function buildPerfilPanel() {
  return `
    <div class="cfg-panel" data-panel="perfil">
      <div class="settings-section" style="padding-top:0;">
        <h4>avatar</h4>
        <p class="settings-desc">arte ascii feita a partir de uma imagem, usada na sidebar e no cartão de perfil.</p>
        <button type="button" class="pw-avatar-btn" id="cfg-avatar-btn" data-tooltip="editar avatar">
          <pre id="cfg-avatar-ascii" style="margin:0; white-space:pre; color:var(--accent);"></pre>
        </button>
      </div>
      <div class="settings-section">
        <h4>nome de exibição</h4>
        <p class="settings-desc">como a kami vai te chamar.</p>
        <div class="field">
          <input type="text" id="cfg-name-input" placeholder="como a kami vai te chamar">
        </div>
        <div class="form-actions">
          <button class="btn sm" id="cfg-name-save-btn">salvar</button>
        </div>
        <p class="settings-status" id="cfg-name-status"></p>
      </div>
    </div>`;
}

// ── aba perfil ───────────────────────────────────────────────────────
// (mesmo padrão da aba aparência: os dados atuais só são conhecidos
// depois de buscar o perfil, então o preenchimento de verdade acontece
// em renderPerfilTab(), chamada em openConfiguracoesModal() — wirePerfilTab()
// aqui embaixo só liga os listeners, que não dependem do profile ainda
// carregado.)
export function renderPerfilTab(wrap, profile) {
  const nameInput = wrap.querySelector("#cfg-name-input");
  nameInput.value = profile.display_name;
  nameInput.dataset.savedValue = profile.display_name;

  const avatarPre = wrap.querySelector("#cfg-avatar-ascii");
  avatarPre.textContent = profile.avatar_ascii ?? "sem avatar\nainda";
  try {
    fitAsciiText(avatarPre, profile.avatar_ascii ?? "sem avatar\nainda", {
      container: avatarPre.parentElement,
      maxHeight: 136,
      maxFont: 8,
      paddingX: 10,
      paddingY: 10,
    });
  } catch (err) {
    console.error("fitAsciiText falhou no avatar (aba perfil):", err);
  }
}

function applySidebarAvatar(ascii) {
  const el = document.getElementById("sidebar-avatar");
  if (!el) return;
  el.textContent = ascii;
  try {
    fitAsciiText(el, ascii, {
      container: el.parentElement,
      maxHeight: 25,
      maxFont: 3,
      minFont: 1,
      paddingX: 8,
      paddingY: 4,
    });
  } catch (_) {
    // ajuste de tamanho do ASCII é só cosmético — se falhar, o texto
    // fica no tamanho padrão (CONF-01: silêncio de propósito)
  }
}

export function wirePerfilTab(wrap) {
  wrap.querySelector("#cfg-avatar-btn").addEventListener("click", () => {
    const avatarPre = wrap.querySelector("#cfg-avatar-ascii");

    // fecha Configurações antes de abrir o avatar (e reabre quando ele
    // fechar) — os dois usam o mesmo padrão de modal singleton
    // (.modal-backdrop, z-index igual, ordem no DOM decide quem fica
    // por cima — ver modal-escape.js), então mantê-los abertos ao
    // mesmo tempo empilhava errado (avatar podia renderizar atrás de
    // Configurações, dependendo de qual foi construído/aberto
    // primeiro na sessão). Só esse caminho fecha/reabre Configurações;
    // o atalho do avatar no widget de perfil (widgets/profile.js) não
    // passa onClose e continua abrindo/fechando normalmente, sozinho.
    closeConfiguracoesModal();
    openAvatarModal({
      currentAscii: avatarPre.textContent,
      onClose: () => openConfiguracoesModal("perfil"),
      onSave: async (ascii) => {
        try {
          await updateAvatar(ascii);
        } catch (err) {
          showErrorModal(err.message, "erro ao salvar avatar");
          return;
        }
        avatarPre.textContent = ascii;
        try {
          fitAsciiText(avatarPre, ascii, {
            container: avatarPre.parentElement,
            maxHeight: 136,
            maxFont: 8,
            paddingX: 10,
            paddingY: 10,
          });
        } catch (err) {
          console.error("fitAsciiText falhou no avatar (aba perfil):", err);
        }
        applySidebarAvatar(ascii);
        // propaga pro store — widget de perfil (e qualquer outro
        // inscrito) se atualiza sozinho, sem precisar de reload.
        store.set("profile", { ...store.get("profile"), avatar_ascii: ascii });
      },
    });
  });

  const nameInput = wrap.querySelector("#cfg-name-input");
  const saveBtn = wrap.querySelector("#cfg-name-save-btn");
  const statusEl = wrap.querySelector("#cfg-name-status");

  saveBtn.addEventListener("click", async () => {
    if (estado.busy) return;
    const newName = nameInput.value.trim() || "usuário";
    statusEl.textContent = "";
    statusEl.classList.remove("settings-status--visible");

    try {
      await updateProfile({ display_name: newName });
    } catch (err) {
      showErrorModal(err.message, "erro ao salvar nome");
      return;
    }

    nameInput.value = newName;
    nameInput.dataset.savedValue = newName;
    const tagline = document.getElementById("sidebar-tagline");
    if (tagline) tagline.textContent = newName;

    // propaga pro store — widget de perfil (e a sidebar, via
    // applyProfileToSidebar em app.js) se atualizam sozinhos.
    store.set("profile", { ...store.get("profile"), display_name: newName });

    statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
    statusEl.classList.add("settings-status--visible");
  });
}
