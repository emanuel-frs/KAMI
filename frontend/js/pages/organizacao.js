/**
 * pages/organizacao.js — módulo Organização (v1).
 *
 * Três abas: links, github, e-mail — espelha os três "tipos de fonte" do
 * router (app/routers/organizacao/). Layout fixo (não usa o grid
 * configurável de dashboard_widgets — só Perfil e Núcleo usam isso).
 *
 * Contrato de app.js: mount(container) / unmount(). container é o
 * #page-root persistente — o próprio nó NUNCA é recriado entre
 * navegações, só o innerHTML muda. Por isso os listeners de clique são
 * guardados numa referência de módulo e removidos no unmount (e também
 * defensivamente no início do mount): sem isso, cada vez que a pessoa
 * volta pra essa tela um novo listener se acumula no mesmo nó e cada
 * clique passa a disparar a ação N vezes (foi exatamente o bug dos "4
 * repositórios" e é a causa raiz de qualquer coisa que pareça "às vezes
 * duplica" nesse arquivo).
 *
 * V1 NÃO inclui (ver kami_projeto.txt, seção 0.1):
 *   - resumo de e-mail por IA — o corpo mostrado é sempre o
 *     body_preview em texto puro que já vem do backend
 *
 * Busca (ver ALINHAMENTO.md 4.1): resumo inline via tavily
 * (GET /api/organizacao/search), com chave pessoal opcional-mas-
 * obrigatória-pra-funcionar (mesmo padrão do token do github —
 * configurada no modal de "ícone de engrenagem (chave de busca)"). Sem
 * chave configurada
 * ou em caso de erro, o painel de resultado mostra um link pra
 * configurar a chave (ou pra abrir a busca direto no DuckDuckGo, que
 * continua disponível como fallback sem precisar de nenhuma chave).
 */
import { fmtDataHora } from "../components/format.js";
import * as api from "../api/organizacao.js";
import { openExternal } from "../components/open-external.js";
import { icon } from "../components/icons.js";
import { store } from "../state/store.js";
import { maybeStartOrganizacaoTips, replayOrganizacaoTips } from "./organizacao-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";
import { subscribeSyncState, isSyncRunning } from "../components/email-sync-scheduler.js";
import { closeEmailLeitor } from "../modals/email-leitor-modal.js";
import { montarNotas, desmontarNotas, focarNotas } from "./organizacao-notas.js";
import { montarEntrada, desmontarEntrada } from "./organizacao-entrada.js";
import {
  loadSearchKeyStatus,
  renderSearchKeyBadge,
  openSearchKeyModal,
  closeSearchKeyModal,
  handleSaveSearchKey,
  handleDeleteSearchKey,
  orgSearchClear,
  orgSearchRun,
} from "./organizacao-busca.js";
import {
  loadLinks,
  renderLinks,
  openLinkModal,
  closeLinkModal,
  handleSaveLink,
  handleDeleteLink,
} from "./organizacao-links.js";
import {
  loadRepos,
  renderRepos,
  openRepoModal,
  closeRepoModal,
  handleAddRepo,
  handleSyncRepo,
  handleDeleteRepo,
  loadGithubTokenStatus,
  renderGithubTokenBadge,
  openGithubTokenModal,
  closeGithubTokenModal,
  handleSaveGithubToken,
  handleDeleteGithubToken,
} from "./organizacao-github.js";
import {
  esquecerSelecaoDeContas,
  loadAccounts,
  renderAccounts,
  openManageAccountsModal,
  closeManageAccountsModal,
  renderAccountChips,
  toggleAccountChip,
  handleToggleDefaultAccount,
  setEmailFilter,
  renderSyncButton,
  handleSyncSelectedAccounts,
  openAccountModal,
  closeAccountModal,
  handleSaveAccount,
  handleDeleteAccount,
  handleSyncAccount,
  loadEmailsForSelectedAccounts,
  loadMutedAccounts,
  renderEmails,
  openEmailModal,
  handleToggleMuteAccount,
} from "./organizacao-email.js";

