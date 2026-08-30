import { get, post, put, del } from "./client.js";

// links
export const listLinks = () => get("/api/organizacao/links");
export const createLink = (data) => post("/api/organizacao/links", data);
export const deleteLink = (linkId) => del(`/api/organizacao/links/${linkId}`);

// repositórios github
export const listGithubRepos = () => get("/api/organizacao/github-repos");
export const createGithubRepo = (data) => post("/api/organizacao/github-repos", data);
export const syncGithubRepo = (repoId) => put(`/api/organizacao/github-repos/${repoId}/sync`, {});
export const deleteGithubRepo = (repoId) => del(`/api/organizacao/github-repos/${repoId}`);

// contas de e-mail (IMAP)
export const listEmailAccounts = () => get("/api/organizacao/email-accounts");
export const createEmailAccount = (data) => post("/api/organizacao/email-accounts", data);
export const updateEmailAccount = (accountId, data) => put(`/api/organizacao/email-accounts/${accountId}`, data);
export const syncEmailAccount = (accountId, { automatic = false } = {}) =>
  post(`/api/organizacao/email-accounts/${accountId}/sync${automatic ? "?automatic=true" : ""}`, {});
export const deleteEmailAccount = (accountId) => del(`/api/organizacao/email-accounts/${accountId}`);

// cache de e-mail (leitura)
export const listEmailCache = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return get(`/api/organizacao/email-cache${qs ? `?${qs}` : ""}`);
};
export const markEmailRead = (cacheId) => put(`/api/organizacao/email-cache/${cacheId}/read`, {});

// contas silenciadas (notificações v2.1) — silencia a CONTA inteira
// (não um remetente/e-mail individual); ver EmailCacheOut.is_muted/
// muted_accounts no backend.
export const listMutedAccounts = () => get("/api/organizacao/muted-accounts");
export const muteAccount = (accountId) => post("/api/organizacao/muted-accounts", { account_id: accountId });
export const unmuteAccount = (mutedId) => del(`/api/organizacao/muted-accounts/${mutedId}`);

// configuração do token github (opcional — repos privados + rate limit maior)
export const getGithubTokenStatus = () => get("/api/organizacao/github-token");
export const saveGithubToken = (token) => put("/api/organizacao/github-token", { token });
export const deleteGithubToken = () => del("/api/organizacao/github-token");
export const getCommitActivity = (repoId) => get(`/api/organizacao/github-repos/${repoId}/commit-activity`);

// busca (v2 — resumo inline via tavily, ver ALINHAMENTO.md 4.1)
export const getSearchKeyStatus = () => get("/api/organizacao/search-key");
export const saveSearchKey = (apiKey) => put("/api/organizacao/search-key", { api_key: apiKey });
export const deleteSearchKey = () => del("/api/organizacao/search-key");
export const searchWeb = (q) => get(`/api/organizacao/search?q=${encodeURIComponent(q)}`);