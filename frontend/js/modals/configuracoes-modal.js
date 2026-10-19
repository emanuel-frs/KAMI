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
import { exportData, getDiagnostico, importData, resetData } from "../api/sistema.js";
import { getChave, redefinirChave } from "../api/seguranca.js";
import { copyText } from "../components/clipboard.js";
import { applyXpReview, getRecompensas, previewXpReview } from "../api/nucleo.js";
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
import { showToast } from "../components/toast.js";
import { escapeHtml, localDateKey } from "../components/format.js";
import { showErrorModal } from "./err-modal.js";
import { showConfirmModal } from "./confirm-modal.js";
import { openAvatarModal } from "./avatar-modal.js";
import { icon } from "../components/icons.js";
import { ACCENT_OPTIONS } from "../components/accent-colors.js";
import { fitAsciiText } from "../components/ascii.js";
import { store } from "../state/store.js";
import { prefersReducedMotion } from "../components/a11y.js";
import { playSound } from "../components/sound.js";

const RESET_WORD = "excluir";
const REDEFINIR_WORD = "redefinir";
const IMPORT_WORD = "importar";

const TABS = [
  { id: "aparencia", label: "aparência", iconName: "palette" },
  { id: "perfil", label: "perfil", iconName: "user" },
  { id: "notificacoes", label: "notificações", iconName: "bell" },
  { id: "chaves", label: "chaves", iconName: "key" },
  { id: "seguranca", label: "segurança", iconName: "shield" },
  { id: "backup", label: "backup e dados", iconName: "download" },
  { id: "sobre", label: "sobre", iconName: "circle-help" },
];

// CONF-06: relato de problema (templates em .github/ISSUE_TEMPLATE)
const ISSUES_URL = "https://github.com/emanuel-frs/KAMI/issues/new/choose";

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

// GAM-04 — ver components/visual-effects.js
const EFFECT_OPTIONS = [
  { value: "completo", label: "completo", desc: "tela de subida de nível, linhas de +xp e avisos" },
  { value: "sutil", label: "sutil", desc: "linhas de +xp e avisos, sem a tela cheia" },
  { value: "desligado", label: "desligado", desc: "só os avisos, sem nada animado" },
];

// GAM-13: grupos de som (components/sound.js) — coluna do perfil, rótulo, descrição
const SOUND_GROUPS = [
  { field: "som_progresso", label: "progresso", desc: "+xp, nível, LEVEL UP, conquista, missão e sequência salva" },
  { field: "som_interface", label: "interface", desc: "todo botão (com som próprio pra confirmar, apagar, abas e opções), abrir e fechar janelas, trocar de tela, a voz da kami e a abertura do app" },
  { field: "som_avisos", label: "avisos", desc: "notificações, erros, confirmações e arquivos baixados" },
];

