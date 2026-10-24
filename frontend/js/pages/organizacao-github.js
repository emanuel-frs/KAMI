/**
 * Organização — aba github: repositórios, sincronização e token pessoal.
 * MAN-02: saiu de pages/organizacao.js, que continua montando a tela
 * (template, eventos, troca de aba) e guarda o `state` compartilhado.
 */
import * as api from "../api/organizacao.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "../modals/err-modal.js";
import { showToast } from "../components/toast.js";
import { state, rootEl, escapeHtml, fmtDateTimeBR } from "./organizacao.js";

/* ==================== github ==================== */

export async function loadRepos() {
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

export async function renderRepos() {
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
         <span><span class="rc-star">${icon("star", { size: 13, fill: "currentColor" })}</span> <b>${s.stargazers_count ?? "—"}</b></span>
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
    ? `<div class="rc-error">sem dados do github — repositório pode não existir, estar privado (sem token com acesso), ou o nome pode estar incorreto. tente ressincronizar (${icon("refresh-cw", { size: 10 })} acima) de novo.</div>`
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
        <span class="rc-name-group">
          <span class="rc-name">${escapeHtml(r.repo_full_name)}</span>
          <span class="repo-source-badge ${r.source === "auto" ? "auto" : "manual"}" data-tooltip="${r.source === "auto" ? `importado automaticamente${r.owner_login ? ` (${escapeHtml(r.owner_login)})` : ""}` : "cadastrado manualmente"}">${r.source === "auto" ? "auto" : "manual"}</span>
        </span>
        <span class="rc-actions">
          <span class="icon-btn" data-tooltip="ressincronizar" aria-label="ressincronizar" data-sync-repo="${r.id}">${icon("refresh-cw", { size: 12 })}</span>
          <span class="icon-btn danger" data-tooltip="remover" aria-label="remover" data-delete-repo="${r.id}">${icon("x")}</span>
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
  return `<div class="rc-sparkline" data-tooltip="commits nas últimas ${weeks.length} semanas">
    <svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}">${bars}</svg>
  </div>`;
}

export function openRepoModal() {
  rootEl.querySelector("#repo-full-name").value = "";
  const errBox = rootEl.querySelector("#repo-modal-error");
  errBox.style.display = "none";
  errBox.textContent = "";
  rootEl.querySelector("#repo-modal").classList.add("open");
}
export function closeRepoModal() {
  rootEl.querySelector("#repo-modal").classList.remove("open");
}

export async function handleAddRepo() {
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
    showErrorModal(result.sync_error, "repositório conectado, mas a sincronização inicial falhou");
  } else {
    closeRepoModal();
  }
}

export async function handleSyncRepo(repoId) {
  const result = await api.syncGithubRepo(repoId);
  await loadRepos();
  renderRepos();
  if (result?.sync_error) {
    showErrorModal(result.sync_error, "falha ao sincronizar");
  }
}

export async function handleDeleteRepo(repoId) {
  await api.deleteGithubRepo(repoId);
  await loadRepos();
  renderRepos();
}

export async function loadGithubTokenStatus() {
  const r = await api.getGithubTokenStatus();
  state.githubTokenConfigured = r.configured;
}

export function renderGithubTokenBadge() {
  const badge = rootEl.querySelector("#org-github-token-badge");
  if (!badge) return;
  badge.innerHTML = state.githubTokenConfigured
    ? `<span class="status-dot"></span> token ativo`
    : `<span class="status-dot"></span> sem token`;
  badge.classList.toggle("on", state.githubTokenConfigured);
}

export function openGithubTokenModal() {
  rootEl.querySelector("#gh-token-input").value = "";
  const err = rootEl.querySelector("#gh-token-error");
  err.style.display = "none";
  err.textContent = "";
  rootEl.querySelector("#github-token-modal").classList.add("open");
}
export function closeGithubTokenModal() {
  rootEl.querySelector("#github-token-modal").classList.remove("open");
}

export async function handleSaveGithubToken() {
  const input = rootEl.querySelector("#gh-token-input");
  const err = rootEl.querySelector("#gh-token-error");
  const token = input.value.trim();
  if (!token) {
    err.textContent = "cole um token.";
    err.style.display = "block";
    return;
  }
  let result;
  try {
    result = await api.saveGithubToken(token);
  } catch (e) {
    err.textContent = e?.message || "token inválido ou sem permissão.";
    err.style.display = "block";
    return;
  }
  state.githubTokenConfigured = true;
  renderGithubTokenBadge();
  closeGithubTokenModal();

  // importação automática já rodou no backend (ver save_github_token /
  // _auto_import_repos) — só falta recarregar a lista de repos pra
  // refletir o que mudou e avisar a pessoa do que aconteceu.
  await loadRepos();
  renderRepos();

  if (result?.import_error) {
    showErrorModal(result.import_error, "token salvo, mas a importação automática de repositórios falhou");
  } else if (typeof result?.imported_count === "number") {
    const owner = result.owner_login ? ` de ${result.owner_login}` : "";
    showToast({
      title: "github",
      message:
        result.imported_count > 0
          ? `${result.imported_count} repositório(s) importado(s) automaticamente${owner}.`
          : `token salvo — nenhum repositório novo pra importar${owner}.`,
    });
  }
}

export async function handleDeleteGithubToken() {
  await api.deleteGithubToken();
  state.githubTokenConfigured = false;
  renderGithubTokenBadge();
  closeGithubTokenModal();
}
