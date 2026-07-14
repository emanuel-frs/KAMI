import { getProfile, updateProfile, updateAvatar } from "../api/perfil.js";
import { getAttributes, getAchievements } from "../api/nucleo.js";
import { levelFromXp } from "./xp.js";
import { escapeHtml } from "./format.js";
import { fitAsciiText } from "./ascii.js";
import { openAvatarModal } from "./avatar-modal.js";

/**
 * Widget de perfil (decisão 15 + 17) — não-removível, único widget da
 * tela Perfil que combina identidade (nome/cor/avatar) com resumo de
 * progresso (nível/xp/conquistas, vindos do núcleo). Toggle view/edit
 * inline pra nome/cor usando o mecanismo genérico de widgets.css:
 *   .card[data-editable] .edit-mode      { display:none }
 *   .card[data-editable].editing .view-mode { display:none }
 *   .card[data-editable].editing .edit-mode { display:block }
 *
 * Edição de AVATAR é diferente: por convenção do app (decisão 18, que
 * cita "editar o avatar" como exemplo explícito) isso abre um MODAL
 * dedicado (avatar-modal.js, ascii-lab portado do protótipo) em vez de
 * virar inputs dentro do card.
 *
 * Este card é fixo (data-pinned, ver widgets.css) — sempre primeiro
 * (posição 1/1) e não arrastável, já que não faz sentido reordenar o
 * único widget de identidade da tela.
 */

const ACCENT_OPTIONS = [
  { value: "#8fbf8f", label: "verde fósforo (padrão)" },
  { value: "#b3a06a", label: "âmbar" },
  { value: "#8fa8bf", label: "azul acinzentado" },
  { value: "#b06060", label: "vermelho fosco" },
  { value: "#c9c9c9", label: "cinza claro (mono puro)" },
  { value: "#c9a0dc", label: "lilás" },
  { value: "#e0c15a", label: "dourado" },
  { value: "#5ac8c8", label: "turquesa" },
  { value: "#e08fa0", label: "coral" },
];

