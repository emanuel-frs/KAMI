/**
 * Modal de configurações — aberto pelo ícone de engrenagem no rodapé
 * da sidebar (fora de qualquer tela, ver alinhamento de UX geral). Mesmo padrão singleton dos outros modais (ver
 * err-modal.js).
 *
 * A partir de configuracoes_plano.md: modal com layout sidebar (lista
 * de abas à esquerda) + conteúdo à direita, inspirado nas
 * Configurações do Claude.ai mas com a linguagem visual do Kami
 * (quadrado, sem cantos arredondados). Continua sendo um modal (não
 * uma tela/rota própria) — só o conteúdo interno que ganhou abas.
 *
 * 5 abas no v1 (ver TABS abaixo). "Aparência", "perfil", "notificações",
 * "backup e dados" e "chaves" têm implementação real. "Backup e Dados" é a mesma funcionalidade que já existia no
 * modal antigo (export/import/reset) — só mudou de lugar, sem
 * mudança de comportamento nenhuma:
 *   - exportar dados: baixa um .json com o dump completo do banco
 *     (GET /api/sistema/export)
 *   - importar dados: sobrescreve TODAS as configurações e dados
 *     atuais com o conteúdo de um .json exportado antes (POST
 *     /api/sistema/import) — mesmo padrão de CONFIRMAÇÃO do reset
 *     (digitar uma palavra pra habilitar o botão + modal de
 *     confirmação explícito antes de executar), mas com um visual
 *     diferente (.settings-warning, âmbar) em vez do vermelho da
 *     zona de perigo: é uma sobrescrita, não um apagar-tudo
 *     definitivo. O modal de confirmação final (a última etapa antes
 *     de executar) segue vermelho igual ao do reset — é ali que o
 *     alerta "isso não tem volta" realmente importa.
 *   - zona de perigo: reset completo (POST /api/sistema/reset),
 *     exige digitar a palavra "excluir" pra habilitar o botão — o
 *     backend também exige essa palavra no corpo da requisição, então
 *     a validação do frontend é conveniência de UX, não a única
 *     barreira contra um reset acidental.
 *
 * "Aparência" (nova): v1 reduzido só à troca de cor de destaque
 * (accent_color do perfil) — mesma paleta única de accent-colors.js
 * usada no onboarding (kami-intro.js), e reaproveita o mesmo estilo
 * de swatch (.ki-swatches/.ki-swatch, definido em kami-intro.css) em
 * vez de duplicar CSS. Sem botão "salvar" — clicar num swatch já
 * aplica e persiste na hora (mesmo padrão de feedback imediato do
 * onboarding).
 *
 * "Perfil" (nova): dados do usuário + visualizar/editar avatar (ver
 * configuracoes_plano.md). O widget de perfil (widgets/profile.js)
 * virou somente leitura — essa aba é agora o único lugar que edita
 * nome de exibição e avatar. Cor de destaque NÃO mora aqui (isso é
 * escopo da aba Aparência) — de propósito, essa aba não tem nenhum
 * campo de tema/cor. Avatar continua abrindo o modal dedicado
 * (avatar-modal.js, decisão 18), nome tem campo + botão salvar
 * próprios (não é feedback imediato como os swatches, já que é um
 * input de texto livre).
 *
 * "Notificações" (nova): v1 reduzido só ao FILTRO POR TIPO — quais
 * seções aparecem no modal de notificações (modals/notifications-
 * modal.js) e contam pro badge do sino da sidebar (components/
 * notification-bell.js). Dois tipos hoje, espelhando as duas seções
 * que já existem lá: "vencendo em breve" (calendário/alertas,
 * notif_alerts_enabled) e "e-mails" (notif_email_enabled). Sem botão
 * "salvar" — mesmo padrão de feedback imediato da aba Aparência,
 * cada toggle já aplica e persiste na hora. Outras preferências de
 * notificação (mute de conta de e-mail — já mora em Organização —,
 * toast/notificação nativa) ficam de fora desta leva.
 *
 * "Chaves" (nova, ver configuracoes_plano.md): cadastro/gerenciamento
 * das três credenciais de terceiro que já existiam em Organização
 * (chave de busca da tavily, token do github, conta de e-mail) —
 * mesmos endpoints/estado, só uma segunda superfície de UI. Os ícones
 * de chave/engrenagem em Organização CONTINUAM existindo em paralelo
 * (não é migração exclusiva). Ordem das seções segue a ordem de
 * pastas do card "chaves" em si (busca, github, e-mail).
 *
 * A seção de e-mail replica a lista de contas do modal "gerenciar
 * contas" de Organização (editar, deletar, marcar como padrão,
 * silenciar, sincronizar individual) só que sem modal — tudo inline
 * na própria aba, com o formulário de nova conta/edição escondido
 * atrás de um botão "+ nova conta" (mesmo padrão de toggle
 * mostrar/esconder, não um modal separado).
 */
