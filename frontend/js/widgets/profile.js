import { getProfile, updateAvatar } from "../api/perfil.js";
import { getAttributes, getAchievements } from "../api/nucleo.js";
import { levelFromXp } from "../components/xp.js";
import { escapeHtml } from "../components/format.js";
import { fitAsciiText } from "../components/ascii.js";
import { icon } from "../components/icons.js";
import { openConfiguracoesModal } from "../modals/configuracoes-modal.js";
import { openAvatarModal } from "../modals/avatar-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { store } from "../state/store.js";

/**
 * Widget de perfil (decisão 15 + 17) — não-removível, único widget da
 * tela Perfil que combina identidade (nome/avatar) com resumo de
 * progresso (nível/xp/conquistas, vindos do núcleo).
 *
 * Somente leitura (conforme configuracoes_plano.md): não tem mais
 * toggle view/edit inline nem inputs de nome/cor — isso agora vive só
 * na aba Perfil do modal de Configurações. O botão no canto do card
 * abre esse modal (já na aba perfil).
 *
 * O avatar em si tem um atalho próprio: clicar nele abre direto o
 * modal de avatar (avatar-modal.js) — mesmo modal usado na aba perfil
 * de configurações e no avatar da sidebar (decisão 18: um modal só) —
 * em vez de precisar passar pela tela de configurações primeiro.
 * Cor de destaque não aparece mais aqui — isso é aba Aparência.
 *
 * Este card é fixo (data-pinned, ver widgets.css) — sempre primeiro
 * (posição 1/1) e não arrastável, já que não faz sentido reordenar o
 * único widget de identidade da tela.
 *
 * Fica inscrito em store.subscribe("profile") pra se manter em sync
 * automaticamente sempre que o perfil mudar por qualquer outro
 * caminho (nome/avatar salvos na aba perfil de configurações, avatar
 * da sidebar, onboarding etc.) — sem isso, o card ficava com dados
 * velhos até a próxima navegação/reload. Reassina a cada render()
 * (desinscrevendo a anterior primeiro) pra não acumular listeners
 * quando o widget é remontado.
 */

let unsubscribeProfile = null;

export async function render(el, widget) {
  unsubscribeProfile?.();
  unsubscribeProfile = null;

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

  // Métrica cosmética de "nível médio combinado" do perfil: soma o XP de
  // TODOS os atributos e passa pela mesma curva de levelFromXp usada por
  // atributo individual — não tem pretensão de bater com o nível de
  // nenhum atributo específico, é só um número único pra exibir aqui.
  const totalXp = attributes.reduce((sum, a) => sum + a.current_xp, 0);
  const { level } = levelFromXp(totalXp);
  const unlockedCount = achievements.filter((a) => a.unlocked_at).length;
  const top = [...attributes].sort((a, b) => b.current_xp - a.current_xp)[0];

  el.innerHTML = `
    <div class="view-mode">
      <div class="pw-avatar-btn" data-tooltip="ver/editar avatar">
        <pre id="pw-avatar-ascii" style="margin:0; white-space:pre; color:var(--accent);">${escapeHtml(profile.avatar_ascii ?? "sem avatar\nainda")}</pre>
      </div>
      <div style="flex:1 1 200px; min-width:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <b style="color:var(--text-bright); font-size:15px;">${escapeHtml(profile.display_name)}</b>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn sm" data-action="edit" style="display:flex; align-items:center; gap:5px;">${icon("pencil", { size: 11 })} editar perfil</button>
          </div>
        </div>
        <div style="display:flex; gap:20px; margin-top:14px; flex-wrap:wrap;">
          <div class="vm-row"><span class="k">nível</span><span class="v">${level}</span></div>
          <div class="vm-row"><span class="k">xp total</span><span class="v">${totalXp.toLocaleString("pt-BR")}</span></div>
          <div class="vm-row"><span class="k">conquistas</span><span class="v">${unlockedCount}/${achievements.length}</span></div>
          <div class="vm-row"><span class="k">destaque</span><span class="v">${top ? escapeHtml(top.name) : "—"}</span></div>
        </div>
      </div>
    </div>
  `;

  // ── ajusta o tamanho do mini-avatar ao box maior (ver widgets.css .pw-avatar-btn) ──
  // try/catch: uma falha de medição aqui (ex: canvas indisponível, layout
  // ainda não computado) não pode impedir o listener abaixo de anexar.
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

  // ── somente leitura: o card não edita nome/cor inline. O botão
  //    "editar perfil" abre o modal de Configurações direto na aba
  //    perfil, onde essa edição acontece. ──
  el.querySelector('[data-action="edit"]')?.addEventListener("click", () => openConfiguracoesModal("perfil"));

  // ── avatar tem atalho próprio: abre direto o modal de avatar (mesmo
  //    padrão do avatar da sidebar em app.js), sem passar por
  //    Configurações primeiro. ──
  el.querySelector(".pw-avatar-btn")?.addEventListener("click", () => {
    openAvatarModal({
      currentAscii: profile.avatar_ascii,
      onSave: async (ascii) => {
        try {
          await updateAvatar(ascii);
        } catch (err) {
          showErrorModal(err.message, "erro ao salvar avatar");
          return;
        }
        // propaga via store — o próprio subscribe abaixo cuida de
        // re-renderizar este card, e app.js/sidebar já está inscrito
        // no mesmo canal e se atualiza junto.
        store.set("profile", { ...store.get("profile"), avatar_ascii: ascii });
      },
    });
  });

  // ── mantém o card em sync com mudanças de perfil feitas em outro
  //    lugar (aba perfil de configurações, avatar da sidebar etc.). ──
  unsubscribeProfile = store.subscribe("profile", () => render(el, widget));
}