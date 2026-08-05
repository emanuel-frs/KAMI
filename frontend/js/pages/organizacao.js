/**
 * pages/organizacao.js — módulo Organização (v1).
 *
 * Três abas: links, github, e-mail — espelha os três "tipos de fonte" do
 * router (app/routers/organizacao.py). Layout fixo (não usa o grid
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
 * configurada no modal de "⚙ chave de busca"). Sem chave configurada
 * ou em caso de erro, o painel de resultado mostra um link pra
 * configurar a chave (ou pra abrir a busca direto no DuckDuckGo, que
 * continua disponível como fallback sem precisar de nenhuma chave).
 */
import * as api from "../api/organizacao.js";
import { openExternal } from "../components/open-external.js";

const state = {
  tab: "links",
  links: [],
  repos: [],
  accounts: [],
  selectedAccountId: null,
  emails: [],
  githubTokenConfigured: false,
  commitActivity: {},
  searchKeyConfigured: false,
  searching: false,
  searchResult: null,   // { query, answer, results } da última busca com sucesso
  searchError: null,    // { message, query } da última tentativa com erro
};

let rootEl = null;
let clickHandler = null;

export async function mount(container) {
  rootEl = container;

  // defensivo: se por algum motivo unmount não rodou da última vez,
  // não deixa acumular listener no nó persistente.
  if (clickHandler) container.removeEventListener("click", clickHandler);

  container.innerHTML = template();
  bindEvents(container);

  await Promise.all([loadLinks(), loadRepos(), loadAccounts(), loadGithubTokenStatus(), loadSearchKeyStatus()]);
  renderLinks();
  renderRepos();
  renderAccounts();
  renderEmails();
  renderGithubTokenBadge();
  renderSearchKeyBadge();
}

export function unmount() {
  if (rootEl && clickHandler) rootEl.removeEventListener("click", clickHandler);
  clickHandler = null;
  rootEl = null;
  state.tab = "links";
  state.selectedAccountId = null;
  state.emails = [];
  state.searching = false;
  state.searchResult = null;
  state.searchError = null;
}

/* ==================== template ==================== */