export const state = {
  tab: "notas", // ORG-01 (P-30): notas é a primeira aba
  links: [],
  repos: [],
  accounts: [],
  // redesign da aba e-mail (plano-email-organizacao.md) — várias contas
  // podem estar ativas na visualização combinada ao mesmo tempo, em vez
  // de uma única conta selecionada.
  selectedAccountIds: new Set(),
  emails: [], // já mesclado de todas as contas em selectedAccountIds, ordenado por received_at desc
  emailQuery: "",   // busca client-side (assunto/remetente/prévia) sobre state.emails
  emailFilter: "all", // "all" | "unread" | "muted"
  mutedAccounts: [], // [{id, account_id, muted_at}] — precisa do id pra poder dessilenciar
  syncingAccounts: new Set(), // ids de conta com sync manual em andamento — feedback visual (botão travado + ícone girando)
  schedulerSyncing: false, // reflete email-sync-scheduler.js (isRunning) — sync automático global em andamento
  githubTokenConfigured: false,
  commitActivity: {},
  searchKeyConfigured: false,
  searching: false,
  searchResult: null,   // { query, answer, results } da última busca com sucesso
  searchError: null,    // { message, query } da última tentativa com erro
};

export let rootEl = null;
let clickHandler = null;
// dicas contextuais (etapa 5) — mesmo padrão de núcleo/perfil/finanças/metas
let unsubscribeProfile = null;
let currentReplayFn = null;
let unsubscribeSyncState = null;
// reflete e-mails marcados como lidos em outro lugar (hoje só "marcar
// todos como lidos" do modal de notificações) na hora, se esta tela já
// estiver montada — mesmo padrão de store usado em accent_color/nome/
// avatar do perfil (settings-modal.js + widgets/profile.js), só que
// aqui o valor publicado é a lista de ids marcados, não um objeto de
// perfil inteiro.
let unsubscribeEmailsRead = null;

/**
 * @param {HTMLElement} container
 * @param {{ tab?: string, accountId?: string, focusEmailId?: string, focusSearch?: boolean }} [opts] -
 *   ver components/navigate.js. Usado pelo modal de notificações
 *   (modals/notificacoes-modal.js) pra abrir Organização já na aba de
 *   e-mail, com a conta certa selecionada e o e-mail clicado aberto —
 *   sem isso o clique caía sempre na aba "links" (bug reportado: botões
 *   de ver/silenciar iam pra Organização, mas na aba errada).
 *   `focusSearch` é usado pelo atalho global Alt+B (components/global-
 *   shortcuts.js) pra dar foco em #org-search direto — o campo fica
 *   fora das abas (sempre visível), então não precisa de `tab` junto.
 */
export async function mount(container, opts) {
  rootEl = container;

  // defensivo: se por algum motivo unmount não rodou da última vez,
  // não deixa acumular listener no nó persistente.
  if (clickHandler) container.removeEventListener("click", clickHandler);

  container.innerHTML = template();
  bindEvents(container);
  // notas: monta já (é a primeira aba); o resto carrega em paralelo
  // (nota pedida por outra tela — opts.notaId/novaNota — abre no applyFocus)
  const notasProntas = montarNotas(container.querySelector("#org-panel-notas"));
  const entradaPronta = montarEntrada(container.querySelector("#org-panel-entrada"), (n) => {
    const c = rootEl?.querySelector("#org-entrada-contagem");
    if (c) c.textContent = n ? `(${n})` : "";
  });

  // saiu da tela no meio do carregamento (unmount zera rootEl): para aqui.
  // Sem isso o resto do mount rodava com rootEl null e o erro aparecia na
  // tela seguinte ("algo deu errado nesta tela" no calendário).
  const saiu = () => rootEl !== container;

  await Promise.all([notasProntas, entradaPronta, loadLinks(), loadRepos(), loadAccounts(), loadGithubTokenStatus(), loadSearchKeyStatus(), loadMutedAccounts()]);
  if (saiu()) return;
  renderLinks();
  renderRepos();
  renderAccountChips();
  await loadEmailsForSelectedAccounts();
  if (saiu()) return;
  renderEmails();
  renderGithubTokenBadge();
  renderSearchKeyBadge();
  renderSyncButton();

  maybeStartOrganizacaoTips();
  unsubscribeProfile = store.subscribe("profile", () => maybeStartOrganizacaoTips());
  unsubscribeEmailsRead = store.subscribe("emailsMarkedRead", (ids) => applyEmailsMarkedRead(ids));

  // ponto 7 do plano: se o sync automático global já estiver rodando
  // no instante em que a tela monta (ex: app acabou de abrir e o tick
  // imediato do scheduler ainda não terminou), o botão "sincronizar"
  // já nasce travado/girando — e assim que terminar, recarrega a lista.
  state.schedulerSyncing = isSyncRunning();
  renderSyncButton();
  unsubscribeSyncState = subscribeSyncState(async (running) => {
    const wasRunning = state.schedulerSyncing;
    state.schedulerSyncing = running;
    renderSyncButton();
    if (wasRunning && !running) {
      // recarrega as contas também: é aqui que a falha da sincronização
      // automática (senha/login) aparece na faixa de aviso (ORG-06)
      await Promise.all([loadAccounts(), loadEmailsForSelectedAccounts()]);
      if (!rootEl) return;
      renderAccountChips();
      renderAccounts();
      renderEmails();
    }
  });

  // etapa 6: expõe o replay pro botão de ajuda global (screen-tips-registry.js)
  currentReplayFn = () => replayOrganizacaoTips();
  registerScreenTipsReplay(currentReplayFn);

  await applyFocus(opts);
}

