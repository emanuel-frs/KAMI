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
export const syncEmailAccount = (accountId) => post(`/api/organizacao/email-accounts/${accountId}/sync`, {});
export const deleteEmailAccount = (accountId) => del(`/api/organizacao/email-accounts/${accountId}`);

// cache de e-mail (leitura)
export const listEmailCache = () => get("/api/organizacao/email-cache");
export const markEmailRead = (cacheId) => put(`/api/organizacao/email-cache/${cacheId}/read`, {});