function template() {
  return `
    <div class="search-row">
      <input type="text" id="org-search" placeholder="buscar na web...">
      <button class="btn sm" data-action="org-search">buscar</button>
      <span id="org-search-key-badge" class="gh-token-badge" style="cursor:pointer;" data-action="open-search-key-modal" title="configurar chave de busca">⚙</span>
    </div>
    <div id="org-search-results"></div>

    <div class="tabs" style="margin-top:16px;">
      <div class="tab on" data-tab="links">links</div>
      <div class="tab" data-tab="github">github</div>
      <div class="tab" data-tab="email">e-mail</div>
    </div>

    <div id="org-panel-links">
      <div class="card">
        <div class="card-head">links<span class="push"></span><button class="btn sm" data-action="open-link-modal">+ adicionar link</button></div>
        <div class="card-body" id="org-linkgroups"></div>
      </div>
    </div>

    <div id="org-panel-github" style="display:none;">
      <div class="card">
        <div class="card-head">
          repositórios
          <span id="org-github-token-badge" class="gh-token-badge"></span>
          <span class="push"></span>
          <button class="btn sm" data-action="open-github-token-modal">⚙ token</button>
          <button class="btn sm" data-action="open-repo-modal">+ conectar repositório</button>
        </div>
        <div class="card-body" id="org-repos"></div>
      </div>
    </div>

    <div id="org-panel-email" style="display:none;">
      <div class="card">
        <div class="card-head">contas imap<span class="push"></span><button class="btn sm" data-action="open-account-modal">+ nova conta</button></div>
        <div class="card-body" id="org-accounts"></div>
      </div>
      <div class="card" style="margin-top:14px;">
        <div class="card-head">
          e-mails<span id="org-emails-account-label" class="push" style="color:var(--text-faint); font-size:10px;"></span>
        </div>
        <div class="card-body" id="org-emails"></div>
      </div>
    </div>

    <!-- MODAL: novo link -->
    <div class="modal-backdrop" id="link-modal">
      <div class="modal">
        <div class="modal-head">novo link <span class="close" data-action="close-link-modal">✕</span></div>
        <div class="modal-body">
          <div class="field"><label>título</label><input type="text" id="link-title" placeholder="ex: portal do aluno"></div>
          <div class="field"><label>url</label><input type="text" id="link-url" placeholder="https://..."></div>
          <div class="field"><label>categoria</label><input type="text" id="link-cat" placeholder="geral"></div>
          <button class="btn primary" style="width:100%; margin-top:6px;" data-action="save-link">+ adicionar link</button>
        </div>
      </div>
    </div>

    <!-- MODAL: novo repositório -->
    <div class="modal-backdrop" id="repo-modal">
      <div class="modal">
        <div class="modal-head">conectar repositório <span class="close" data-action="close-repo-modal">✕</span></div>
        <div class="modal-body">
          <div class="field">
            <label>repositório</label>
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
        <div class="modal-head">conta de e-mail <span class="close" data-action="close-account-modal">✕</span></div>
        <div class="modal-body">
          <input type="hidden" id="acc-edit-id">
          <div class="field"><label>apelido</label><input type="text" id="acc-label" placeholder="ex: gmail pessoal"></div>
          <div class="field-row">
            <div class="field"><label>host imap</label><input type="text" id="acc-host" placeholder="imap.gmail.com"></div>
            <div class="field" style="max-width:110px;"><label>porta</label><input type="number" id="acc-port" value="993"></div>
          </div>
          <div class="field"><label>usuário</label><input type="text" id="acc-username" placeholder="voce@gmail.com"></div>
          <div class="field"><label>senha de app <span id="acc-password-hint" style="color:var(--text-faint); font-size:9.5px;"></span></label><input type="password" id="acc-password" placeholder="••••••••"></div>
          <button class="btn primary" style="width:100%; margin-top:6px;" data-action="save-account">salvar conta</button>
        </div>
      </div>
    </div>

    <!-- MODAL: detalhe de e-mail -->
    <div class="modal-backdrop" id="email-modal">
      <div class="modal">
        <div class="modal-head">e-mail <span class="close" data-action="close-email-modal">✕</span></div>
        <div class="modal-body" id="email-modal-body"></div>
      </div>
    </div>

    <!-- MODAL: chave de busca (tavily) -->
      <div class="modal-backdrop" id="search-key-modal">
        <div class="modal">
          <div class="modal-head">chave de busca <span class="close" data-action="close-search-key-modal">✕</span></div>
          <div class="modal-body">
            <div class="page-sub" style="margin:0 0 10px 0; font-size:10px;">
              necessária pro resumo inline de busca (item 4.1). crie uma
              conta gratuita em <span data-open-link="https://tavily.com" style="color:var(--accent); cursor:pointer; text-decoration:underline;">tavily.com</span>
              (free tier: 1000 buscas/mês, sem cartão) e cole a chave aqui.
              sem chave configurada, o botão "buscar" mostra um link pra
              abrir a busca no duckduckgo em vez do resumo.
            </div>
            <div class="field"><label>chave</label><input type="password" id="search-key-input" placeholder="tvly-..."></div>
            <div id="search-key-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
            <button class="btn primary" style="width:100%; margin-bottom:6px;" data-action="save-search-key">salvar chave</button>
            <button class="btn sm" style="width:100%;" data-action="delete-search-key">remover chave</button>
          </div>
        </div>
      </div>

    <!-- MODAL: token github -->
      <div class="modal-backdrop" id="github-token-modal">
        <div class="modal">
          <div class="modal-head">token do github <span class="close" data-action="close-github-token-modal">✕</span></div>
          <div class="modal-body">
            <div class="page-sub" style="margin:0 0 10px 0; font-size:10px;">
              opcional — sem token, só repositórios públicos e 60 req/h. com um
              fine-grained personal access token (permissão de leitura em
              contents/metadata), o kami passa a ver repositórios privados e
              sobe pra 5000 req/h.
            </div>
            <div class="field"><label>token</label><input type="password" id="gh-token-input" placeholder="github_pat_..."></div>
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

  clickHandler = (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "org-search") orgSearchRun();
    if (action === "open-link-modal") openLinkModal();
    if (action === "close-link-modal") closeLinkModal();
    if (action === "save-link") handleAddLink();
    if (action === "open-repo-modal") openRepoModal();
    if (action === "close-repo-modal") closeRepoModal();
    if (action === "save-repo") handleAddRepo();
    if (action === "open-account-modal") openAccountModal();
    if (action === "close-account-modal") closeAccountModal();
    if (action === "save-account") handleSaveAccount();
    if (action === "close-email-modal") closeEmailModal();
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

    const linkId = e.target.closest("[data-delete-link]")?.dataset.deleteLink;
    if (linkId) handleDeleteLink(linkId);

    const repoSyncId = e.target.closest("[data-sync-repo]")?.dataset.syncRepo;
    if (repoSyncId) handleSyncRepo(repoSyncId);
    const repoDelId = e.target.closest("[data-delete-repo]")?.dataset.deleteRepo;
    if (repoDelId) handleDeleteRepo(repoDelId);

    const accSelectId = e.target.closest("[data-select-account]")?.dataset.selectAccount;
    if (accSelectId) selectAccount(accSelectId);
    const accSyncId = e.target.closest("[data-sync-account]")?.dataset.syncAccount;
    if (accSyncId) handleSyncAccount(accSyncId);
    const accEditId = e.target.closest("[data-edit-account]")?.dataset.editAccount;
    if (accEditId) openAccountModal(accEditId);
    const accDelId = e.target.closest("[data-delete-account]")?.dataset.deleteAccount;
    if (accDelId) handleDeleteAccount(accDelId);

    const emailId = e.target.closest("[data-open-email]")?.dataset.openEmail;
    if (emailId) openEmailModal(emailId);
  };
  container.addEventListener("click", clickHandler);
}

function switchTab(tab) {
  state.tab = tab;
  rootEl.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  rootEl.querySelector("#org-panel-links").style.display = tab === "links" ? "block" : "none";
  rootEl.querySelector("#org-panel-github").style.display = tab === "github" ? "block" : "none";
  rootEl.querySelector("#org-panel-email").style.display = tab === "email" ? "block" : "none";
}

/* ==================== busca (tavily, ver ALINHAMENTO.md 4.1) ====================
 * Resumo inline via GET /api/organizacao/search (backend, chave da
 * tavily). Sem chave configurada (ou qualquer erro), cai pro
 * fallback de sempre: abrir a busca direto no duckduckgo numa aba
 * nova — por isso o link de fallback aparece no próprio painel de
 * erro, não só no modal de configurar chave.
 */

async function loadSearchKeyStatus() {
  const r = await api.getSearchKeyStatus();
  state.searchKeyConfigured = r.configured;
}

function renderSearchKeyBadge() {
  const badge = rootEl.querySelector("#org-search-key-badge");
  if (!badge) return;
  badge.classList.toggle("on", state.searchKeyConfigured);
}

function openSearchKeyModal() {
  rootEl.querySelector("#search-key-input").value = "";
  const err = rootEl.querySelector("#search-key-error");
  err.style.display = "none";
  err.textContent = "";
  rootEl.querySelector("#search-key-modal").classList.add("open");
}
function closeSearchKeyModal() {
  rootEl.querySelector("#search-key-modal").classList.remove("open");
}

async function handleSaveSearchKey() {
  const input = rootEl.querySelector("#search-key-input");
  const err = rootEl.querySelector("#search-key-error");
  const key = input.value.trim();
  if (!key) {
    err.textContent = "cole uma chave.";
    err.style.display = "block";
    return;
  }
  try {
    await api.saveSearchKey(key);
  } catch (e) {
    err.textContent = e?.message || "chave inválida ou sem permissão.";
    err.style.display = "block";
    return;
  }
  state.searchKeyConfigured = true;
  renderSearchKeyBadge();
  closeSearchKeyModal();
}

async function handleDeleteSearchKey() {
  await api.deleteSearchKey();
  state.searchKeyConfigured = false;
  renderSearchKeyBadge();
  closeSearchKeyModal();
}

function orgSearchDuckDuckGoUrl(q) {
  return "https://duckduckgo.com/?q=" + encodeURIComponent(q);
}

async function orgSearchRun() {
  if (state.searching) return; // evita disparar buscas em paralelo no double-enter/double-click
  const input = rootEl.querySelector("#org-search");
  const q = input.value.trim();
  if (!q) return;

  state.searching = true;
  state.searchResult = null;
  state.searchError = null;
  renderSearchResults();

  try {
    state.searchResult = await api.searchWeb(q);
  } catch (e) {
    state.searchError = { message: e?.message || "erro ao buscar.", query: q };
  }
  state.searching = false;
  renderSearchResults();
}

function renderSearchResults() {
  const wrap = rootEl.querySelector("#org-search-results");
  if (!wrap) return;

  if (state.searching) {
    wrap.innerHTML = `<div class="search-panel search-loading">buscando...</div>`;
    return;
  }

  if (state.searchError) {
    const { message, query } = state.searchError;
    wrap.innerHTML = `
      <div class="search-panel search-error-panel">
        <div class="search-error-msg">${escapeHtml(message)}</div>
        <div class="search-fallback">
          ${state.searchKeyConfigured ? "" : `<span class="link-btn" data-action="open-search-key-modal">configurar chave de busca</span> · `}
          <span class="link-btn" data-open-link="${escapeAttr(orgSearchDuckDuckGoUrl(query))}">abrir busca no duckduckgo ↗</span>
        </div>
      </div>`;
    return;
  }

  if (!state.searchResult) {
    wrap.innerHTML = "";
    return;
  }

  const { query, answer, results } = state.searchResult;
  const answerHtml = answer
    ? `<div class="search-answer">${escapeHtml(answer)}</div>`
    : "";
  const resultsHtml = results.length
    ? results.map((r) => `
        <div class="search-result-item" data-open-link="${escapeAttr(r.url)}">
          <div class="search-result-title">${escapeHtml(r.title)}</div>
          ${r.snippet ? `<div class="search-result-snippet">${escapeHtml(r.snippet)}</div>` : ""}
          <div class="search-result-url">${escapeHtml(r.url)}</div>
        </div>`).join("")
    : `<div class="empty-state">nenhum resultado.</div>`;

  wrap.innerHTML = `
    <div class="search-panel">
      ${answerHtml}
      <div class="search-results-list">${resultsHtml}</div>
      <div class="search-fallback">
        <span class="link-btn" data-open-link="${escapeAttr(orgSearchDuckDuckGoUrl(query))}">ver mais no duckduckgo ↗</span>
      </div>
    </div>`;
}

/* ==================== links ==================== */

async function loadLinks() {
  state.links = await api.listLinks();
}

function renderLinks() {
  const wrap = rootEl.querySelector("#org-linkgroups");
  if (!state.links.length) {
    wrap.innerHTML = '<div class="empty-state">nenhum link cadastrado ainda.</div>';
    return;
  }
  const groups = {};
  state.links.forEach((l) => {
    (groups[l.category] = groups[l.category] || []).push(l);
  });
  wrap.innerHTML = Object.entries(groups)
    .map(([cat, links]) => {
      const rows = links
        .map((l) => {
          let domain = "example.com";
          try {
            domain = new URL(l.url).hostname;
          } catch (e) {
            /* url inválida — mantém o domínio placeholder pro favicon */
          }
          return `
            <div class="linkrow">
              <img class="favicon" src="https://www.google.com/s2/favicons?domain=${escapeAttr(domain)}" alt="">
              <span class="lr-title" data-open-link="${escapeAttr(l.url)}">${escapeHtml(l.title)}</span>
              <span class="lr-go" data-open-link="${escapeAttr(l.url)}">↗</span>
              <span class="lr-delete" data-delete-link="${l.id}">✕</span>
            </div>`;
        })
        .join("");
      return `<div class="linkgroup"><div class="lg-label">${escapeHtml(cat)}</div>${rows}</div>`;
    })
    .join("");
}

function openLinkModal() {
  ["link-title", "link-url", "link-cat"].forEach((id) => (rootEl.querySelector("#" + id).value = ""));
  rootEl.querySelector("#link-modal").classList.add("open");
}
function closeLinkModal() {
  rootEl.querySelector("#link-modal").classList.remove("open");
}

async function handleAddLink() {
  const title = rootEl.querySelector("#link-title").value.trim();
  const url = rootEl.querySelector("#link-url").value.trim();
  const category = rootEl.querySelector("#link-cat").value.trim() || "geral";
  if (!title || !url) {
    alert("preencha título e url.");
    return;
  }
  await api.createLink({ title, url, category });
  closeLinkModal();
  await loadLinks();
  renderLinks();
}

async function handleDeleteLink(linkId) {
  await api.deleteLink(linkId);
  await loadLinks();
  renderLinks();
}

/* ==================== github ==================== */

async function loadRepos() {
  state.repos = await api.listGithubRepos();
}

// aceita "usuario/repo" OU uma url completa do github colada sem querer
// (foi exatamente o ponto 5 do feedback: colar a url inteira criava um
// repositório "fantasma" sem nenhum aviso). Convertida aqui ANTES de
// mandar pro backend, então o usuário nem chega a ver o problema.
function parseRepoFullName(raw) {
  const v = raw.trim();
  const m = v.match(/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/i);
  if (m) return `${m[1]}/${m[2]}`;
  return v;
}

async function renderRepos() {
  const wrap = rootEl.querySelector("#org-repos");
  if (!state.repos.length) {
    wrap.innerHTML = '<div class="empty-state">nenhum repositório conectado ainda.</div>';
    return;
  }
  wrap.innerHTML = state.repos.map((r) => repoCardHtml(r)).join("");

  // busca atividade de commit em paralelo, sem bloquear o render inicial
  state.repos.forEach(async (r) => {
    if (state.commitActivity[r.id]) return;
    try {
      const activity = await api.getCommitActivity(r.id);
      state.commitActivity[r.id] = activity;
      const holder = rootEl.querySelector(`[data-sparkline-for="${r.id}"]`);
      if (holder) holder.outerHTML = sparklineHtml(activity);
    } catch (e) {
      /* silencioso — sparkline é acessório */
    }
  });
}

function repoCardHtml(r) {
  const s = r.cached_status;
  const neverSynced = !s && !r.last_synced_at;
  const stats = s
    ? `<div class="rc-stats">
         <span><span class="rc-star">★</span> <b>${s.stargazers_count ?? "—"}</b></span>
         <span>issues <b>${s.open_issues_count ?? "—"}</b></span>
         <span>branch <b>${escapeHtml(s.default_branch ?? "—")}</b></span>
         ${s.language ? `<span>lang <b>${escapeHtml(s.language)}</b></span>` : ""}
         ${s.private ? `<span class="gh-private-tag">privado</span>` : ""}
       </div>
       ${s.description ? `<div class="rc-desc">${escapeHtml(s.description)}</div>` : ""}`
    : "";
  const synced = r.last_synced_at
    ? `<div class="rc-synced">última sincronização: ${fmtDateTimeBR(r.last_synced_at)}</div>`
    : "";
  const error = neverSynced
    ? `<div class="rc-error">sem dados do github — repositório pode não existir, estar privado (sem token com acesso), ou o nome pode estar incorreto. tente ↻ pra sincronizar de novo.</div>`
    : "";

  // se já tem a atividade em memória (visita anterior nesta sessão),
  // desenha o sparkline direto — sem isso, o placeholder ficava vazio
  // pra sempre porque a busca era pulada quando já havia cache.
  const cachedActivity = state.commitActivity[r.id];
  const sparklineSlot = cachedActivity
    ? sparklineHtml(cachedActivity)
    : `<span data-sparkline-for="${r.id}"></span>`;

  return `
    <div class="repo-card${neverSynced ? " has-error" : ""}">
      <div class="rc-head">
        <span class="rc-name">${escapeHtml(r.repo_full_name)}</span>
        <span class="rc-actions">
          <span class="icon-btn" title="ressincronizar" data-sync-repo="${r.id}">↻</span>
          <span class="icon-btn danger" title="remover" data-delete-repo="${r.id}">✕</span>
        </span>
      </div>
      ${stats}
      ${sparklineSlot}
      ${synced}
      ${error}
    </div>`;
}

function sparklineHtml(activity) {
  if (!activity || activity.error || !activity.weeks.length) return "";
  const weeks = activity.weeks;
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const barW = 6, gap = 2, h = 20;
  const bars = weeks
    .map((w, i) => {
      const barH = Math.max(1, Math.round((w.total / max) * h));
      const x = i * (barW + gap);
      return `<rect x="${x}" y="${h - barH}" width="${barW}" height="${barH}" rx="1"></rect>`;
    })
    .join("");
  const width = weeks.length * (barW + gap);
  return `<div class="rc-sparkline" title="commits nas últimas ${weeks.length} semanas">
    <svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}">${bars}</svg>
  </div>`;
}

function openRepoModal() {
  rootEl.querySelector("#repo-full-name").value = "";
  const errBox = rootEl.querySelector("#repo-modal-error");
  errBox.style.display = "none";
  errBox.textContent = "";
  rootEl.querySelector("#repo-modal").classList.add("open");
}
function closeRepoModal() {
  rootEl.querySelector("#repo-modal").classList.remove("open");
}

async function handleAddRepo() {
  const input = rootEl.querySelector("#repo-full-name");
  const errBox = rootEl.querySelector("#repo-modal-error");
  const repoFullName = parseRepoFullName(input.value);
  if (!repoFullName || !repoFullName.includes("/")) {
    errBox.textContent = "informe no formato usuario/repositorio (ou cole a url do github).";
    errBox.style.display = "block";
    return;
  }

  let result;
  try {
    result = await api.createGithubRepo({ repo_full_name: repoFullName });
  } catch (err) {
    // erro de transporte/validação (ex: 422 já cadastrado)
    errBox.textContent = err?.message || "não foi possível conectar o repositório.";
    errBox.style.display = "block";
    return;
  }

  await loadRepos();
  renderRepos();

  if (result?.sync_error) {
    // o repositório FOI criado mesmo assim (comportamento do backend),
    // mas avisa na hora que a sincronização inicial falhou — sem isso é
    // o ponto 5 do feedback: nada acontece e vira um card fantasma.
    closeRepoModal();
    alert("repositório conectado, mas a sincronização inicial falhou: " + result.sync_error);
  } else {
    closeRepoModal();
  }
}

async function handleSyncRepo(repoId) {
  const result = await api.syncGithubRepo(repoId);
  await loadRepos();
  renderRepos();
  if (result?.sync_error) {
    alert("falha ao sincronizar: " + result.sync_error);
  }
}

async function handleDeleteRepo(repoId) {
  await api.deleteGithubRepo(repoId);
  await loadRepos();
  renderRepos();
}

/* ==================== contas de e-mail ==================== */

async function loadAccounts() {
  state.accounts = await api.listEmailAccounts();
  if (!state.selectedAccountId && state.accounts.length) {
    state.selectedAccountId = state.accounts[0].id;
  }
}

async function loadGithubTokenStatus() {
  const r = await api.getGithubTokenStatus();
  state.githubTokenConfigured = r.configured;
}

function renderGithubTokenBadge() {
  const badge = rootEl.querySelector("#org-github-token-badge");
  if (!badge) return;
  badge.textContent = state.githubTokenConfigured ? "● token ativo" : "○ sem token";
  badge.classList.toggle("on", state.githubTokenConfigured);
}

function openGithubTokenModal() {
  rootEl.querySelector("#gh-token-input").value = "";
  const err = rootEl.querySelector("#gh-token-error");
  err.style.display = "none";
  err.textContent = "";
  rootEl.querySelector("#github-token-modal").classList.add("open");
}
function closeGithubTokenModal() {
  rootEl.querySelector("#github-token-modal").classList.remove("open");
}

async function handleSaveGithubToken() {
  const input = rootEl.querySelector("#gh-token-input");
  const err = rootEl.querySelector("#gh-token-error");
  const token = input.value.trim();
  if (!token) {
    err.textContent = "cole um token.";
    err.style.display = "block";
    return;
  }
  try {
    await api.saveGithubToken(token);
  } catch (e) {
    err.textContent = e?.message || "token inválido ou sem permissão.";
    err.style.display = "block";
    return;
  }
  state.githubTokenConfigured = true;
  renderGithubTokenBadge();
  closeGithubTokenModal();
}

async function handleDeleteGithubToken() {
  await api.deleteGithubToken();
  state.githubTokenConfigured = false;
  renderGithubTokenBadge();
  closeGithubTokenModal();
}

function renderAccounts() {
  const wrap = rootEl.querySelector("#org-accounts");
  if (!state.accounts.length) {
    wrap.innerHTML = '<div class="empty-state">nenhuma conta cadastrada ainda.</div>';
    return;
  }
  wrap.innerHTML = state.accounts
    .map(
      (a) => `
      <div class="org-account">
        <div class="org-account-info" data-select-account="${a.id}" style="cursor:pointer;">
          <b>${escapeHtml(a.label)}${a.id === state.selectedAccountId ? " ▸" : ""}</b>
          <span class="meta">${escapeHtml(a.username)} · ${escapeHtml(a.imap_host)}:${a.imap_port}</span>
        </div>
        <div class="org-account-actions">
          <span class="icon-btn" title="sincronizar" data-sync-account="${a.id}">↻</span>
          <span class="icon-btn" title="editar" data-edit-account="${a.id}">✎</span>
          <span class="icon-btn" title="remover" data-delete-account="${a.id}">✕</span>
        </div>
      </div>`
    )
    .join("");
}

function openAccountModal(accountId) {
  const modal = rootEl.querySelector("#account-modal");
  const hint = rootEl.querySelector("#acc-password-hint");
  if (accountId) {
    const acc = state.accounts.find((a) => a.id === accountId);
    rootEl.querySelector("#acc-edit-id").value = acc.id;
    rootEl.querySelector("#acc-label").value = acc.label;
    rootEl.querySelector("#acc-host").value = acc.imap_host;
    rootEl.querySelector("#acc-port").value = acc.imap_port;
    rootEl.querySelector("#acc-username").value = acc.username;
    rootEl.querySelector("#acc-password").value = "";
    hint.textContent = "(deixe em branco pra manter a senha atual)";
  } else {
    rootEl.querySelector("#acc-edit-id").value = "";
    ["acc-label", "acc-host", "acc-username", "acc-password"].forEach((id) => (rootEl.querySelector("#" + id).value = ""));
    rootEl.querySelector("#acc-port").value = 993;
    hint.textContent = "";
  }
  modal.classList.add("open");
}

function closeAccountModal() {
  rootEl.querySelector("#account-modal").classList.remove("open");
}

async function handleSaveAccount() {
  const editId = rootEl.querySelector("#acc-edit-id").value;
  const label = rootEl.querySelector("#acc-label").value.trim();
  const imap_host = rootEl.querySelector("#acc-host").value.trim();
  const imap_port = parseInt(rootEl.querySelector("#acc-port").value, 10) || 993;
  const username = rootEl.querySelector("#acc-username").value.trim();
  const app_password = rootEl.querySelector("#acc-password").value;

  if (!label || !imap_host || !username || (!editId && !app_password)) {
    alert("preencha apelido, host, usuário e senha de app.");
    return;
  }

  if (editId) {
    const payload = { label, imap_host, imap_port, username };
    if (app_password) payload.app_password = app_password;
    await api.updateEmailAccount(editId, payload);
  } else {
    await api.createEmailAccount({ label, imap_host, imap_port, username, app_password });
  }
  closeAccountModal();
  await loadAccounts();
  renderAccounts();
}

async function handleDeleteAccount(accountId) {
  if (!confirm("remover esta conta? o cache de e-mails dela também será apagado.")) return;
  await api.deleteEmailAccount(accountId);
  if (state.selectedAccountId === accountId) {
    state.selectedAccountId = null;
    state.emails = [];
  }
  await loadAccounts();
  renderAccounts();
  renderEmails();
}

async function handleSyncAccount(accountId) {
  try {
    await api.syncEmailAccount(accountId);
  } catch (err) {
    alert(err?.message || "falha ao sincronizar — confira host/porta/usuário/senha de app.");
    return;
  }
  if (state.selectedAccountId !== accountId) {
    state.selectedAccountId = accountId;
    renderAccounts();
  }
  await loadEmails(accountId);
  renderEmails();
}

/* ==================== e-mails (cache) ==================== */

async function selectAccount(accountId) {
  state.selectedAccountId = accountId;
  renderAccounts();
  await loadEmails(accountId);
  renderEmails();
}

async function loadEmails(accountId) {
  state.emails = await api.listEmailCache({ account_id: accountId });
}

function renderEmails() {
  const wrap = rootEl.querySelector("#org-emails");
  const label = rootEl.querySelector("#org-emails-account-label");
  const acc = state.accounts.find((a) => a.id === state.selectedAccountId);

  label.textContent = acc ? acc.label : "";

  if (!acc) {
    wrap.innerHTML = '<div class="empty-state">selecione uma conta acima pra ver os e-mails.</div>';
    return;
  }
  if (!state.emails.length) {
    wrap.innerHTML = '<div class="empty-state">nenhum e-mail em cache — clique em ↻ pra sincronizar.</div>';
    return;
  }
  wrap.innerHTML = state.emails
    .map(
      (e) => `
      <div class="email-item${e.is_read ? "" : " unread"}" data-open-email="${e.id}">
        <div class="email-avatar">${emailInitial(e.sender)}</div>
        <div class="email-main">
          <div class="email-top">
            <span class="email-subject">${escapeHtml(e.subject || "(sem assunto)")}</span>
            <span class="email-tag">${e.is_read ? "" : "novo"}</span>
          </div>
          <div class="email-sender">de: ${escapeHtml(e.sender)}</div>
          <div class="email-preview">${escapeHtml(e.body_preview || "")}</div>
        </div>
        <div class="email-meta">${fmtDateTimeBR(e.received_at)}</div>
      </div>`
    )
    .join("");
}

function emailInitial(sender) {
  const name = (sender || "?").split("@")[0].replace(/[._-]/g, " ").trim();
  return (name.charAt(0) || "?").toUpperCase();
}

function openEmailModal(cacheId) {
  const email = state.emails.find((e) => e.id === cacheId);
  if (!email) return;
  const body = rootEl.querySelector("#email-modal-body");
  body.innerHTML = `
    <div class="email-detail-field"><label>assunto</label><div class="val subject">${escapeHtml(email.subject || "(sem assunto)")}</div></div>
    <div class="vm-row"><span class="k">de</span><span class="v">${escapeHtml(email.sender)}</span></div>
    <div class="vm-row"><span class="k">recebido em</span><span class="v">${fmtDateTimeBR(email.received_at)}</span></div>
    <div class="email-detail-field" style="margin-top:10px;"><label>prévia (texto puro — sem resumo por ia no v1)</label>
      <div class="val preview">${escapeHtml(email.body_preview || "sem prévia disponível.")}</div>
    </div>
  `;
  rootEl.querySelector("#email-modal").classList.add("open");

  if (!email.is_read) {
    api.markEmailRead(cacheId).then(() => {
      email.is_read = true;
      renderEmails();
    });
  }
}

function closeEmailModal() {
  rootEl.querySelector("#email-modal").classList.remove("open");
}

/* ==================== helpers ==================== */

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function fmtDateTimeBR(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return iso;
  }
}