/**
 * Chamado por app.js (showPage) quando Organização já está montada e
 * alguém pede foco de novo (ex: clicou em outro item do modal de
 * notificações sem sair da tela) — mesma lógica de mount(), só sem
 * remontar o template/recarregar tudo do zero.
 */
export async function focus(opts) {
  await applyFocus(opts);
}

async function applyFocus(opts) {
  if (!opts) return;
  if (opts.tab) switchTab(opts.tab);
  if (opts.tab === "notas" && (opts.notaId || opts.novaNota || opts.vinculo)) await focarNotas(opts);
  if (opts.focusSearch) {
    // campo de busca fica acima das abas, sempre visível — não depende
    // de qual aba (github/e-mail/links) estava selecionada antes.
    // Duplo requestAnimationFrame: um único rAF ainda cai no mesmo frame
    // em que o layout/paint do WebKitGTK (Tauri no Linux) ainda não
    // terminou de assentar depois do innerHTML/render — .focus() roda
    // mas não "pega" (o elemento ainda não é considerado focável pelo
    // engine nesse instante), então o Alt+B navegava/trocava de aba sem
    // de fato focar o input, obrigando a clicar nele manualmente.
    // Esperar dois frames garante que o primeiro paint já assentou antes
    // de tentar focar.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => rootEl?.querySelector("#org-search")?.focus());
    });
  }
  if (opts.focusEmailId) {
    // adiciona a conta-alvo à visualização combinada (sem remover as
    // outras que já estavam ativas) e recarrega sempre os e-mails
    // mesclados — mesmo se a conta já estivesse selecionada, os
    // e-mails dela podem não estar em state.emails ainda (ex: mount()
    // acabou de rodar e loadEmailsForSelectedAccounts() daquele load
    // inicial ainda não incluía essa conta). Recarregar aqui é barato
    // (uma consulta por conta selecionada) e elimina qualquer suposição
    // frágil sobre o que já está carregado — sem isso, openEmailModal()
    // abaixo poderia não achar o e-mail (falha silenciosa, via `if
    // (!email) return`).
    if (opts.accountId) {
      state.selectedAccountIds.add(opts.accountId);
      renderAccountChips();
      await loadEmailsForSelectedAccounts();
      renderEmails();
    }
    openEmailModal(opts.focusEmailId);
  }
}

/**
 * Recarrega contas silenciadas + e-mails (é o backend que calcula
 * `is_muted` por e-mail a partir de muted_accounts, então só recarregar
 * o array antigo com renderEmails() não bastava — o item continuava com
 * o is_muted de antes de silenciar) e redesenha — chamado por
 * modals/notificacoes-modal.js depois de silenciar uma conta por lá,
 * pra essa tela refletir na hora se já estiver montada, em vez de só
 * atualizar no próximo mount() (sair/entrar na tela).
 */
export async function refreshMutedAccounts() {
  if (!rootEl) return; // tela não está montada — nada a atualizar agora
  await loadMutedAccounts();
  await loadEmailsForSelectedAccounts();
  renderAccounts();
  renderEmails();
}

