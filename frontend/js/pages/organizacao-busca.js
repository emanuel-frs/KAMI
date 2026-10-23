/**
 * Organização — busca rápida no topo da tela (Tavily com chave pessoal;
 * sem chave, abre o DuckDuckGo).
 * MAN-02: saiu de pages/organizacao.js, que continua montando a tela
 * (template, eventos, troca de aba) e guarda o `state` compartilhado.
 */
import * as api from "../api/organizacao.js";
import { icon } from "../components/icons.js";
import { state, rootEl, escapeHtml, escapeAttr } from "./organizacao.js";

/* ==================== busca (tavily, ver ALINHAMENTO.md 4.1) ====================
 * Resumo inline via GET /api/organizacao/search (backend, chave da
 * tavily). Sem chave configurada (ou qualquer erro), cai pro
 * fallback de sempre: abrir a busca direto no duckduckgo numa aba
 * nova — por isso o link de fallback aparece no próprio painel de
 * erro, não só no modal de configurar chave.
 */

export async function loadSearchKeyStatus() {
  const r = await api.getSearchKeyStatus();
  state.searchKeyConfigured = r.configured;
}

export function renderSearchKeyBadge() {
  const badge = rootEl.querySelector("#org-search-key-badge");
  if (!badge) return;
  badge.classList.toggle("on", state.searchKeyConfigured);
}

export function openSearchKeyModal() {
  rootEl.querySelector("#search-key-input").value = "";
  const err = rootEl.querySelector("#search-key-error");
  err.style.display = "none";
  err.textContent = "";
  rootEl.querySelector("#search-key-modal").classList.add("open");
}
export function closeSearchKeyModal() {
  rootEl.querySelector("#search-key-modal").classList.remove("open");
}

export async function handleSaveSearchKey() {
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

export async function handleDeleteSearchKey() {
  await api.deleteSearchKey();
  state.searchKeyConfigured = false;
  renderSearchKeyBadge();
  closeSearchKeyModal();
}

function orgSearchDuckDuckGoUrl(q) {
  return "https://duckduckgo.com/?q=" + encodeURIComponent(q);
}

// botão de limpar (ícone "x") ao lado de "buscar" — limpa o texto digitado e qualquer
// resultado/erro já exibido, sem esperar uma nova busca. Reaproveita
// renderSearchResults() (mesma função usada após uma busca) já que
// zerar os três campos de estado (searchResult/searchError/searching)
// faz ela cair no ramo `if (!state.searchResult) wrap.innerHTML = ""`.
export function orgSearchClear() {
  const input = rootEl.querySelector("#org-search");
  if (input) input.value = "";
  state.searching = false;
  state.searchResult = null;
  state.searchError = null;
  renderSearchResults();
}

export async function orgSearchRun() {
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
          <span class="link-btn" data-open-link="${escapeAttr(orgSearchDuckDuckGoUrl(query))}">abrir busca no duckduckgo ${icon("external-link", { size: 11 })}</span>
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
        <span class="link-btn" data-open-link="${escapeAttr(orgSearchDuckDuckGoUrl(query))}">ver mais no duckduckgo ${icon("external-link", { size: 11 })}</span>
      </div>
    </div>`;
}