function buildAparenciaPanel() {
  return `
    <div class="cfg-panel on" data-panel="aparencia">
      <div class="settings-section" style="padding-top:0;">
        <h4>cor de destaque</h4>
        <p class="settings-desc">usada em botões, ícones ativos, gráficos e bordas em todo o app.</p>
        <div class="ki-swatches" id="cfg-accent-swatches"></div>
        <p class="settings-status" id="cfg-accent-status"></p>
      </div>
      <div class="settings-section">
        <h4>efeitos visuais</h4>
        <p class="settings-desc">como o kami comemora seu progresso. com o sistema em "reduzir movimento", nada se mexe em nenhuma opção.</p>
        <div role="radiogroup" aria-label="efeitos visuais" id="cfg-effects">
          ${EFFECT_OPTIONS.map((o) => `
          <label class="cfg-toggle">
            <input type="radio" name="cfg-effects" value="${o.value}">
            <span>${o.label}<small>${o.desc}</small></span>
          </label>`).join("")}
        </div>
        <p class="settings-status" id="cfg-effects-status"></p>
      </div>
      <div class="settings-section">
        <h4>sons</h4>
        <p class="settings-desc">bipes 8-bit gerados na hora, no estilo terminal. cada grupo liga e desliga sozinho.</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-sound-on">
          <span>som ligado<small>liga e desliga todos os sons de uma vez</small></span>
        </label>
        <div class="cfg-sound-volume">
          <label for="cfg-sound-volume">volume</label>
          <input type="range" id="cfg-sound-volume" min="0" max="100" step="5">
          <span id="cfg-sound-volume-value" aria-hidden="true"></span>
          <button type="button" class="btn sm" id="cfg-sound-test">ouvir</button>
        </div>
        <div id="cfg-sound-groups">
          ${SOUND_GROUPS.map((g) => `
          <label class="cfg-toggle">
            <input type="checkbox" data-sound-group="${g.field}">
            <span>${g.label}<small>${g.desc}</small></span>
          </label>`).join("")}
        </div>
        <p class="settings-status" id="cfg-sound-status"></p>
      </div>
      <div class="settings-section">
        <h4>recompensas do nível</h4>
        <p class="settings-desc" id="cfg-rewards-desc">títulos e temas de terminal liberados conforme seu nível geral sobe.</p>
        <p class="cfg-subhead">título <small>(aparece sob o seu nome no perfil)</small></p>
        <div role="radiogroup" aria-label="título" id="cfg-titles"></div>
        <p class="cfg-subhead">tema de terminal <small>(por cima da cor de destaque)</small></p>
        <div role="radiogroup" aria-label="tema de terminal" id="cfg-themes"></div>
        <p class="settings-status" id="cfg-rewards-status"></p>
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
          <div class="field"><label for="cfg-acc-label">apelido</label><input type="text" id="cfg-acc-label" placeholder="ex: gmail pessoal"></div>
          <div class="field-row">
            <div class="field"><label for="cfg-acc-host">host imap</label><input type="text" id="cfg-acc-host" placeholder="imap.gmail.com"></div>
            <div class="field" style="max-width:110px;"><label for="cfg-acc-port">porta</label><input type="number" id="cfg-acc-port" value="993"></div>
          </div>
          <div class="field"><label for="cfg-acc-username">usuário</label><input type="text" id="cfg-acc-username" placeholder="voce@gmail.com"></div>
          <div class="field"><label for="cfg-acc-password">senha de app <span id="cfg-acc-password-hint" style="color:var(--text-faint); font-size:9.5px;"></span></label><input type="password" id="cfg-acc-password" placeholder="••••••••"></div>
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
      <div class="settings-section">
        <h4>revisar xp</h4>
        <p class="settings-desc">corrige o xp gravado antes das regras atuais: registros que sobraram de ações desfeitas (pagamento desmarcado, item apagado, marco reaberto), repetições no mesmo dia do que hoje só rende xp 1x por dia e ações manuais acima de 50 xp. primeiro mostra o que mudaria — nada é gravado até você confirmar.</p>
        <p class="settings-note">antes de aplicar, uma cópia completa do banco é guardada na pasta de dados do kami.</p>
        <div class="form-actions">
          <button class="btn sm" id="sm-xpreview-btn" data-action="xp-review-preview">simular revisão</button>
        </div>
        <div class="xp-review-report" id="sm-xpreview-report" hidden></div>
      </div>
      <div class="settings-section settings-warning">
        <h4>importar dados</h4>
        <p class="settings-desc">restaura um backup .json exportado anteriormente. isso <strong>sobrescreve</strong> todas as suas configurações e dados atuais (perfil, núcleo, finanças, aprendizado, organização, metas) — não tem como desfazer depois.</p>
        <p class="settings-note">nota: senha de e-mail, token do github e chave de busca são salvos criptografados com uma chave que fica só nesta instalação. se este backup for de <strong>outra máquina</strong>, esses três campos não vêm junto — o resto dos dados restaura normalmente, mas você vai precisar reconfigurar essas credenciais em organização.</p>
        <div class="field">
          <label for="sm-import-file">arquivo de backup (.json)</label>
          <input type="file" id="sm-import-file" accept="application/json,.json">
        </div>
        <div class="field">
          <label for="sm-import-confirm">digite <strong>${IMPORT_WORD}</strong> pra habilitar o botão abaixo</label>
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
          <label for="sm-reset-confirm">digite <strong>${RESET_WORD}</strong> pra habilitar o botão abaixo</label>
          <input type="text" id="sm-reset-confirm" placeholder="${RESET_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm danger" id="sm-reset-btn" data-action="reset" disabled>limpar todos os dados</button>
        </div>
      </div>
    </div>`;
}

