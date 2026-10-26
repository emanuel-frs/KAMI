import { getProfile, updateAvatar } from "../api/perfil.js";
import { getAttributes, getPlayer } from "../api/nucleo.js";
import { escapeHtml } from "../components/format.js";
import { fitAsciiText } from "../components/ascii.js";
import { icon } from "../components/icons.js";
import { openConfiguracoesModal } from "../modals/configuracoes-modal.js";
import { openAvatarModal } from "../modals/avatar-modal.js";
import { openRetrospectivaModal } from "../modals/retrospectiva-modal.js";
import { showErrorModal } from "../modals/err-modal.js";
import { store } from "../state/store.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { setXpBar } from "../components/xp-bar.js";
import { rollNumber } from "../components/fx.js";
import { flameOptions, flameSvg, protectionsSummary, protectionsText } from "../components/streak-flame.js";
import { nomeAtributo, rotuloTitulo } from "../components/textos-sistema.js";
import { localeAtual, t, tOu } from "../i18n.js";

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
let stopProgressListener = null;
// último nível/% mostrado — a barra de xp anima a partir dele (GAM-05);
// ao mudar de nível recomeça do zero, que é onde o xp do nível novo começa
let lastBar = null;

export async function render(el, widget) {
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  stopProgressListener?.();
  stopProgressListener = null;

  el.innerHTML = `<div class="empty-state">${t("perfil_w.carregando")}</div>`;

  const cardEl = el.closest(".card");
  cardEl?.setAttribute("data-editable", "");
  cardEl?.setAttribute("data-pinned", ""); // sempre 1/1, não arrastável (ver widgets.css)

  let profile, attributes, player;
  try {
    [profile, attributes, player] = await Promise.all([
      getProfile(),
      getAttributes(),
      getPlayer(),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(t("perfil_w.erro", { erro: err.message }))}</div>`;
    return;
  }

  // nível geral, xp total, sequência (+ proteções, GAM-06) e conquistas vêm prontos do backend
  // (GET /api/nucleo/player) — antes a fórmula do nível era copiada aqui
  // (components/xp.js) e podia divergir da de app/xp.py.
  const top = [...attributes].sort((a, b) => b.current_xp - a.current_xp)[0];
  // GAM-11: classe vem do atributo com mais xp (backend, nucleo.py::_player_class);
  // "destaque" virou o tooltip dela
  const classTip = player.player_class
    ? t("perfil_w.classe_dica", { atributo: top ? nomeAtributo(top.name) : "—" })
    : t("perfil_w.classe_sem");
  const streakLabel = t("geral.dias", { n: player.streak_current });
  const streakTip = `${t("perfil_w.recorde", { dias: t("geral.dias", { n: player.streak_best }) })}${
    player.streak_current > 0 && !player.active_today ? t("perfil_w.nao_perca") : ""
  }`;
  const classe = player.player_class_key ? tOu(`classe.${player.player_class_key}`, player.player_class) : player.player_class;

  el.innerHTML = `
    <div class="view-mode">
      <div class="pw-avatar-btn" data-tooltip="${t("perfil_w.avatar")}" aria-label="${t("perfil_w.avatar")}">
        <pre id="pw-avatar-ascii" style="margin:0; white-space:pre; color:var(--accent);">${escapeHtml(profile.avatar_ascii ?? t("perfil_w.sem_avatar"))}</pre>
      </div>
      <div style="flex:1 1 200px; min-width:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span class="pw-name-wrap">
            <b style="color:var(--text-bright); font-size:15px;">${escapeHtml(profile.display_name)}</b>
            <span class="pw-title" data-tooltip="${t("perfil_w.titulo_dica")}">« ${escapeHtml(rotuloTitulo(player.player_title_key, player.player_title ?? "iniciante"))} »</span>
          </span>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn sm" data-action="retro" data-tooltip="${t("perfil_w.retro_dica")}">${t("perfil_w.retro")}</button>
            <button type="button" class="btn sm" data-action="edit" style="display:flex; align-items:center; gap:5px;">${icon("pencil", { size: 11 })} ${t("perfil_w.editar")}</button>
          </div>
        </div>
        <div style="display:flex; gap:20px; margin-top:14px; flex-wrap:wrap;">
          <div class="vm-row" data-tooltip="${escapeHtml(t("perfil_w.xp_pro_nivel", { atual: player.current_level_xp, proximo: player.xp_for_next_level, nivel: player.level + 1 }))}"><span class="k">${t("perfil_w.nivel")}</span><span class="v" data-roll="level">${player.level}</span></div>
          <div class="vm-row"><span class="k">${t("perfil_w.xp_total")}</span><span class="v" data-roll="xp">${player.total_xp.toLocaleString(localeAtual())}</span></div>
          <div class="vm-row" data-tooltip="${escapeHtml(streakTip)}"><span class="k">${t("perfil_w.sequencia")}</span><span class="v">${streakLabel}</span></div>
          <div class="vm-row"><span class="k">${t("perfil_w.conquistas")}</span><span class="v" data-roll="achievements">${player.achievements_unlocked}/${player.achievements_total}</span></div>
          <div class="vm-row" data-tooltip="${escapeHtml(classTip)}"><span class="k">${t("perfil_w.classe")}</span><span class="v">${escapeHtml(classe ?? "—")}</span></div>
        </div>
        <div class="pw-xp" aria-label="${t("perfil_w.caminho_aria", { pct: player.pct, nivel: player.level + 1 })}">
          <span class="pw-xp-bar" aria-hidden="true"></span>
          <span class="pw-xp-text">${player.pct}% · ${t("perfil_w.xp_pro_nivel", { atual: player.current_level_xp, proximo: player.xp_for_next_level, nivel: player.level + 1 })}</span>
        </div>
        <div class="pw-streak">
          ${flameSvg(player.streak_current, flameOptions(player))}
          <div class="pw-streak-info">
            <div><span class="k">${t("perfil_w.sequencia")}</span> ${streakLabel} · ${t("perfil_w.recorde_curto", { n: player.streak_best })}</div>
            <div data-tooltip="${escapeHtml(protectionsSummary(player))}" aria-label="${escapeHtml(protectionsSummary(player))}">
              <span class="k">${t("perfil_w.protecoes")}</span> <span class="pw-protections">[${protectionsText(player.streak_protections, player.streak_protections_max)}]</span>${
                player.streak_protected_yesterday ? ` <span class="pw-protected">${t("perfil_w.ontem_protegido")}</span>` : ""
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // GAM-15: nível, xp e conquistas contam do valor anterior até o novo
  // quando o card é redesenhado depois de uma ação (components/fx.js)
  rollNumber(el.querySelector('[data-roll="level"]'), player.level, { key: "profile-level" });
  rollNumber(el.querySelector('[data-roll="xp"]'), player.total_xp, {
    key: "profile-xp",
    format: (n) => n.toLocaleString(localeAtual()),
  });
  rollNumber(el.querySelector('[data-roll="achievements"]'), player.achievements_unlocked, {
    key: "profile-achievements",
    format: (n) => `${n}/${player.achievements_total}`,
  });

  const barFrom = lastBar == null ? null : lastBar.level === player.level ? lastBar.pct : 0;
  setXpBar(el.querySelector(".pw-xp-bar"), player.pct, { from: barFrom, cells: 20 });
  lastBar = { level: player.level, pct: player.pct };

  // ── ajusta o tamanho do mini-avatar ao box maior (ver widgets.css .pw-avatar-btn) ──
  // try/catch: uma falha de medição aqui (ex: canvas indisponível, layout
  // ainda não computado) não pode impedir o listener abaixo de anexar.
  const avatarPre = el.querySelector("#pw-avatar-ascii");
  try {
    fitAsciiText(avatarPre, profile.avatar_ascii ?? t("perfil_w.sem_avatar"), {
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
  // GAM-12: reabre as retrospectivas mensais guardadas
  el.querySelector('[data-action="retro"]')?.addEventListener("click", () => openRetrospectivaModal());

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
          showErrorModal(err.message, t("perfil_w.erro_avatar"));
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

  // xp/nível/sequência mudam por ações em qualquer módulo — o
  // progress-watcher avisa depois de cada escrita que mexeu no progresso
  stopProgressListener = listenWhileConnected(el, "kami:action-registered", () => render(el, widget));
}