import { exportData, importData, resetData } from "../api/sistema.js";
import { getProfile, updateProfile, updateAvatar } from "../api/perfil.js";
import {
  listEmailAccounts,
  createEmailAccount,
  updateEmailAccount,
  deleteEmailAccount,
  syncEmailAccount,
  listMutedAccounts,
  muteAccount,
  unmuteAccount,
  getGithubTokenStatus,
  saveGithubToken,
  deleteGithubToken,
  getSearchKeyStatus,
  saveSearchKey,
  deleteSearchKey,
} from "../api/organizacao.js";
import { openExternal } from "../components/open-external.js";
import { escapeHtml } from "../components/format.js";
import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";
import { openAvatarModal } from "./avatar-modal.js";
import { icon } from "../components/icons.js";
import { ACCENT_OPTIONS } from "../components/accent-colors.js";
import { fitAsciiText } from "../components/ascii.js";
import { store } from "../state/store.js";

const RESET_WORD = "excluir";
const IMPORT_WORD = "importar";

const TABS = [
  { id: "aparencia", label: "aparência", iconName: "palette" },
  { id: "perfil", label: "perfil", iconName: "user" },
  { id: "notificacoes", label: "notificações", iconName: "bell" },
  { id: "chaves", label: "chaves", iconName: "key" },
  { id: "backup", label: "backup e dados", iconName: "download" },
];

// abas ainda sem conteúdo funcional — mostram um placeholder em vez
// do formulário de verdade (ver cabeçalho do arquivo). Vazio nesta
// leva (todas as 5 abas já têm implementação real); a estrutura fica
// pronta pra próxima aba que precisar disso.
const PLACEHOLDER_COPY = {};

let modalEl = null;
let busy = false;

// aba chaves — estado da lista de contas de e-mail (ver wireChavesTab()
// mais abaixo). Módulo-level porque a lista é recarregada e
// re-renderizada em vários pontos (após salvar/editar/remover/mute/
// sync), sem depender de reabrir o modal inteiro.
let chavesAccounts = [];
let chavesMutedAccounts = [];
let chavesSyncingIds = new Set();

function buildTabsHtml() {
  return TABS.map(
    (t, i) => `
      <button type="button" class="cfg-tab${i === 0 ? " on" : ""}" data-tab="${t.id}">
        ${icon(t.iconName, { size: 13 })}
        <span>${t.label}</span>
      </button>`
  ).join("");
}

function buildAparenciaPanel() {
  return `
    <div class="cfg-panel on" data-panel="aparencia">
      <div class="settings-section" style="padding-top:0;">
        <h4>cor de destaque</h4>
        <p class="settings-desc">usada em botões, ícones ativos, gráficos e bordas em todo o app. mais opções de aparência chegam depois.</p>
        <div class="ki-swatches" id="cfg-accent-swatches"></div>
        <p class="settings-status" id="cfg-accent-status"></p>
      </div>
    </div>`;
}