// ── aba segurança (SEG-01) ─────────────────────────────────────────────
// Onde está a chave que abre as senhas salvas (senha de app do e-mail,
// token do github, chave da busca): no cofre do sistema (o normal), num
// arquivo (sistema sem cofre) ou indisponível (o cofre perdeu a chave —
// aí a única saída é redefinir, apagando esses segredos). Ver app/crypto.py.
function buildSegurancaPanel() {
  return `
    <div class="cfg-panel" data-panel="seguranca">
      <div class="settings-section" style="padding-top:0;">
        <h4>senhas salvas</h4>
        <p class="settings-desc">a senha de app do e-mail, o token do github e a chave da busca ficam cifrados no banco. a chave que abre esses dados fica:</p>
        <p class="cfg-seg-chave" id="cfg-seg-chave">verificando…</p>
        <p class="settings-status" id="cfg-seg-status"></p>
        <p class="settings-note">a chave não vai junto quando a pasta de dados é copiada pra outro computador — lá, essas senhas precisam ser informadas de novo.</p>
      </div>
      <div class="settings-section settings-danger" id="cfg-seg-redefinir" hidden>
        <h4>redefinir a chave</h4>
        <p class="settings-desc" id="cfg-seg-redefinir-desc"></p>
        <div class="field">
          <label for="cfg-seg-confirm">digite <strong>${REDEFINIR_WORD}</strong> pra habilitar o botão abaixo</label>
          <input type="text" id="cfg-seg-confirm" placeholder="${REDEFINIR_WORD}" autocomplete="off">
        </div>
        <div class="form-actions">
          <button class="btn sm danger" id="cfg-seg-redefinir-btn" disabled>redefinir chave</button>
        </div>
      </div>
    </div>`;
}

function describeChave(estado) {
  if (estado.local === "cofre") {
    return `${icon("check", { size: 12 })} no cofre do sistema (${escapeHtml(estado.cofre)}) — quem copiar a pasta de dados não leva a chave junto.`;
  }
  if (estado.local === "arquivo") {
    return `<span class="cfg-seg-warn">[!]</span> num arquivo na pasta de dados — ${escapeHtml(estado.motivo || "o sistema não tem cofre")}. funciona, mas quem copiar a pasta leva a chave junto.`;
  }
  return `<span class="cfg-seg-warn">[!]</span> indisponível — ${escapeHtml(estado.motivo || "o cofre não entregou a chave")}. as senhas salvas não podem ser lidas até a chave voltar.`;
}

async function loadSeguranca(wrap) {
  const el = wrap.querySelector("#cfg-seg-chave");
  const redefinir = wrap.querySelector("#cfg-seg-redefinir");
  try {
    const estado = await getChave();
    el.innerHTML = describeChave(estado);
    el.dataset.local = estado.local;
    redefinir.hidden = estado.local !== "indisponivel";
    const n = estado.segredos_salvos;
    const perda =
      n === 0
        ? "não há senha salva agora, então nada é apagado."
        : `${n === 1 ? "a senha salva é apagada" : `as ${n} senhas salvas são apagadas`} e precisa${n === 1 ? "" : "m"} ser informada${n === 1 ? "" : "s"} de novo em configurações › chaves.`;
    wrap.querySelector("#cfg-seg-redefinir-desc").textContent =
      `se o cofre não vai mais devolver a chave (outro computador, outro ambiente gráfico, cofre apagado), dá pra criar uma chave nova. ${perda} o resto dos dados não muda.`;
  } catch (err) {
    el.textContent = `não deu pra verificar: ${err.message}`;
  }
}

function wireSegurancaTab(wrap) {
  wrap.querySelector('.cfg-tab[data-tab="seguranca"]').addEventListener("click", () => loadSeguranca(wrap));
  const input = wrap.querySelector("#cfg-seg-confirm");
  const btn = wrap.querySelector("#cfg-seg-redefinir-btn");
  input.addEventListener("input", () => {
    btn.disabled = input.value.trim().toLowerCase() !== REDEFINIR_WORD;
  });
  btn.addEventListener("click", async () => {
    const status = wrap.querySelector("#cfg-seg-status");
    btn.disabled = true;
    try {
      const res = await redefinirChave(input.value.trim().toLowerCase());
      input.value = "";
      status.innerHTML = `${icon("check", { size: 12 })} chave nova criada${res.segredos_apagados ? ` — informe de novo em configurações › chaves ${res.segredos_apagados === 1 ? "a senha apagada" : `as ${res.segredos_apagados} senhas apagadas`}` : ""}.`;
      status.classList.add("settings-status--visible");
      await loadSeguranca(wrap);
    } catch (err) {
      showErrorModal(err.message, "não deu pra redefinir a chave");
      btn.disabled = false;
    }
  });
}