/**
 * Marca localmente como lidos os e-mails cujos ids vieram do store
 * "emailsMarkedRead" (publicado por modals/notificacoes-modal.js ao
 * clicar em "marcar todos como lidos") — sem isso, essa tela só
 * refletiria a mudança no próximo mount() (sair/entrar de novo).
 * Reflete só o que já está em state.emails; nada aqui obriga um
 * recarregamento do backend, já que quem marcou já fez a chamada
 * PUT /email-cache/{id}/read por conta própria.
 */
function applyEmailsMarkedRead(ids) {
  if (!rootEl || !ids || !ids.length) return; // tela não está montada — nada a atualizar agora
  const idSet = new Set(ids);
  let changed = false;
  state.emails.forEach((e) => {
    if (idSet.has(e.id) && !e.is_read) {
      e.is_read = true;
      changed = true;
    }
  });
  if (changed) renderEmails();
}

export function unmount() {
  cancelActiveTipSequence();
  closeEmailLeitor();
  desmontarNotas();
  desmontarEntrada();
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  unsubscribeEmailsRead?.();
  unsubscribeEmailsRead = null;
  if (currentReplayFn) clearScreenTipsReplay(currentReplayFn);
  currentReplayFn = null;
  unsubscribeSyncState?.();
  unsubscribeSyncState = null;
  if (rootEl && clickHandler) rootEl.removeEventListener("click", clickHandler);
  clickHandler = null;
  rootEl = null;
  state.tab = "notas";
  state.selectedAccountIds = new Set();
  state.emails = [];
  state.emailQuery = "";
  state.emailFilter = "all";
  state.mutedAccounts = [];
  state.schedulerSyncing = false;
  state.searching = false;
  state.searchResult = null;
  state.searchError = null;
  esquecerSelecaoDeContas();
}

/* ==================== template ==================== */

