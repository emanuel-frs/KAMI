/**
 * Aba "chaves" das configurações: token do GitHub, chave da busca e as
 * contas de e-mail (cadastrar, editar, silenciar, sincronizar).
 * MAN-02: saiu de configuracoes-modal.js.
 */
import {
  listEmailAccounts,
  createEmailAccount,
  updateEmailAccount,
  deleteEmailAccount,
  syncEmailAccount,
  listMutedAccounts,
  muteAccount,
  unmuteAccount,
  saveGithubToken,
  deleteGithubToken,
  saveSearchKey,
  deleteSearchKey,
} from "../../api/organizacao.js";
import { escapeHtml } from "../../components/format.js";
import { showErrorModal } from "../err-modal.js";
import { showConfirmModal } from "../confirm-modal.js";
import { icon } from "../../components/icons.js";
import { prefersReducedMotion } from "../../components/a11y.js";
import { estado } from "./estado.js";
import { t } from "../../i18n.js";

// aba chaves — estado da lista de contas de e-mail (ver wireChavesTab()
// mais abaixo). Módulo-level porque a lista é recarregada e
// re-renderizada em vários pontos (após salvar/editar/remover/mute/
// sync), sem depender de reabrir o modal inteiro.
let chavesAccounts = [];
let chavesMutedAccounts = [];
let chavesSyncingIds = new Set();

export function buildChavesPanel() {
  return `
    <div class="cfg-panel" data-panel="chaves">
      <div class="settings-section" style="padding-top:0;">
        <h4>${t("chaves.chave_de_busca_tavily")} <span id="cfg-search-badge" class="gh-token-badge"></span></h4>
        <p class="settings-desc">
          ${t("chaves.necessaria_pro_resumo_inline_de")} <span data-open-link="https://tavily.com" style="color:var(--accent); cursor:pointer; text-decoration:underline;">${t("chaves.tavily_com")}</span>
          ${t("chaves.free_tier_1000_buscas_mes")}
        </p>
        <div class="field"><input type="password" id="cfg-search-key-input" placeholder="${t("chaves.tvly")}"></div>
        <div id="cfg-search-key-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
        <div class="form-actions">
          <button class="btn sm" id="cfg-search-save-btn">${t("chaves.salvar_chave")}</button>
          <button class="btn sm" id="cfg-search-delete-btn">${t("chaves.remover_chave")}</button>
        </div>
      </div>

      <div class="settings-section">
        <h4>${t("chaves.token_do_github")} <span id="cfg-github-badge" class="gh-token-badge"></span></h4>
        <p class="settings-desc">${t("chaves.opcional_sem_token_so_repositorios")}</p>
        <div class="field"><input type="password" id="cfg-gh-token-input" placeholder="${t("chaves.github_pat")}"></div>
        <div id="cfg-gh-token-error" style="display:none; color:var(--red); font-size:10.5px; margin-bottom:8px;"></div>
        <div class="form-actions">
          <button class="btn sm" id="cfg-gh-save-btn">${t("chaves.salvar_token")}</button>
          <button class="btn sm" id="cfg-gh-delete-btn">${t("chaves.remover_token")}</button>
        </div>
      </div>

      <div class="settings-section">
        <h4>${t("chaves.contas_de_e_mail")}</h4>
        <p class="settings-desc">${t("chaves.edite_remova_marque_como_padrao")}</p>
        <div id="cfg-accounts-list"></div>
        <div class="form-actions" style="margin-top:8px;">
          <button type="button" class="btn sm" id="cfg-acc-toggle-btn">${t("chaves.nova_conta")}</button>
        </div>
        <div id="cfg-acc-form-wrap" style="display:none; margin-top:10px;">
          <input type="hidden" id="cfg-acc-edit-id">
          <div class="field"><label for="cfg-acc-label">${t("chaves.apelido")}</label><input type="text" id="cfg-acc-label" placeholder="${t("chaves.ex_gmail_pessoal")}"></div>
          <div class="field-row">
            <div class="field"><label for="cfg-acc-host">${t("chaves.host_imap")}</label><input type="text" id="cfg-acc-host" placeholder="${t("chaves.imap_gmail_com")}"></div>
            <div class="field" style="max-width:110px;"><label for="cfg-acc-port">${t("chaves.porta")}</label><input type="number" id="cfg-acc-port" value="993"></div>
          </div>
          <div class="field"><label for="cfg-acc-username">${t("chaves.usuario")}</label><input type="text" id="cfg-acc-username" placeholder="${t("chaves.voce_gmail_com")}"></div>
          <div class="field"><label for="cfg-acc-password">${t("chaves.senha_de_app")} <span id="cfg-acc-password-hint" style="color:var(--text-faint); font-size:9.5px;"></span></label><input type="password" id="cfg-acc-password" placeholder="••••••••"></div>
          <label class="acc-default-toggle"><input type="checkbox" id="cfg-acc-sync-by-default" checked> ${icon("star", { size: 12 })} ${t("chaves.conta_padrao_ja_vem_selecionada")}</label>
          <div id="cfg-acc-error" style="display:none; color:var(--red); font-size:10.5px; margin:8px 0;"></div>
          <div class="form-actions">
            <button class="btn sm" id="cfg-acc-save-btn">${t("chaves.salvar_conta")}</button>
            <button class="btn sm" id="cfg-acc-cancel-btn">${t("geral.cancelar")}</button>
          </div>
          <p class="settings-status" id="cfg-acc-status"></p>
        </div>
      </div>
    </div>`;
}