function accentLabel(hex) {
  return ACCENT_OPTIONS.find((o) => o.value === hex)?.label ?? hex;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando perfil…</div>';

  const cardEl = el.closest(".card");
  cardEl?.setAttribute("data-editable", "");
  cardEl?.setAttribute("data-pinned", ""); // sempre 1/1, não arrastável (ver widgets.css)

  let profile, attributes, achievements;
  try {
    [profile, attributes, achievements] = await Promise.all([
      getProfile(),
      getAttributes(),
      getAchievements(),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">erro ao carregar perfil: ${err.message}</div>`;
    return;
  }

  const totalXp = attributes.reduce((sum, a) => sum + a.current_xp, 0);
  const { level } = levelFromXp(totalXp);
  const unlockedCount = achievements.filter((a) => a.unlocked_at).length;
  const top = [...attributes].sort((a, b) => b.current_xp - a.current_xp)[0];

  el.innerHTML = `
    <div class="view-mode">
      <button type="button" class="pw-avatar-btn" title="editar avatar">
        <pre id="pw-avatar-ascii" style="margin:0; white-space:pre; color:var(--accent);">${escapeHtml(profile.avatar_ascii ?? "sem avatar\nainda")}</pre>
      </button>
      <div style="flex:1 1 200px; min-width:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <b style="color:var(--text-bright); font-size:15px;">${escapeHtml(profile.display_name)}</b>
          <button type="button" class="btn sm mode-toggle-btn" data-action="edit">✎ editar nome/cor</button>
        </div>
        <div style="display:flex; align-items:center; gap:6px; margin-top:4px; font-size:11px; color:var(--text-dim);">
          <span style="width:11px; height:11px; background:${profile.accent_color}; display:inline-block; border:1px solid var(--border-soft);"></span>
          <span>${escapeHtml(accentLabel(profile.accent_color))}</span>
        </div>
        <div style="display:flex; gap:20px; margin-top:14px; flex-wrap:wrap;">
          <div class="vm-row"><span class="k">nível</span><span class="v">${level}</span></div>
          <div class="vm-row"><span class="k">xp total</span><span class="v">${totalXp.toLocaleString("pt-BR")}</span></div>
          <div class="vm-row"><span class="k">conquistas</span><span class="v">${unlockedCount}/${achievements.length}</span></div>
          <div class="vm-row"><span class="k">destaque</span><span class="v">${top ? escapeHtml(top.name) : "—"}</span></div>
        </div>
      </div>
    </div>

    <div class="edit-mode">
      <button type="button" class="pw-avatar-btn" title="editar avatar" data-action="avatar-edit">
        <pre class="pw-avatar-ascii-el" style="margin:0; white-space:pre; color:var(--accent);">${escapeHtml(profile.avatar_ascii ?? "sem avatar\nainda")}</pre>
      </button>
      <div style="flex:1 1 200px; min-width:0;">
        <div class="field">
          <label>nome de exibição</label>
          <input type="text" id="pw-name-input" placeholder="como a kami vai te chamar" value="${escapeHtml(profile.display_name)}">
        </div>
        <div class="field">
          <label>cor de destaque</label>
          <select id="pw-accent-input">
            ${ACCENT_OPTIONS.map(
              (o) => `<option value="${o.value}" ${o.value === profile.accent_color ? "selected" : ""}>${o.label}</option>`
            ).join("")}
          </select>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn primary" data-action="save">salvar</button>
          <button type="button" class="btn sm" data-action="cancel">cancelar</button>
        </div>
        <div id="pw-save-msg" style="font-size:10px; color:var(--accent); margin-top:8px; display:none;">salvo ✓</div>
      </div>
    </div>
  `;

  // ── avatar: anexa o clique JÁ AQUI, antes de qualquer coisa que possa
  //    lançar erro (fitAsciiText, cálculo de grid, etc.). Antes esse
  //    listener era o ÚLTIMO a ser anexado — se algo antes dele
  //    lançasse uma exceção não capturada, o resto da função parava e
  //    o botão do avatar ficava com a aparência normal mas sem clique
  //    nenhum funcionando (o card já tinha sido inserido no DOM antes
  //    da falha). Abre modal dedicado (decisão 18), nunca inline. ──
  el.querySelectorAll(".pw-avatar-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openAvatarModal({
        currentAscii: profile.avatar_ascii,
        onSave: async (ascii) => {
          await updateAvatar(ascii);
          render(el, widget);
        },
      });
    });
  });

  el.querySelectorAll(".pw-avatar-ascii-el").forEach((avatarPre) => {
    try {
      fitAsciiText(avatarPre, profile.avatar_ascii ?? "sem avatar\nainda", {
        container: avatarPre.parentElement,
        maxHeight: 136,
        maxFont: 8,
        paddingX: 10,
        paddingY: 10,
      });
    } catch (err) {
      console.error("fitAsciiText falhou no avatar do perfil:", err);
    }
  });

  // ── ajusta o tamanho do mini-avatar ao box maior (ver widgets.css .pw-avatar-btn) ──
  // try/catch: uma falha de medição aqui (ex: canvas indisponível, layout
  // ainda não computado) não pode impedir os listeners abaixo de anexar.
  const avatarPre = el.querySelector("#pw-avatar-ascii");
  try {
    fitAsciiText(avatarPre, profile.avatar_ascii ?? "sem avatar\nainda", {
      container: avatarPre.parentElement,
      maxHeight: 136, // acompanha o box maior do avatar (148x148, ver widgets.css .pw-avatar-btn)
      maxFont: 8,
      paddingX: 10,
      paddingY: 10,
    });
  } catch (err) {
    console.error("fitAsciiText falhou no avatar do perfil:", err);
  }

  // ── grid: garante altura suficiente pro modo de edição não cortar
  //    inputs/botões. cardEl.scrollHeight já reflete o conteúdo real
  //    (mesmo que o grid tenha reservado menos linhas originalmente);
  //    guardamos o valor original pra restaurar ao sair da edição. ──
  let originalRowEnd = null;
  let originalHeight = null;

  function growCardToFitContent() {
    if (!cardEl) return;
    cardEl.style.height = "";
    requestAnimationFrame(() => {
      const rowSpan = Math.max(1, Math.ceil((cardEl.scrollHeight + 16) / (8 + 16))) + 1;
      cardEl.style.gridRowEnd = `span ${rowSpan}`;
    });
  }
  function restoreCardHeight() {
    if (!cardEl) return;
    if (originalRowEnd !== null) cardEl.style.gridRowEnd = originalRowEnd;
    else cardEl.style.removeProperty("grid-row-end");
    if (originalHeight !== null) cardEl.style.height = originalHeight;
    else cardEl.style.removeProperty("height");
  }

  // ── toggle view/edit (nome/cor) ──────────────────────────────────────
  el.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
    originalRowEnd = cardEl?.style.gridRowEnd || null;
    originalHeight = cardEl?.style.height || null;
    cardEl?.classList.add("editing");
    growCardToFitContent();

    // o avatar do modo de edição foi medido em render() enquanto
    // .edit-mode ainda estava display:none (container com clientWidth 0
    // nesse momento) — o font-size calculado ali não reflete o box real.
    // Agora que a classe .editing tornou o painel visível, remede.
    const editAvatarPre = el.querySelector(".pw-avatar-ascii-el");
    if (editAvatarPre) {
      try {
        fitAsciiText(editAvatarPre, profile.avatar_ascii ?? "sem avatar\nainda", {
          container: editAvatarPre.parentElement,
          maxHeight: 136,
          maxFont: 8,
          paddingX: 10,
          paddingY: 10,
        });
      } catch (err) {
        console.error("fitAsciiText falhou no avatar (modo edição):", err);
      }
    }
  });
  el.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
    cardEl?.classList.remove("editing");
    restoreCardHeight();
  });

  // ── salvar nome/cor ──────────────────────────────────────────────────
  el.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
    const nameInput = el.querySelector("#pw-name-input");
    const accentInput = el.querySelector("#pw-accent-input");
    const saveMsg = el.querySelector("#pw-save-msg");

    const newName = nameInput.value.trim() || "usuário";
    const newAccent = accentInput.value;

    try {
      await updateProfile({ display_name: newName, accent_color: newAccent });
    } catch (err) {
      alert(`erro ao salvar perfil: ${err.message}`);
      return;
    }

    // aplica a cor de destaque globalmente, igual o boot faz em app.js
    document.documentElement.style.setProperty("--accent", newAccent);
    const tagline = document.getElementById("sidebar-tagline");
    if (tagline) tagline.textContent = newName;

    saveMsg.style.display = "block";
    setTimeout(() => {
      cardEl?.classList.remove("editing");
      restoreCardHeight();
      render(el, widget); // recarrega o widget com os dados atualizados
    }, 500);
  });
}