// ── aba sobre (CONF-06) ────────────────────────────────────────────────
// Versão do app e o "copiar diagnóstico": versão, sistema, tamanho do
// banco e o fim do kami-backend.log, montado no BACKEND já sem dado
// pessoal (e-mails, chaves, senhas, valores e a pasta pessoal saem —
// ver routers/sistema.py::anonimizar). A prévia mostra exatamente o que
// vai ser copiado/salvo, pra pessoa conferir antes de colar num relato.
function buildSobrePanel() {
  return `
    <div class="cfg-panel" data-panel="sobre">
      <div class="settings-section" style="padding-top:0;">
        <h4>kami</h4>
        <p class="settings-desc" id="cfg-sobre-versao">versão —</p>
      </div>
      <div class="settings-section">
        <h4>diagnóstico</h4>
        <p class="settings-desc">quando algo der errado, o diagnóstico junta a versão, o sistema e o fim do log do kami num texto pronto pra colar num relato de problema. e-mails, chaves, senhas, valores em R$ e o nome da sua pasta pessoal saem antes — confira abaixo o que vai.</p>
        <div class="form-actions">
          <button class="btn sm" id="cfg-diag-copy">copiar diagnóstico</button>
          <button class="btn sm" id="cfg-diag-save">salvar .txt</button>
          <button class="btn sm" id="cfg-diag-folder" hidden>abrir pasta do log</button>
          <button class="btn sm" id="cfg-diag-report" data-open-link="${ISSUES_URL}">relatar um problema</button>
        </div>
        <p class="settings-status" id="cfg-diag-status"></p>
        <pre class="cfg-diag-preview" id="cfg-diag-preview" tabindex="0" aria-label="prévia do diagnóstico">carregando…</pre>
      </div>
    </div>`;
}

let diagText = "";

async function loadDiagnostico(wrap) {
  const pre = wrap.querySelector("#cfg-diag-preview");
  try {
    const diag = await getDiagnostico();
    diagText = `${diag.texto}\n\n--- tela ---\n${navigator.userAgent}`;
    wrap.querySelector("#cfg-sobre-versao").textContent = `versão ${diag.versao}`;
    pre.textContent = diagText;
  } catch (err) {
    diagText = "";
    pre.textContent = `não deu pra gerar o diagnóstico: ${err.message}`;
  }
}

function diagStatus(wrap, html) {
  const el = wrap.querySelector("#cfg-diag-status");
  el.innerHTML = html;
  el.classList.add("settings-status--visible");
}