function template() {
  return `
    <div class="search-row">
      <input type="text" id="org-search" placeholder="buscar na web..." aria-label="buscar na web" aria-keyshortcuts="Alt+B">
      <button class="btn sm" data-action="org-search">buscar</button>
      <button type="button" id="org-search-clear" class="btn icon-btn-square" data-action="org-search-clear" data-tooltip="limpar busca" aria-label="limpar busca">${icon("x", { size: 13 })}</button>
      <button type="button" id="org-search-key-badge" class="btn icon-btn-square gh-token-badge" data-action="open-search-key-modal" data-tooltip="configurar chave de busca" aria-label="configurar chave de busca">${icon("key", { size: 13 })}</button>
    </div>
    <div id="org-search-results"></div>

    <div class="tabs" style="margin-top:16px;">
      <div class="tab on" data-tab="notas">notas</div>
      <div class="tab" data-tab="entrada">entrada <span class="tab-contagem" id="org-entrada-contagem"></span></div>
      <div class="tab" data-tab="github">github</div>
      <div class="tab" data-tab="email">e-mail</div>
      <div class="tab" data-tab="links">links</div>
    </div>

    <!-- ORG-01: aba de notas — pages/organizacao-notas.js -->
    <div id="org-panel-notas"></div>

    <!-- ORG-02: caixa de entrada da captura rápida — pages/organizacao-entrada.js -->
    <div id="org-panel-entrada" style="display:none;"></div>

    <div id="org-panel-github" style="display:none;">
      <div class="card">
        <div class="card-head">
          repositórios
          <span id="org-github-token-badge" class="gh-token-badge"></span>
          <span class="push"></span>
          <button class="btn sm" data-action="open-github-token-modal">${icon("settings", { size: 12 })} token</button>
          <button class="btn sm" data-action="open-repo-modal">+ conectar repositório</button>
        </div>
        <div class="card-body" id="org-repos"></div>
      </div>
    </div>

    <div id="org-panel-email" style="display:none;">
      <div class="card">
        <div class="card-head">
          e-mails
          <span class="push"></span>
          <button type="button" class="btn icon-btn-square" id="org-email-sync-btn" data-action="sync-selected-accounts" data-tooltip="sincronizar" aria-label="sincronizar">${icon("refresh-cw", { size: 13 })}</button>
          <button type="button" class="btn sm" data-action="open-manage-accounts-modal">${icon("settings", { size: 12 })} gerenciar contas</button>
        </div>
        <div class="card-body">
          <div id="org-email-alertas"></div>
          <div class="email-search-row">
            <input type="text" id="org-email-search" placeholder="buscar por assunto, remetente ou texto..." aria-label="buscar e-mails por assunto, remetente ou texto">
          </div>
          <div class="email-account-chips" id="org-account-chips"></div>
          <div class="email-filter-row" id="org-email-filter">
            <span class="email-filter-opt on" data-filter="all">tudo <span class="email-filter-count" id="org-email-filter-count-all">0</span></span>
            <span class="email-filter-opt" data-filter="unread">não lidos <span class="email-filter-count" id="org-email-filter-count-unread">0</span></span>
            <span class="email-filter-opt" data-filter="muted">silenciados <span class="email-filter-count" id="org-email-filter-count-muted">0</span></span>
          </div>
          <div id="org-emails"></div>
        </div>
      </div>
    </div>

    <div id="org-panel-links" style="display:none;">
      <div class="card">
        <div class="card-head">links<span class="push"></span><button class="btn sm" data-action="open-link-modal">+ adicionar link</button></div>
        <div class="card-body" id="org-linkgroups"></div>
      </div>
    </div>

    <!-- MODAL: gerenciar contas (CRUD, silenciar, sincronizar individual —
         movido pra fora do fluxo principal de leitura, ver secao 4.2 do plano) -->
    <div class="modal-backdrop" id="manage-accounts-modal">
      <div class="modal">
        <div class="modal-head">gerenciar contas de e-mail <button type="button" class="close" data-action="close-manage-accounts-modal" aria-label="fechar">${icon("x")}</button></div>
        <div class="modal-body">
          <button class="btn sm" style="width:100%; margin-bottom:10px;" data-action="open-account-modal">+ nova conta</button>
          <div id="org-accounts"></div>
        </div>
      </div>
    </div>

    <!-- MODAL: novo/editar link -->
    <div class="modal-backdrop" id="link-modal">
      <div class="modal">
        <div class="modal-head"><span id="link-modal-title">novo link</span> <button type="button" class="close" data-action="close-link-modal" aria-label="fechar">${icon("x")}</button></div>
        <div class="modal-body">
          <input type="hidden" id="link-edit-id" value="">
          <div class="field"><label for="link-title">título</label><input type="text" id="link-title" placeholder="ex: portal do aluno"></div>
          <div class="field"><label for="link-url">url</label><input type="text" id="link-url" placeholder="https://..."></div>
          <div class="field"><label for="link-cat">categoria</label><input type="text" id="link-cat" placeholder="geral"></div>
          <button class="btn primary" style="width:100%; margin-top:6px;" data-action="save-link" id="link-save-btn">+ adicionar link</button>
        </div>
      </div>
    </div>

    <!-- MODAL: novo repositório -->
    <div class="modal-backdrop" id="repo-modal">
      <div class="modal">
        <div class="modal-head">conectar repositório <button type="button" class="close" data-action="close-repo-modal" aria-label="fechar">${icon("x")}</button></div>
        <div class="modal-body">
          <div class="field">
            <label for="repo-full-name">repositório</label>
            <input type="text" id="repo-full-name" placeholder="usuario/repositorio (ou cole a url do github)">
          </div>
          <div class="page-sub" style="margin:0 0 8px 0; font-size:10px;">só repositórios públicos — api sem autenticação, limite de 60 req/h.</div>
          <div id="repo-modal-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
          <button class="btn primary" style="width:100%;" data-action="save-repo">+ conectar</button>
        </div>
      </div>
    </div>

    <!-- MODAL: nova/editar conta de e-mail -->
    <div class="modal-backdrop" id="account-modal">
      <div class="modal">
        <div class="modal-head">conta de e-mail <button type="button" class="close" data-action="close-account-modal" aria-label="fechar">${icon("x")}</button></div>
        <div class="modal-body">
          <input type="hidden" id="acc-edit-id">
          <div class="field"><label for="acc-label">apelido</label><input type="text" id="acc-label" placeholder="ex: gmail pessoal"></div>
          <div class="field-row">
            <div class="field"><label for="acc-host">host imap</label><input type="text" id="acc-host" placeholder="imap.gmail.com"></div>
            <div class="field" style="max-width:110px;"><label for="acc-port">porta</label><input type="number" id="acc-port" value="993"></div>
          </div>
          <div class="field"><label for="acc-username">usuário</label><input type="text" id="acc-username" placeholder="voce@gmail.com"></div>
          <div class="field"><label for="acc-password">senha de app <span id="acc-password-hint" style="color:var(--text-faint); font-size:9.5px;"></span></label><input type="password" id="acc-password" placeholder="••••••••"></div>
          <label class="acc-default-toggle"><input type="checkbox" id="acc-sync-by-default" checked> ${icon("star", { size: 12 })} conta padrão (já vem selecionada ao abrir a tela)</label>
          <button class="btn primary" style="width:100%; margin-top:6px;" data-action="save-account">salvar conta</button>
        </div>
      </div>
    </div>

    <!-- leitor de e-mail: modals/email-leitor-modal.js (ORG-06) -->

    <!-- MODAL: chave de busca (tavily) -->
      <div class="modal-backdrop" id="search-key-modal">
        <div class="modal">
          <div class="modal-head">chave de busca <button type="button" class="close" data-action="close-search-key-modal" aria-label="fechar">${icon("x")}</button></div>
          <div class="modal-body">
            <div class="page-sub" style="margin:0 0 10px 0; font-size:10px;">
              necessária pro resumo inline de busca (item 4.1). crie uma
              conta gratuita em <span data-open-link="https://tavily.com" style="color:var(--accent); cursor:pointer; text-decoration:underline;">tavily.com</span>
              (free tier: 1000 buscas/mês, sem cartão) e cole a chave aqui.
              sem chave configurada, o botão "buscar" mostra um link pra
              abrir a busca no duckduckgo em vez do resumo.
            </div>
            <div class="field"><label for="search-key-input">chave</label><input type="password" id="search-key-input" placeholder="tvly-..."></div>
            <div id="search-key-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
            <button class="btn primary" style="width:100%; margin-bottom:6px;" data-action="save-search-key">salvar chave</button>
            <button class="btn sm" style="width:100%;" data-action="delete-search-key">remover chave</button>
          </div>
        </div>
      </div>

    <!-- MODAL: token github -->
      <div class="modal-backdrop" id="github-token-modal">
        <div class="modal">
          <div class="modal-head">token do github <button type="button" class="close" data-action="close-github-token-modal" aria-label="fechar">${icon("x")}</button></div>
          <div class="modal-body">
            <div class="page-sub" style="margin:0 0 10px 0; font-size:10px;">
              opcional — sem token, só repositórios públicos e 60 req/h. com um
              fine-grained personal access token (permissão de leitura em
              contents/metadata), o kami passa a ver repositórios privados e
              sobe pra 5000 req/h.
            </div>
            <div class="field"><label for="gh-token-input">token</label><input type="password" id="gh-token-input" placeholder="github_pat_..."></div>
            <div id="gh-token-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
            <button class="btn primary" style="width:100%; margin-bottom:6px;" data-action="save-github-token">salvar token</button>
            <button class="btn sm" style="width:100%;" data-action="delete-github-token">remover token</button>
          </div>
        </div>
      </div>
  `;
}