function buildPerfilPanel() {
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

function buildNotificacoesPanel() {
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
    </div>`;
}

function buildChavesPanel() {
  return `
    <div class="cfg-panel" data-panel="chaves">
      <div class="settings-section" style="padding-top:0;">
        <h4>chave de busca (tavily) <span id="cfg-search-badge" class="gh-token-badge"></span></h4>
        <p class="settings-desc">
          necessária pro resumo inline de busca da tela organização. crie uma
          conta gratuita em <span data-open-link="https://tavily.com" style="color:var(--accent); cursor:pointer; text-decoration:underline;">tavily.com</span>
          (free tier: 1000 buscas/mês, sem cartão) e cole a chave aqui.
        </p>
        <div class="field"><input type="password" id="cfg-search-key-input" placeholder="tvly-..."></div>
        <div id="cfg-search-key-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
        <div class="form-actions">
          <button class="btn sm" id="cfg-search-save-btn">salvar chave</button>
          <button class="btn sm" id="cfg-search-delete-btn">remover chave</button>
        </div>
      </div>

      <div class="settings-section">
        <h4>token do github <span id="cfg-github-badge" class="gh-token-badge"></span></h4>
        <p class="settings-desc">opcional — sem token, só repositórios públicos e 60 req/h. com um fine-grained personal access token (permissão de leitura em contents/metadata), o kami passa a ver repositórios privados e sobe pra 5000 req/h.</p>
        <div class="field"><input type="password" id="cfg-gh-token-input" placeholder="github_pat_..."></div>
        <div id="cfg-gh-token-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
        <div class="form-actions">
          <button class="btn sm" id="cfg-gh-save-btn">salvar token</button>
          <button class="btn sm" id="cfg-gh-delete-btn">remover token</button>
        </div>
      </div>

      <div class="settings-section">
        <h4>contas de e-mail</h4>
        <p class="settings-desc">edite, remova, marque como padrão, silencie ou sincronize manualmente — as mesmas ações continuam disponíveis em organização.</p>
        <div id="cfg-accounts-list"></div>
        <div class="form-actions" style="margin-top:8px;">
          <button type="button" class="btn sm" id="cfg-acc-toggle-btn">+ nova conta</button>
        </div>
        <div id="cfg-acc-form-wrap" style="display:none; margin-top:10px;">
          <input type="hidden" id="cfg-acc-edit-id">
          <div class="field"><label>apelido</label><input type="text" id="cfg-acc-label" placeholder="ex: gmail pessoal"></div>
          <div class="field-row">
            <div class="field"><label>host imap</label><input type="text" id="cfg-acc-host" placeholder="imap.gmail.com"></div>
            <div class="field" style="max-width:110px;"><label>porta</label><input type="number" id="cfg-acc-port" value="993"></div>
          </div>
          <div class="field"><label>usuário</label><input type="text" id="cfg-acc-username" placeholder="voce@gmail.com"></div>
          <div class="field"><label>senha de app <span id="cfg-acc-password-hint" style="color:var(--text-faint); font-size:9.5px;"></span></label><input type="password" id="cfg-acc-password" placeholder="••••••••"></div>
          <label class="acc-default-toggle"><input type="checkbox" id="cfg-acc-sync-by-default" checked> ${icon("star", { size: 12 })} conta padrão (já vem selecionada ao abrir organização)</label>
          <div id="cfg-acc-error" style="display:none; color:var(--red); font-size:10.5px; margin:8px 0;"></div>
          <div class="form-actions">
            <button class="btn sm" id="cfg-acc-save-btn">salvar conta</button>
            <button class="btn sm" id="cfg-acc-cancel-btn">cancelar</button>
          </div>
          <p class="settings-status" id="cfg-acc-status"></p>
        </div>
      </div>
    </div>`;
}

function buildPlaceholderPanel(tabId) {
  return `
    <div class="cfg-panel" data-panel="${tabId}">
      <div class="cfg-placeholder">
        ${icon("clock", { size: 20 })}
        <p>${PLACEHOLDER_COPY[tabId]}</p>
      </div>
    </div>`;
}

function buildBackupPanel() {
  return `
    <div class="cfg-panel" data-panel="backup">
      <div class="settings-section" style="padding-top:0;">
        <h4>exportar dados</h4>
        <p class="settings-desc">baixa um arquivo .json com todos os seus dados (perfil, núcleo, finanças, aprendizado, organização, metas) — útil como backup antes de trocar de máquina ou reinstalar.</p>
        <div class="form-actions">
          <button class="btn sm" id="sm-export-btn" data-action="export">baixar backup (.json)</button>
        </div>
        <p class="settings-status" id="sm-export-status"></p>
      </div>
      <div class="settings-section settings-warning">
        <h4>importar dados</h4>
        <p class="settings-desc">restaura um backup .json exportado anteriormente. isso <strong>sobrescreve</strong> todas as suas configurações e dados atuais (perfil, núcleo, finanças, aprendizado, organização, metas) — não tem como desfazer depois.</p>
        <p class="settings-note">nota: senha de e-mail, token do github e chave de busca são salvos criptografados com uma chave que fica só nesta instalação. se este backup for de <strong>outra máquina</strong>, esses três campos não vêm junto — o resto dos dados restaura normalmente, mas você vai precisar reconfigurar essas credenciais em organização.</p>
        <div class="field">
          <label>arquivo de backup (.json)</label>
          <input type="file" id="sm-import-file" accept="application/json,.json">
        </div>
        <div class="field">
          <label>digite <strong>${IMPORT_WORD}</strong> pra habilitar o botão abaixo</label>
          <input type="text" id="sm-import-confirm" placeholder="${IMPORT_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm warn" id="sm-import-btn" data-action="import" disabled>importar e sobrescrever</button>
        </div>
        <p class="settings-status" id="sm-import-status"></p>
      </div>
      <div class="settings-section settings-danger">
        <h4>zona de perigo</h4>
        <p class="settings-desc">apaga TODOS os seus dados e devolve o Kami ao estado de instalação nova. não tem como desfazer — exporte um backup antes, se quiser guardar algo.</p>
        <div class="field">
          <label>digite <strong>${RESET_WORD}</strong> pra habilitar o botão abaixo</label>
          <input type="text" id="sm-reset-confirm" placeholder="${RESET_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm danger" id="sm-reset-btn" data-action="reset" disabled>limpar todos os dados</button>
        </div>
      </div>
    </div>`;
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "settings-modal";
  wrap.innerHTML = `
    <div class="modal cfg-modal">
      <div class="modal-head">configurações <span class="close" data-action="close">${icon("x")}</span></div>
      <div class="modal-body cfg-shell">
        <nav class="cfg-sidebar">${buildTabsHtml()}</nav>
        <div class="cfg-content">
          ${buildAparenciaPanel()}
          ${buildPerfilPanel()}
          ${buildNotificacoesPanel()}
          ${buildChavesPanel()}
          ${buildBackupPanel()}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function switchTab(wrap, tabId) {
  wrap.querySelectorAll(".cfg-tab").forEach((el) =>
    el.classList.toggle("on", el.dataset.tab === tabId)
  );
  wrap.querySelectorAll(".cfg-panel").forEach((el) =>
    el.classList.toggle("on", el.dataset.panel === tabId)
  );
}

function wireModal(wrap) {
  wrap.querySelectorAll('[data-action="close"]').forEach((el) =>
    el.addEventListener("click", () => { if (!busy) closeConfiguracoesModal(); })
  );
  wrap.addEventListener("click", (e) => { if (e.target === wrap && !busy) closeConfiguracoesModal(); });

  wrap.querySelectorAll(".cfg-tab").forEach((el) =>
    el.addEventListener("click", () => switchTab(wrap, el.dataset.tab))
  );

  wirePerfilTab(wrap);
  wireNotificacoesTab(wrap);
  wireChavesTab(wrap);
  wireBackupTab(wrap);

  wrap.addEventListener("click", (e) => {
    const link = e.target.closest("[data-open-link]")?.dataset.openLink;
    if (link) openExternal(link);
  });
}

// ── aba aparência ──────────────────────────────────────────────────────
// (sem wire-up fixo aqui: os swatches são recriados a cada abertura do
// modal via renderAccentSwatches(), chamada em openConfiguracoesModal() —
// precisa ser assim porque o accent_color atual só é conhecido depois
// de buscar o perfil, que é async e não pode travar buildModal().)
function renderAccentSwatches(wrap, currentColor) {
  const container = wrap.querySelector("#cfg-accent-swatches");
  container.innerHTML = ACCENT_OPTIONS.map((c) => {
    const sel = c.value === currentColor ? " ki-swatch--sel" : "";
    return `<button type="button" class="ki-swatch${sel}" data-color="${c.value}" data-tooltip="${c.label}" style="background:${c.value};" aria-label="${c.label}"></button>`;
  }).join("");

  container.querySelectorAll(".ki-swatch").forEach((btn) => {
    btn.addEventListener("click", () => selectAccentColor(wrap, btn));
  });
}

async function selectAccentColor(wrap, btn) {
  if (busy) return;
  const statusEl = wrap.querySelector("#cfg-accent-status");
  const color = btn.dataset.color;

  wrap.querySelectorAll(".ki-swatch").forEach((b) =>
    b.classList.toggle("ki-swatch--sel", b === btn)
  );
  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  try {
    await updateProfile({ accent_color: color });
  } catch (err) {
    showErrorModal(err.message, "erro ao salvar cor de destaque");
    return;
  }

  // aplica globalmente na hora, igual o boot faz em app.js e o
  // widget de perfil faz ao salvar (document.documentElement, não
  // só dentro do modal).
  document.documentElement.style.setProperty("--accent", color);

  // propaga pro store — mantém qualquer outro lugar que leia o
  // perfil (ex: widget de perfil) em sync sem precisar recarregar.
  store.set("profile", { ...store.get("profile"), accent_color: color });

  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}

// ── aba perfil ───────────────────────────────────────────────────────
// (mesmo padrão da aba aparência: os dados atuais só são conhecidos
// depois de buscar o perfil, então o preenchimento de verdade acontece
// em renderPerfilTab(), chamada em openConfiguracoesModal() — wirePerfilTab()
// aqui embaixo só liga os listeners, que não dependem do profile ainda
// carregado.)
function renderPerfilTab(wrap, profile) {
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
  } catch (_) {}
}

function wirePerfilTab(wrap) {
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
    if (busy) return;
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

// ── aba notificações ─────────────────────────────────────────────────
// (mesmo padrão da aba aparência: estado atual só é conhecido depois
// de buscar o perfil, então o preenchimento de verdade acontece em
// renderNotificacoesTab(), chamada em openConfiguracoesModal() —
// wireNotificacoesTab() aqui embaixo só liga os listeners, que já
// aplicam e persistem na hora, sem botão "salvar".)
function renderNotificacoesTab(wrap, profile) {
  wrap.querySelector("#cfg-notif-alerts").checked = profile.notif_alerts_enabled !== false;
  wrap.querySelector("#cfg-notif-email").checked = profile.notif_email_enabled !== false;
}

function wireNotificacoesTab(wrap) {
  const statusEl = wrap.querySelector("#cfg-notif-status");

  async function onToggle(field, checkbox) {
    if (busy) return;
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
}

// ── aba chaves ───────────────────────────────────────────────────────
// (mesmos endpoints/estado de pages/organizacao.js — essa aba é só uma
// segunda superfície de UI pras mesmas três credenciais, ver cabeçalho
// do arquivo. Status do token/chave e a lista de contas são buscados
// toda vez que o modal abre, junto com o profile, em
// openConfiguracoesModal().)
function renderGithubBadge(wrap, configured) {
  const badge = wrap.querySelector("#cfg-github-badge");
  badge.innerHTML = configured
    ? `<span class="status-dot"></span> token ativo`
    : `<span class="status-dot"></span> sem token`;
  badge.classList.toggle("on", configured);
}

function renderSearchBadge(wrap, configured) {
  const badge = wrap.querySelector("#cfg-search-badge");
  badge.innerHTML = configured
    ? `<span class="status-dot"></span> chave ativa`
    : `<span class="status-dot"></span> sem chave`;
  badge.classList.toggle("on", configured);
}

// ── contas de e-mail (lista + form colapsável, sem modal — ver
// cabeçalho do arquivo) ──────────────────────────────────────────────
function isChavesAccountMuted(accountId) {
  return chavesMutedAccounts.some((m) => m.account_id === accountId);
}

function renderChavesAccountsList(wrap) {
  const listEl = wrap.querySelector("#cfg-accounts-list");
  if (!chavesAccounts.length) {
    listEl.innerHTML = '<div class="empty-state">nenhuma conta cadastrada ainda.</div>';
    return;
  }
  listEl.innerHTML = chavesAccounts
    .map((a) => {
      const muted = isChavesAccountMuted(a.id);
      const syncing = chavesSyncingIds.has(a.id);
      return `
      <div class="org-account${muted ? " is-muted" : ""}">
        <div class="org-account-info">
          <b>${escapeHtml(a.label)}${a.sync_by_default ? ` ${icon("star", { size: 10, fill: "currentColor" })}` : ""}</b>
          <span class="meta">${escapeHtml(a.username)} · ${escapeHtml(a.imap_host)}:${a.imap_port}${muted ? ` · <span class="email-muted-tag">${icon("bell-off", { size: 9 })} silenciada</span>` : ""}</span>
        </div>
        <div class="org-account-actions">
          <span class="icon-btn" data-tooltip="${muted ? "reativar notificações desta conta" : "silenciar notificações desta conta"}" data-cfg-mute-account="${a.id}">${icon(muted ? "bell" : "bell-off", { size: 12 })}</span>
          <span class="icon-btn${syncing ? " is-syncing" : ""}" data-tooltip="${syncing ? "sincronizando..." : "sincronizar"}" data-cfg-sync-account="${syncing ? "" : a.id}">${icon("refresh-cw", { size: 12 })}</span>
          <span class="icon-btn" data-tooltip="editar" data-cfg-edit-account="${a.id}">${icon("pencil", { size: 12 })}</span>
          <span class="icon-btn" data-tooltip="remover" data-cfg-delete-account="${a.id}">${icon("x")}</span>
        </div>
      </div>`;
    })
    .join("");
}

async function loadChavesAccounts(wrap) {
  try {
    const [accounts, muted] = await Promise.all([listEmailAccounts(), listMutedAccounts()]);
    chavesAccounts = accounts;
    chavesMutedAccounts = muted;
  } catch (err) {
    showErrorModal(err.message, "erro ao carregar contas de e-mail");
    return;
  }
  renderChavesAccountsList(wrap);
}

// abre o form (escondido por padrão) já preenchido pra edição, ou em
// branco pra uma conta nova — mesmo par de estados do account-modal.js
// de organizacao.js, só que sem modal (o form fica dentro da própria
// seção, atrás do botão "+ nova conta"/"cancelar").
function openChavesForm(wrap, accountId) {
  const formWrap = wrap.querySelector("#cfg-acc-form-wrap");
  const toggleBtn = wrap.querySelector("#cfg-acc-toggle-btn");
  const hint = wrap.querySelector("#cfg-acc-password-hint");
  const syncByDefaultInput = wrap.querySelector("#cfg-acc-sync-by-default");

  if (accountId) {
    const acc = chavesAccounts.find((a) => a.id === accountId);
    if (!acc) return;
    wrap.querySelector("#cfg-acc-edit-id").value = acc.id;
    wrap.querySelector("#cfg-acc-label").value = acc.label;
    wrap.querySelector("#cfg-acc-host").value = acc.imap_host;
    wrap.querySelector("#cfg-acc-port").value = acc.imap_port;
    wrap.querySelector("#cfg-acc-username").value = acc.username;
    wrap.querySelector("#cfg-acc-password").value = "";
    syncByDefaultInput.checked = !!acc.sync_by_default;
    hint.textContent = "(deixe em branco pra manter a senha atual)";
  } else {
    wrap.querySelector("#cfg-acc-edit-id").value = "";
    ["cfg-acc-label", "cfg-acc-host", "cfg-acc-username", "cfg-acc-password"].forEach(
      (id) => (wrap.querySelector("#" + id).value = "")
    );
    wrap.querySelector("#cfg-acc-port").value = 993;
    syncByDefaultInput.checked = true;
    hint.textContent = "";
  }

  const errEl = wrap.querySelector("#cfg-acc-error");
  errEl.style.display = "none";
  const statusEl = wrap.querySelector("#cfg-acc-status");
  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  formWrap.style.display = "block";
  toggleBtn.textContent = "cancelar";

  // rola o painel pra trazer o form pra vista — sem isso ele abre
  // "fora da tela" embaixo da lista de contas, exigindo rolar na mão
  // pra ver os campos (mesmo se accountId for passado por editar, ou
  // null pelo botão "+ nova conta"). requestAnimationFrame garante que
  // o layout já recalculou a altura do form (display:none -> block)
  // antes de medir a posição de scroll.
  requestAnimationFrame(() => {
    formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function closeChavesForm(wrap) {
  wrap.querySelector("#cfg-acc-form-wrap").style.display = "none";
  wrap.querySelector("#cfg-acc-toggle-btn").textContent = "+ nova conta";
  wrap.querySelector("#cfg-acc-edit-id").value = "";
}

async function handleDeleteChavesAccount(wrap, accountId) {
  const ok = await showConfirmModal("remover esta conta? o cache de e-mails dela também será apagado.", {
    title: "remover conta",
    confirmText: "remover",
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteEmailAccount(accountId);
  } catch (err) {
    showErrorModal(err.message, "erro ao remover conta");
    return;
  }
  await loadChavesAccounts(wrap);
}

async function handleToggleMuteChavesAccount(wrap, accountId) {
  const muted = isChavesAccountMuted(accountId);
  try {
    if (muted) {
      const entry = chavesMutedAccounts.find((m) => m.account_id === accountId);
      if (entry) await unmuteAccount(entry.id);
    } else {
      await muteAccount(accountId);
    }
  } catch (err) {
    showErrorModal(err.message, "erro ao atualizar silenciamento");
    return;
  }
  await loadChavesAccounts(wrap);
}

async function handleSyncChavesAccount(wrap, accountId) {
  if (chavesSyncingIds.has(accountId)) return; // já sincronizando essa conta — ignora clique duplicado
  chavesSyncingIds.add(accountId);
  renderChavesAccountsList(wrap);
  try {
    await syncEmailAccount(accountId);
  } catch (err) {
    showErrorModal(err?.message || "falha ao sincronizar — confira host/porta/usuário/senha de app.", "falha ao sincronizar");
  } finally {
    chavesSyncingIds.delete(accountId);
  }
  await loadChavesAccounts(wrap);
}

function wireChavesTab(wrap) {
  wrap.querySelector("#cfg-acc-toggle-btn").addEventListener("click", () => {
    const formWrap = wrap.querySelector("#cfg-acc-form-wrap");
    if (formWrap.style.display === "none") openChavesForm(wrap);
    else closeChavesForm(wrap);
  });
  wrap.querySelector("#cfg-acc-cancel-btn").addEventListener("click", () => closeChavesForm(wrap));

  wrap.querySelector("#cfg-acc-save-btn").addEventListener("click", async () => {
    if (busy) return;
    const editId = wrap.querySelector("#cfg-acc-edit-id").value;
    const label = wrap.querySelector("#cfg-acc-label").value.trim();
    const imap_host = wrap.querySelector("#cfg-acc-host").value.trim();
    const imap_port = parseInt(wrap.querySelector("#cfg-acc-port").value, 10) || 993;
    const username = wrap.querySelector("#cfg-acc-username").value.trim();
    const app_password = wrap.querySelector("#cfg-acc-password").value;
    const sync_by_default = wrap.querySelector("#cfg-acc-sync-by-default").checked;
    const errEl = wrap.querySelector("#cfg-acc-error");
    const statusEl = wrap.querySelector("#cfg-acc-status");
    errEl.style.display = "none";
    statusEl.textContent = "";
    statusEl.classList.remove("settings-status--visible");

    if (!label || !imap_host || !username || (!editId && !app_password)) {
      errEl.textContent = "preencha apelido, host, usuário e senha de app.";
      errEl.style.display = "block";
      return;
    }

    const btn = wrap.querySelector("#cfg-acc-save-btn");
    btn.disabled = true;
    btn.textContent = "salvando...";
    try {
      if (editId) {
        const payload = { label, imap_host, imap_port, username, sync_by_default };
        if (app_password) payload.app_password = app_password;
        await updateEmailAccount(editId, payload);
      } else {
        await createEmailAccount({ label, imap_host, imap_port, username, app_password, sync_by_default });
      }
    } catch (err) {
      errEl.textContent = err?.message || "falha ao salvar a conta — confira host/porta/usuário/senha de app.";
      errEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "salvar conta";
      return;
    }
    btn.disabled = false;
    btn.textContent = "salvar conta";

    closeChavesForm(wrap);
    await loadChavesAccounts(wrap);
  });

  // ações da lista (editar/remover/mute/sync) — delegado, já que a
  // lista é recriada via innerHTML a cada loadChavesAccounts().
  wrap.addEventListener("click", (e) => {
    const muteId = e.target.closest("[data-cfg-mute-account]")?.dataset.cfgMuteAccount;
    if (muteId) handleToggleMuteChavesAccount(wrap, muteId);

    const syncId = e.target.closest("[data-cfg-sync-account]")?.dataset.cfgSyncAccount;
    if (syncId) handleSyncChavesAccount(wrap, syncId);

    const editId = e.target.closest("[data-cfg-edit-account]")?.dataset.cfgEditAccount;
    if (editId) openChavesForm(wrap, editId);

    const deleteId = e.target.closest("[data-cfg-delete-account]")?.dataset.cfgDeleteAccount;
    if (deleteId) handleDeleteChavesAccount(wrap, deleteId);
  });

  // token do github
  wrap.querySelector("#cfg-gh-save-btn").addEventListener("click", async () => {
    const input = wrap.querySelector("#cfg-gh-token-input");
    const errEl = wrap.querySelector("#cfg-gh-token-error");
    const token = input.value.trim();
    errEl.style.display = "none";
    if (!token) {
      errEl.textContent = "cole um token.";
      errEl.style.display = "block";
      return;
    }
    try {
      const result = await saveGithubToken(token);
      input.value = "";
      renderGithubBadge(wrap, true);
      // esta aba não tem a lista de repos (isso mora em pages/organizacao.js)
      // — a importação automática já rodou no backend; só avisa aqui se
      // ela falhou (sucesso fica visível na aba github, em Organização).
      if (result?.import_error) {
        showErrorModal(result.import_error, "token salvo, mas a importação automática de repositórios falhou");
      }
    } catch (err) {
      errEl.textContent = err?.message || "token inválido ou sem permissão.";
      errEl.style.display = "block";
      return;
    }
  });

  wrap.querySelector("#cfg-gh-delete-btn").addEventListener("click", async () => {
    await deleteGithubToken();
    wrap.querySelector("#cfg-gh-token-input").value = "";
    wrap.querySelector("#cfg-gh-token-error").style.display = "none";
    renderGithubBadge(wrap, false);
  });

  // chave de busca (tavily)
  wrap.querySelector("#cfg-search-save-btn").addEventListener("click", async () => {
    const input = wrap.querySelector("#cfg-search-key-input");
    const errEl = wrap.querySelector("#cfg-search-key-error");
    const key = input.value.trim();
    errEl.style.display = "none";
    if (!key) {
      errEl.textContent = "cole uma chave.";
      errEl.style.display = "block";
      return;
    }
    try {
      await saveSearchKey(key);
    } catch (err) {
      errEl.textContent = err?.message || "chave inválida.";
      errEl.style.display = "block";
      return;
    }
    input.value = "";
    renderSearchBadge(wrap, true);
  });

  wrap.querySelector("#cfg-search-delete-btn").addEventListener("click", async () => {
    await deleteSearchKey();
    wrap.querySelector("#cfg-search-key-input").value = "";
    wrap.querySelector("#cfg-search-key-error").style.display = "none";
    renderSearchBadge(wrap, false);
  });
}

// ── aba backup e dados ───────────────────────────────────────────────
function wireBackupTab(wrap) {
  const importFile = wrap.querySelector("#sm-import-file");
  const importConfirmInput = wrap.querySelector("#sm-import-confirm");
  const importBtn = wrap.querySelector("#sm-import-btn");
  const updateImportBtn = () => {
    const wordOk = importConfirmInput.value.trim().toLowerCase() === IMPORT_WORD;
    const fileOk = importFile.files.length > 0;
    importBtn.disabled = !(wordOk && fileOk);
  };
  importFile.addEventListener("change", updateImportBtn);
  importConfirmInput.addEventListener("input", updateImportBtn);

  const confirmInput = wrap.querySelector("#sm-reset-confirm");
  const resetBtn = wrap.querySelector("#sm-reset-btn");
  confirmInput.addEventListener("input", () => {
    resetBtn.disabled = confirmInput.value.trim().toLowerCase() !== RESET_WORD;
  });

  wrap.querySelector("#sm-export-btn").addEventListener("click", () => handleExport(wrap));
  importBtn.addEventListener("click", () => handleImport(wrap));
  resetBtn.addEventListener("click", () => handleReset(wrap));
}

async function handleExport(wrap) {
  if (busy) return;
  const btn = wrap.querySelector("#sm-export-btn");
  const statusEl = wrap.querySelector("#sm-export-status");
  const originalLabel = btn.textContent;
  busy = true;
  btn.disabled = true;
  btn.textContent = "gerando...";
  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  try {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    const filename = `kami-backup-${today}.json`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusEl.innerHTML = `${icon("check", { size: 12 })} salvo como ${filename} (confira sua pasta de downloads)`;
    statusEl.classList.add("settings-status--visible");
  } catch (err) {
    showErrorModal(err.message, "erro ao exportar dados");
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error("o arquivo selecionado não é um .json válido"));
      }
    };
    reader.onerror = () => reject(new Error("não foi possível ler o arquivo selecionado"));
    reader.readAsText(file);
  });
}

async function handleImport(wrap) {
  if (busy) return;
  const fileInput = wrap.querySelector("#sm-import-file");
  const confirmInput = wrap.querySelector("#sm-import-confirm");
  const importBtn = wrap.querySelector("#sm-import-btn");
  const statusEl = wrap.querySelector("#sm-import-status");
  const file = fileInput.files[0];
  const confirmation = confirmInput.value.trim().toLowerCase();
  if (!file || confirmation !== IMPORT_WORD) return; // botão já deveria estar disabled, defesa extra

  statusEl.textContent = "";
  statusEl.classList.remove("settings-status--visible");

  let parsed;
  try {
    parsed = await readFileAsJson(file);
  } catch (err) {
    showErrorModal(err.message, "erro ao importar dados");
    return;
  }
  if (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object") {
    showErrorModal("o arquivo selecionado não parece ser um backup válido do Kami (formato inesperado).", "erro ao importar dados");
    return;
  }

  const reallySure = await showConfirmModal(
    "isso sobrescreve TODAS as suas configurações e dados atuais (perfil, núcleo, finanças, aprendizado, organização, metas) com o conteúdo desse arquivo, e não tem como desfazer. tem certeza?",
    { title: "confirmar importação", confirmText: "sim, sobrescrever tudo", danger: true }
  );
  if (!reallySure) return;

  busy = true;
  fileInput.disabled = true;
  confirmInput.disabled = true;
  importBtn.disabled = true;
  importBtn.textContent = "importando...";

  try {
    await importData(confirmation, parsed.tables);
    // recarrega o app inteiro em vez de tentar resetar o estado em
    // memória de cada tela na mão (store.js, widgets já montados
    // etc.) — garante que tudo volte a buscar do backend já com os
    // dados importados.
    window.location.reload();
  } catch (err) {
    showErrorModal(err.message, "erro ao importar dados");
    busy = false;
    fileInput.disabled = false;
    confirmInput.disabled = false;
    importBtn.disabled = false;
    importBtn.textContent = "importar e sobrescrever";
  }
}

async function handleReset(wrap) {
  if (busy) return;
  const confirmInput = wrap.querySelector("#sm-reset-confirm");
  const resetBtn = wrap.querySelector("#sm-reset-btn");
  const confirmation = confirmInput.value.trim().toLowerCase();
  if (confirmation !== RESET_WORD) return; // botão já deveria estar disabled, defesa extra

  const reallySure = await showConfirmModal(
    "isso apaga TODOS os seus dados (perfil, núcleo, finanças, aprendizado, organização, metas) e não tem como desfazer. tem certeza?",
    { title: "confirmar reset completo", confirmText: "sim, apagar tudo", danger: true }
  );
  if (!reallySure) return;

  busy = true;
  confirmInput.disabled = true;
  resetBtn.disabled = true;
  resetBtn.textContent = "limpando...";

  try {
    await resetData(confirmation);
    // recarrega o app inteiro em vez de tentar resetar o estado em
    // memória de cada tela na mão (store.js, widgets já montados
    // etc.) — garante que tudo volte a buscar do backend já limpo.
    window.location.reload();
  } catch (err) {
    showErrorModal(err.message, "erro ao limpar dados");
    busy = false;
    confirmInput.disabled = false;
    resetBtn.disabled = false;
    resetBtn.textContent = "limpar todos os dados";
  }
}

/**
 * @param {string} [tabId] - aba pra abrir já selecionada (ver TABS).
 *   Default "aparencia" (primeira aba). backup-reminder.js passa
 *   "backup" explicitamente pra levar direto à seção de export.
 */
export async function openConfiguracoesModal(tabId = "aparencia") {
  modalEl = modalEl || buildModal();

  switchTab(modalEl, TABS.some((t) => t.id === tabId) ? tabId : "aparencia");

  const confirmInput = modalEl.querySelector("#sm-reset-confirm");
  const resetBtn = modalEl.querySelector("#sm-reset-btn");
  const exportStatusEl = modalEl.querySelector("#sm-export-status");
  confirmInput.value = "";
  resetBtn.disabled = true;
  exportStatusEl.textContent = "";
  exportStatusEl.classList.remove("settings-status--visible");

  const importFile = modalEl.querySelector("#sm-import-file");
  const importConfirmInput = modalEl.querySelector("#sm-import-confirm");
  const importBtn = modalEl.querySelector("#sm-import-btn");
  const importStatusEl = modalEl.querySelector("#sm-import-status");
  importFile.value = "";
  importConfirmInput.value = "";
  importBtn.disabled = true;
  importStatusEl.textContent = "";
  importStatusEl.classList.remove("settings-status--visible");

  const accentStatusEl = modalEl.querySelector("#cfg-accent-status");
  accentStatusEl.textContent = "";
  accentStatusEl.classList.remove("settings-status--visible");

  const nameStatusEl = modalEl.querySelector("#cfg-name-status");
  nameStatusEl.textContent = "";
  nameStatusEl.classList.remove("settings-status--visible");

  const notifStatusEl = modalEl.querySelector("#cfg-notif-status");
  notifStatusEl.textContent = "";
  notifStatusEl.classList.remove("settings-status--visible");

  // aba chaves — fecha/reseta o form de conta de e-mail (volta pro
  // estado colapsado "+ nova conta") e limpa os campos de token/chave
  // a cada abertura (mesmo padrão defensivo do resto do modal: nada de
  // valor/erro de uma sessão anterior sobrevivendo pra próxima
  // abertura).
  closeChavesForm(modalEl);
  ["cfg-gh-token-input", "cfg-search-key-input"].forEach((id) => (modalEl.querySelector("#" + id).value = ""));
  ["cfg-gh-token-error", "cfg-search-key-error"].forEach((id) => {
    modalEl.querySelector("#" + id).style.display = "none";
  });

  modalEl.classList.add("open");

  // busca o perfil atual toda vez que o modal abre — pode ter mudado
  // desde a última abertura (accent_color, nome, avatar), e tanto os
  // swatches de aparência quanto a aba perfil precisam refletir o
  // estado real, não um valor cacheado da primeira vez que o modal foi
  // construído.
  try {
    const profile = await getProfile();
    renderAccentSwatches(modalEl, profile.accent_color);
    renderPerfilTab(modalEl, profile);
    renderNotificacoesTab(modalEl, profile);
    // getProfile() aqui é a fonte mais fresca (pode ter mudado desde a
    // última abertura por outro caminho) — mantém o store sincronizado
    // igual aos outros dados de perfil, pra quem lê store.get("profile")
    // fora deste modal (notification-bell.js, notifications-modal.js).
    store.set("profile", profile);
  } catch (err) {
    showErrorModal(err.message, "erro ao carregar dados de perfil");
  }

  // idem pro status das duas credenciais com badge (token do github e
  // chave de busca) e pra lista de contas de e-mail — mesma lógica de
  // organizacao.js: pode ter mudado desde a última abertura, inclusive
  // se cadastrada/editada pelos ícones de organização em vez desta aba.
  try {
    const [ghStatus, searchStatus] = await Promise.all([getGithubTokenStatus(), getSearchKeyStatus()]);
    renderGithubBadge(modalEl, ghStatus.configured);
    renderSearchBadge(modalEl, searchStatus.configured);
  } catch (err) {
    showErrorModal(err.message, "erro ao carregar status das credenciais");
  }
  await loadChavesAccounts(modalEl);
}

export function closeConfiguracoesModal() {
  modalEl?.classList.remove("open");
}