// ── aba chaves ───────────────────────────────────────────────────────
// (mesmos endpoints/estado de pages/organizacao.js — essa aba é só uma
// segunda superfície de UI pras mesmas três credenciais, ver cabeçalho
// do arquivo. Status do token/chave e a lista de contas são buscados
// toda vez que o modal abre, junto com o profile, em
// openConfiguracoesModal().)
export function renderGithubBadge(wrap, configured) {
  const badge = wrap.querySelector("#cfg-github-badge");
  badge.innerHTML = configured
    ? `<span class="status-dot"></span> ${t("chaves.token_ativo")}`
    : `<span class="status-dot"></span> ${t("chaves.sem_token")}`;
  badge.classList.toggle("on", configured);
}

export function renderSearchBadge(wrap, configured) {
  const badge = wrap.querySelector("#cfg-search-badge");
  badge.innerHTML = configured
    ? `<span class="status-dot"></span> ${t("chaves.chave_ativa")}`
    : `<span class="status-dot"></span> ${t("chaves.sem_chave")}`;
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
    listEl.innerHTML = `<div class="empty-state">${t("chaves.nenhuma_conta_cadastrada_ainda")}</div>`;
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
          <span class="meta">${escapeHtml(a.username)} · ${escapeHtml(a.imap_host)}:${a.imap_port}${muted ? ` · <span class="email-muted-tag">${icon("bell-off", { size: 9 })} ${t("chaves.silenciada")}</span>` : ""}</span>
        </div>
        <div class="org-account-actions">
          <span class="icon-btn" data-tooltip="${muted ? t("chaves.reativar_notificacoes_desta_conta") : t("chaves.silenciar_notificacoes_desta_conta")}" data-cfg-mute-account="${a.id}">${icon(muted ? "bell" : "bell-off", { size: 12 })}</span>
          <span class="icon-btn${syncing ? " is-syncing" : ""}" data-tooltip="${syncing ? "sincronizando..." : "sincronizar"}" data-cfg-sync-account="${syncing ? "" : a.id}">${icon("refresh-cw", { size: 12 })}</span>
          <span class="icon-btn" data-tooltip="${t("geral.editar")}" data-cfg-edit-account="${a.id}">${icon("pencil", { size: 12 })}</span>
          <span class="icon-btn" data-tooltip="${t("geral.remover")}" data-cfg-delete-account="${a.id}">${icon("x")}</span>
        </div>
      </div>`;
    })
    .join("");
}

export async function loadChavesAccounts(wrap) {
  try {
    const [accounts, muted] = await Promise.all([listEmailAccounts(), listMutedAccounts()]);
    chavesAccounts = accounts;
    chavesMutedAccounts = muted;
  } catch (err) {
    showErrorModal(err.message, t("chaves.erro_ao_carregar_contas_de"));
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
    hint.textContent = t("chaves.deixe_em_branco_pra_manter");
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
  toggleBtn.textContent = t("geral.cancelar");

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

export function closeChavesForm(wrap) {
  wrap.querySelector("#cfg-acc-form-wrap").style.display = "none";
  wrap.querySelector("#cfg-acc-toggle-btn").textContent = t("chaves.nova_conta");
  wrap.querySelector("#cfg-acc-edit-id").value = "";
}

async function handleDeleteChavesAccount(wrap, accountId) {
  const ok = await showConfirmModal(t("chaves.remover_esta_conta_o_cache"), {
    title: t("chaves.remover_conta"),
    confirmText: t("geral.remover"),
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteEmailAccount(accountId);
  } catch (err) {
    showErrorModal(err.message, t("chaves.erro_ao_remover_conta"));
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
    showErrorModal(err.message, t("chaves.erro_ao_atualizar_silenciamento"));
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
    showErrorModal(err?.message || t("chaves.falha_ao_sincronizar_confira_host"), t("chaves.falha_ao_sincronizar"));
  } finally {
    chavesSyncingIds.delete(accountId);
  }
  await loadChavesAccounts(wrap);
}

export function wireChavesTab(wrap) {
  wrap.querySelector("#cfg-acc-toggle-btn").addEventListener("click", () => {
    const formWrap = wrap.querySelector("#cfg-acc-form-wrap");
    if (formWrap.style.display === "none") openChavesForm(wrap);
    else closeChavesForm(wrap);
  });
  wrap.querySelector("#cfg-acc-cancel-btn").addEventListener("click", () => closeChavesForm(wrap));

  wrap.querySelector("#cfg-acc-save-btn").addEventListener("click", async () => {
    if (estado.busy) return;
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
      errEl.textContent = t("chaves.preencha_apelido_host_usuario_e");
      errEl.style.display = "block";
      return;
    }

    const btn = wrap.querySelector("#cfg-acc-save-btn");
    btn.disabled = true;
    btn.textContent = t("chaves.salvando");
    try {
      if (editId) {
        const payload = { label, imap_host, imap_port, username, sync_by_default };
        if (app_password) payload.app_password = app_password;
        await updateEmailAccount(editId, payload);
      } else {
        await createEmailAccount({ label, imap_host, imap_port, username, app_password, sync_by_default });
      }
    } catch (err) {
      errEl.textContent = err?.message || t("chaves.falha_ao_salvar_a_conta");
      errEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = t("chaves.salvar_conta");
      return;
    }
    btn.disabled = false;
    btn.textContent = t("chaves.salvar_conta");

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
      errEl.textContent = t("chaves.cole_um_token");
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
        showErrorModal(result.import_error, t("chaves.token_salvo_mas_a_importacao"));
      }
    } catch (err) {
      errEl.textContent = err?.message || t("chaves.token_invalido_ou_sem_permissao");
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
      errEl.textContent = t("chaves.cole_uma_chave");
      errEl.style.display = "block";
      return;
    }
    try {
      await saveSearchKey(key);
    } catch (err) {
      errEl.textContent = err?.message || t("chaves.chave_invalida");
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