function wireSobreTab(wrap) {
  wrap.querySelector('.cfg-tab[data-tab="sobre"]').addEventListener("click", () => loadDiagnostico(wrap));
  wrap.querySelector("#cfg-diag-copy").addEventListener("click", async () => {
    if (!diagText) await loadDiagnostico(wrap);
    const ok = diagText && (await copyText(diagText));
    diagStatus(wrap, ok ? `${icon("check", { size: 12 })} diagnóstico copiado` : "não deu pra copiar — selecione o texto abaixo e copie à mão");
  });
  wrap.querySelector("#cfg-diag-save").addEventListener("click", async () => {
    if (!diagText) await loadDiagnostico(wrap);
    if (!diagText) return;
    const url = URL.createObjectURL(new Blob([diagText], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    const filename = `kami-diagnostico-${localDateKey()}.txt`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    diagStatus(wrap, `${icon("check", { size: 12 })} salvo como ${escapeHtml(filename)} (confira sua pasta de downloads)`);
  });
  // abrir a pasta é do app instalado (comando do Rust, CONF-02) — no navegador de dev não existe
  const folderBtn = wrap.querySelector("#cfg-diag-folder");
  if (window.__TAURI__?.core?.invoke) {
    folderBtn.hidden = false;
    folderBtn.addEventListener("click", async () => {
      try {
        await window.__TAURI__.core.invoke("open_log_folder");
      } catch (err) {
        showErrorModal(String(err), "não deu pra abrir a pasta");
      }
    });
  }
}

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "settings-modal";
  wrap.innerHTML = `
    <div class="modal cfg-modal">
      <div class="modal-head">configurações <button type="button" class="close" data-action="close" aria-label="fechar">${icon("x")}</button></div>
      <div class="modal-body cfg-shell">
        <nav class="cfg-sidebar">${buildTabsHtml()}</nav>
        <div class="cfg-content">
          ${buildAparenciaPanel()}
          ${buildPerfilPanel()}
          ${buildNotificacoesPanel()}
          ${buildChavesPanel()}
          ${buildSegurancaPanel()}
          ${buildBackupPanel()}
          ${buildSobrePanel()}
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
  wrap.querySelector("#cfg-effects").addEventListener("change", (e) => selectEffectsMode(wrap, e.target.value));
  wrap.querySelector("#cfg-sound-on").addEventListener("change", (e) => saveSound(wrap, { som_ativo: e.target.checked }));
  wrap.querySelector("#cfg-sound-groups").addEventListener("change", (e) =>
    saveSound(wrap, { [e.target.dataset.soundGroup]: e.target.checked })
  );
  const volume = wrap.querySelector("#cfg-sound-volume");
  volume.addEventListener("input", () => {
    wrap.querySelector("#cfg-sound-volume-value").textContent = volume.value;
  });
  // salva ao soltar (change), não a cada passo do arrasto (input)
  volume.addEventListener("change", () => saveSound(wrap, { som_volume: Number(volume.value) }));
  wrap.querySelector("#cfg-sound-test").addEventListener("click", () => playSound("conquista", { force: true }));
  wrap.querySelector("#cfg-titles").addEventListener("change", (e) => selectReward(wrap, "titulo", e.target.value));
  wrap.querySelector("#cfg-themes").addEventListener("change", (e) => selectReward(wrap, "tema", e.target.value));
  wireBackupTab(wrap);
  wireSegurancaTab(wrap);
  wireSobreTab(wrap);

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
    const isSel = c.value === currentColor;
    const sel = isSel ? " ki-swatch--sel" : "";
    const check = icon("check", { size: 12, className: "swatch-check" });
    return `<button type="button" class="ki-swatch${sel}" data-color="${c.value}" data-tooltip="${c.label}" style="--swatch-color:${c.value};" aria-label="${c.label}" aria-pressed="${isSel}">${check}</button>`;
  }).join("");

  container.querySelectorAll(".ki-swatch").forEach((btn) => {
    btn.addEventListener("click", () => selectAccentColor(wrap, btn));
  });
}

function renderEffectsOptions(wrap, current) {
  wrap.querySelectorAll('input[name="cfg-effects"]').forEach((input) => {
    input.checked = input.value === (current || "completo");
  });
}

async function selectEffectsMode(wrap, value) {
  const statusEl = wrap.querySelector("#cfg-effects-status");
  statusEl.classList.remove("settings-status--visible");
  try {
    await updateProfile({ efeitos_visuais: value });
  } catch (err) {
    showErrorModal(err.message, "erro ao salvar efeitos visuais");
    renderEffectsOptions(wrap, store.get("profile")?.efeitos_visuais);
    return;
  }
  store.set("profile", { ...store.get("profile"), efeitos_visuais: value });
  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}

// ── sons (GAM-13) ──────────────────────────────────────────────────────
function renderSoundOptions(wrap, profile) {
  wrap.querySelector("#cfg-sound-on").checked = Boolean(profile.som_ativo);
  wrap.querySelector("#cfg-sound-volume").value = profile.som_volume ?? 60;
  wrap.querySelector("#cfg-sound-volume-value").textContent = profile.som_volume ?? 60;
  wrap.querySelectorAll("[data-sound-group]").forEach((input) => {
    input.checked = Boolean(profile[input.dataset.soundGroup]);
  });
  syncSoundDisabled(wrap);
}

// com o som desligado, volume e grupos ficam visíveis mas desabilitados
function syncSoundDisabled(wrap) {
  const on = wrap.querySelector("#cfg-sound-on").checked;
  wrap.querySelectorAll("#cfg-sound-volume, [data-sound-group]").forEach((el) => (el.disabled = !on));
}

async function saveSound(wrap, change) {
  const statusEl = wrap.querySelector("#cfg-sound-status");
  statusEl.classList.remove("settings-status--visible");
  syncSoundDisabled(wrap);
  let saved;
  try {
    saved = await updateProfile(change);
  } catch (err) {
    showErrorModal(err.message, "erro ao salvar sons");
    renderSoundOptions(wrap, store.get("profile") ?? {});
    return;
  }
  const fields = ["som_ativo", "som_volume", "som_progresso", "som_interface", "som_avisos"];
  store.set("profile", { ...store.get("profile"), ...Object.fromEntries(fields.map((f) => [f, saved[f]])) });
  // ao ligar, um bipe confirma que o áudio está funcionando
  if (change.som_ativo) playSound("aviso", { force: true });
  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}

// ── recompensas do nível (GAM-10) ──────────────────────────────────────
// Título e tema de terminal liberados pelo nível geral (catálogo e regra em
// backend/app/recompensas.py). O que ainda não foi liberado aparece
// desabilitado com "nível N" — dá pra ver o que vem pela frente.
function rewardOption(name, item, checked) {
  const lock = item.unlocked ? "" : ` · liberado no nível ${item.level}`;
  const desc = item.description ? `${item.description}${lock}` : lock.replace(/^ · /, "");
  return `
    <label class="cfg-toggle${item.unlocked ? "" : " cfg-toggle--locked"}">
      <input type="radio" name="${name}" value="${escapeHtml(item.key)}"${checked ? " checked" : ""}${item.unlocked ? "" : " disabled"}>
      <span>${escapeHtml(item.label)}${desc ? `<small>${escapeHtml(desc)}</small>` : ""}</span>
    </label>`;
}

async function renderRewards(wrap, profile) {
  let data;
  try {
    data = await getRecompensas();
  } catch {
    wrap.querySelector("#cfg-rewards-desc").textContent = "não deu pra carregar as recompensas agora.";
    return;
  }
  wrap.querySelector("#cfg-rewards-desc").textContent =
    `títulos e temas de terminal liberados conforme seu nível geral sobe — você está no nível ${data.level}.`;
  const auto = { key: "auto", label: "automático", description: "o título mais alto que você já liberou", unlocked: true };
  wrap.querySelector("#cfg-titles").innerHTML = [auto, ...data.titulos]
    .map((t) => rewardOption("cfg-title", t, (profile.titulo ?? "auto") === t.key))
    .join("");
  wrap.querySelector("#cfg-themes").innerHTML = data.temas
    .map((t) => rewardOption("cfg-theme", t, (profile.tema ?? "padrao") === t.key))
    .join("");
}

async function selectReward(wrap, field, value) {
  const statusEl = wrap.querySelector("#cfg-rewards-status");
  statusEl.classList.remove("settings-status--visible");
  let saved;
  try {
    saved = await updateProfile({ [field]: value });
  } catch (err) {
    showErrorModal(err.message, "erro ao salvar recompensa");
    renderRewards(wrap, store.get("profile") ?? {});
    return;
  }
  // o tema vale na hora (components/tema.js escuta o store); o título
  // aparece no card de perfil (widgets/profile.js também escuta)
  store.set("profile", { ...store.get("profile"), titulo: saved.titulo, tema: saved.tema });
  statusEl.innerHTML = `${icon("check", { size: 12 })} salvo`;
  statusEl.classList.add("settings-status--visible");
}

async function selectAccentColor(wrap, btn) {
  if (busy) return;
  const statusEl = wrap.querySelector("#cfg-accent-status");
  const color = btn.dataset.color;

  wrap.querySelectorAll(".ki-swatch").forEach((b) => {
    const isSel = b === btn;
    b.classList.toggle("ki-swatch--sel", isSel);
    b.setAttribute("aria-pressed", String(isSel));
  });
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
  } catch (_) {
    // ajuste de tamanho do ASCII é só cosmético — se falhar, o texto
    // fica no tamanho padrão (CONF-01: silêncio de propósito)
  }
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
    formWrap.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
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
  wrap.querySelector("#sm-xpreview-btn").addEventListener("click", () => handleXpReviewPreview(wrap));
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
    const today = localDateKey();
    const filename = `kami-backup-${today}.json`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusEl.innerHTML = `${icon("check", { size: 12 })} salvo como ${filename} (confira sua pasta de downloads)`;
    statusEl.classList.add("settings-status--visible");

    // confirmação visível mesmo se o usuário já tiver trocado de aba/fechado
    // o modal antes de reparar no status inline acima — ponto levantado na
    // auditoria (download acontece em silêncio, sem feedback destacado).
    // Sem integração de diálogo "salvar como" nativo do Tauri no projeto
    // (só existe o plugin de abrir URL externa, ver open-external.js), então
    // o toast simples resolve — o navegador/webview decide onde salvar.
    showToast({
      title: "backup salvo",
      message: `${filename} — confira sua pasta de downloads`,
      iconName: "check",
    });
  } catch (err) {
    showErrorModal(err.message, "erro ao exportar dados");
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

const XP_REVIEW_LIST_LIMIT = 12;

function renderXpReviewReport(report) {
  const changedAttrs = report.atributos.filter((a) => a.xp_antes !== a.xp_depois);
  const nothing =
    !report.removidos.length && !report.limitados.length && !changedAttrs.length && !report.vinculados &&
    !report.conquistas_rebloqueadas.length && !report.conquistas_desbloqueadas.length;
  if (nothing) {
    return '<p class="settings-desc">nada a corrigir — seu xp já está consistente.</p>';
  }

  const lines = [];
  lines.push(
    `<p class="settings-desc">${report.removidos.length} registro(s) removido(s) · ${report.vinculados} vinculado(s) ao item de origem · ${report.limitados.length} ação(ões) manual(is) limitada(s) a 50 xp</p>`
  );
  if (changedAttrs.length) {
    lines.push(
      `<ul class="xp-review-list">${changedAttrs
        .map((a) => `<li><span>${escapeHtml(a.nome)}</span><span>${a.xp_antes} → ${a.xp_depois} xp</span></li>`)
        .join("")}</ul>`
    );
  }
  if (report.conquistas_rebloqueadas.length) {
    lines.push(`<p class="settings-note">voltam a ficar bloqueadas: ${report.conquistas_rebloqueadas.map(escapeHtml).join(", ")}</p>`);
  }
  if (report.conquistas_desbloqueadas.length) {
    lines.push(`<p class="settings-note">serão desbloqueadas: ${report.conquistas_desbloqueadas.map(escapeHtml).join(", ")}</p>`);
  }
  if (report.removidos.length) {
    const shown = report.removidos.slice(0, XP_REVIEW_LIST_LIMIT);
    const rest = report.removidos.length - shown.length;
    lines.push(
      `<ul class="xp-review-list xp-review-list--removed">${shown
        .map((r) => `<li><span>${escapeHtml(r.description)}</span><span>−${r.xp} xp · ${escapeHtml(r.motivo)}</span></li>`)
        .join("")}${rest > 0 ? `<li class="xp-review-more">+${rest} outro(s)</li>` : ""}</ul>`
    );
  }
  lines.push(`
    <div class="form-actions">
      <button class="btn sm warn" id="sm-xpreview-apply" data-action="xp-review-apply">aplicar revisão</button>
    </div>`);
  return lines.join("");
}

async function handleXpReviewPreview(wrap) {
  if (busy) return;
  const btn = wrap.querySelector("#sm-xpreview-btn");
  const reportEl = wrap.querySelector("#sm-xpreview-report");
  busy = true;
  btn.disabled = true;
  btn.textContent = "simulando...";
  try {
    const report = await previewXpReview();
    reportEl.innerHTML = renderXpReviewReport(report);
    reportEl.hidden = false;
    reportEl.querySelector("#sm-xpreview-apply")?.addEventListener("click", () => handleXpReviewApply(wrap));
  } catch (err) {
    showErrorModal(err.message, "erro ao simular a revisão de xp");
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = "simular revisão";
  }
}

async function handleXpReviewApply(wrap) {
  if (busy) return;
  const reallySure = await showConfirmModal(
    "isso remove os registros listados e recalcula o xp de cada atributo a partir do log. uma cópia do banco é guardada antes, na pasta de dados do kami. continuar?",
    { title: "aplicar revisão de xp", confirmText: "sim, revisar" }
  );
  if (!reallySure) return;

  const applyBtn = wrap.querySelector("#sm-xpreview-apply");
  busy = true;
  applyBtn.disabled = true;
  applyBtn.textContent = "aplicando...";
  try {
    const report = await applyXpReview();
    showToast({
      title: "xp revisado",
      message: `cópia do banco anterior: ${report.backup}`,
      iconName: "check",
      duration: 12000,
    });
    // mesmo motivo de handleImport: xp/níveis/conquistas mudam em todas as
    // telas de uma vez — recarregar é mais seguro que atualizar cada widget
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    showErrorModal(err.message, "erro ao aplicar a revisão de xp");
    busy = false;
    applyBtn.disabled = false;
    applyBtn.textContent = "aplicar revisão";
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
    renderEffectsOptions(modalEl, profile.efeitos_visuais);
    renderSoundOptions(modalEl, profile);
    renderRewards(modalEl, profile);
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