/* ==================== eventos ====================
 * Um único listener delegado no container, guardado em clickHandler pra
 * poder ser removido no unmount (ver comentário no topo do arquivo).
 * IMPORTANTE: nada aqui pode dar "return" cedo demais por causa de um
 * data-attribute que não bateu — cada ação é checada de forma
 * independente, senão os cliques em botões que não usam data-action
 * (sync/delete/select, que usam data-sync-repo etc.) nunca chegam a ser
 * tratados. Foi exatamente esse early-return que quebrou todos os
 * botões de sincronizar/excluir na primeira versão deste arquivo.
 */

function bindEvents(container) {
  container.querySelectorAll(".tab").forEach((el) => {
    el.addEventListener("click", () => switchTab(el.dataset.tab));
  });

  container.querySelector("#org-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") orgSearchRun();
  });

  container.querySelector("#org-email-search").addEventListener("input", (e) => {
    state.emailQuery = e.target.value;
    renderEmails();
  });

  clickHandler = (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "org-search") orgSearchRun();
    if (action === "org-search-clear") orgSearchClear();
    if (action === "open-link-modal") openLinkModal();
    if (action === "close-link-modal") closeLinkModal();
    if (action === "save-link") handleSaveLink();
    if (action === "open-repo-modal") openRepoModal();
    if (action === "close-repo-modal") closeRepoModal();
    if (action === "save-repo") handleAddRepo();
    if (action === "open-account-modal") openAccountModal();
    if (action === "close-account-modal") closeAccountModal();
    if (action === "save-account") handleSaveAccount();
    if (action === "open-manage-accounts-modal") openManageAccountsModal();
    if (action === "close-manage-accounts-modal") closeManageAccountsModal();
    if (action === "sync-selected-accounts") handleSyncSelectedAccounts();
    if (action === "open-github-token-modal") openGithubTokenModal();
    if (action === "close-github-token-modal") closeGithubTokenModal();
    if (action === "save-github-token") handleSaveGithubToken();
    if (action === "delete-github-token") handleDeleteGithubToken();
    if (action === "open-search-key-modal") openSearchKeyModal();
    if (action === "close-search-key-modal") closeSearchKeyModal();
    if (action === "save-search-key") handleSaveSearchKey();
    if (action === "delete-search-key") handleDeleteSearchKey();

    const openLink = e.target.closest("[data-open-link]")?.dataset.openLink;
    if (openLink) openExternal(openLink);

    const linkEditId = e.target.closest("[data-edit-link]")?.dataset.editLink;
    if (linkEditId) openLinkModal(linkEditId);

    const linkId = e.target.closest("[data-delete-link]")?.dataset.deleteLink;
    if (linkId) handleDeleteLink(linkId);

    const repoSyncId = e.target.closest("[data-sync-repo]")?.dataset.syncRepo;
    if (repoSyncId) handleSyncRepo(repoSyncId);
    const repoDelId = e.target.closest("[data-delete-repo]")?.dataset.deleteRepo;
    if (repoDelId) handleDeleteRepo(repoDelId);

    const defaultStarId = e.target.closest("[data-toggle-default]")?.dataset.toggleDefault;
    if (defaultStarId) {
      handleToggleDefaultAccount(defaultStarId);
    } else {
      const chipId = e.target.closest("[data-account-chip]")?.dataset.accountChip;
      if (chipId) toggleAccountChip(chipId);
    }

    const filterEl = e.target.closest("[data-filter]");
    if (filterEl) setEmailFilter(filterEl.dataset.filter);

    const accSyncId = e.target.closest("[data-sync-account]")?.dataset.syncAccount;
    if (accSyncId) handleSyncAccount(accSyncId);
    const accEditId = e.target.closest("[data-edit-account]")?.dataset.editAccount;
    if (accEditId) openAccountModal(accEditId);
    const accDelId = e.target.closest("[data-delete-account]")?.dataset.deleteAccount;
    if (accDelId) handleDeleteAccount(accDelId);
    const accMuteId = e.target.closest("[data-mute-account]")?.dataset.muteAccount;
    if (accMuteId) handleToggleMuteAccount(accMuteId);

    const emailId = e.target.closest("[data-open-email]")?.dataset.openEmail;
    if (emailId) openEmailModal(emailId);
  };
  container.addEventListener("click", clickHandler);
}

export function switchTab(tab) {
  state.tab = tab;
  rootEl.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  rootEl.querySelector("#org-panel-notas").style.display = tab === "notas" ? "block" : "none";
  rootEl.querySelector("#org-panel-entrada").style.display = tab === "entrada" ? "block" : "none";
  rootEl.querySelector("#org-panel-links").style.display = tab === "links" ? "block" : "none";
  rootEl.querySelector("#org-panel-github").style.display = tab === "github" ? "block" : "none";
  rootEl.querySelector("#org-panel-email").style.display = tab === "email" ? "block" : "none";
}

/* ==================== helpers ==================== */

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(str) {
  return escapeHtml(str);
}

export function fmtDateTimeBR(iso) {
  return fmtDataHora(iso); // ORG-07
}
