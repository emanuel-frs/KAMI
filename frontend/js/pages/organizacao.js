import {
  listEmailAccounts,
  createEmailAccount,
  updateEmailAccount,
  syncEmailAccount,
  deleteEmailAccount,
  listEmailCache,
  markEmailRead,
} from "../api/organizacao.js";
import { escapeHtml, fmtRelDate } from "../widgets/format.js";

/**
 * Página: organização (v1 — só a seção de e-mail por enquanto; links e
 * github ficam pra uma próxima rodada). Layout fixo, não usa o grid de
 * widgets configurável (isso é exclusivo de perfil/núcleo, decisão 17).
 *
 * Backend: app/routers/organizacao.py — senha de app nunca sai da API,
 * sync é sempre manual, busca as últimas 20 mensagens (não é janela de
 * dias). body_preview é sempre TEXTO PURO (nunca HTML) — ver comentário
 * de _extract_body_preview no router; o frontend NUNCA deve fazer
 * innerHTML direto de conteúdo de e-mail, mesmo esse trecho já
 * sanitizado no backend — sempre via escapeHtml.
 */

let containerEl = null;
let accountModalEl = null;
let detailModalEl = null;

let accountsCache = [];
// contas cuja última tentativa de sync falhou NESTA sessão — só assim a
// senha fica editável no modal (ver wireAccountModal). Não é persistido
// no backend, reseta ao recarregar a página.
const brokenAccounts = new Set();

let filterAccountId = "all";
let filterReadStatus = "all"; // "all" | "unread" | "read"

// ---------------- modal "conta de e-mail" (criar / editar) ----------------

function buildAccountModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "email-account-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span id="ea-modal-title">nova conta de e-mail</span>
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>apelido</label>
          <input type="text" id="ea-label" placeholder="ex: gmail pessoal">
        </div>
        <div class="field-row">
          <div class="field">
            <label>host imap</label>
            <input type="text" id="ea-host" placeholder="imap.gmail.com">
          </div>
          <div class="field" style="max-width:110px;">
            <label>porta</label>
            <input type="number" id="ea-port" value="993">
          </div>
        </div>
        <div class="field">
          <label>usuário (e-mail)</label>
          <input type="text" id="ea-username" placeholder="voce@gmail.com">
        </div>
        <div class="field">
          <label>senha de app</label>
          <input type="password" id="ea-password" placeholder="senha de app gerada no provedor">
          <div id="ea-password-hint" style="display:none; font-size:9.5px; color:var(--text-faint); margin-top:4px;"></div>
        </div>
        <p class="al-hint" id="ea-hint">
          não é a senha normal da conta — gmail, outlook e a maioria dos provedores
          exigem gerar uma "senha de app" separada pra acesso imap de terceiros.
          a conexão só é testada na hora de sincronizar, não ao salvar.
        </p>
        <div style="display:flex; gap:8px; margin-top:4px;">
          <button type="button" class="btn primary" data-action="save" id="ea-save-btn">salvar conta</button>
          <button type="button" class="btn sm" data-action="cancel">cancelar</button>
        </div>
        <div class="ea-error" style="display:none; color:var(--red); font-size:10.5px; margin-top:8px;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireAccountModal(wrap);
  return wrap;
}

function wireAccountModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", () => closeAccountModal());
  wrap.querySelector('[data-action="cancel"]').addEventListener("click", () => closeAccountModal());
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeAccountModal();
  });

  wrap.querySelector('[data-action="save"]').addEventListener("click", async () => {
    const label = wrap.querySelector("#ea-label").value.trim();
    const imapHost = wrap.querySelector("#ea-host").value.trim();
    const imapPort = parseInt(wrap.querySelector("#ea-port").value, 10) || 993;
    const username = wrap.querySelector("#ea-username").value.trim();
    const passwordInput = wrap.querySelector("#ea-password");
    const appPassword = passwordInput.disabled ? "" : passwordInput.value;
    const errorEl = wrap.querySelector(".ea-error");
    errorEl.style.display = "none";

    const editingId = wrap.dataset.editingId || null;

    if (!label || !imapHost || !username || (!editingId && !appPassword)) {
      errorEl.textContent = "preencha apelido, host, usuário e senha de app.";
      errorEl.style.display = "block";
      return;
    }

    const payload = { label, imap_host: imapHost, imap_port: imapPort, username };
    if (appPassword) payload.app_password = appPassword; // omitido = mantém a senha salva (edição)

    try {
      if (editingId) {
        await updateEmailAccount(editingId, payload);
        brokenAccounts.delete(editingId); // deu pra editar sem erro — assume que o problema foi resolvido
      } else {
        await createEmailAccount(payload);
      }
    } catch (err) {
      errorEl.textContent = `erro ao salvar conta: ${err.message}`;
      errorEl.style.display = "block";
      return;
    }

    closeAccountModal();
    await refreshAccounts();
  });
}

function openAccountModal(mode, account) {
  accountModalEl = accountModalEl || buildAccountModal();
  const wrap = accountModalEl;

  wrap.querySelector(".ea-error").style.display = "none";
  wrap.querySelector("#ea-label").value = account?.label ?? "";
  wrap.querySelector("#ea-host").value = account?.imap_host ?? "";
  wrap.querySelector("#ea-port").value = account?.imap_port ?? 993;
  wrap.querySelector("#ea-username").value = account?.username ?? "";

  const passwordInput = wrap.querySelector("#ea-password");
  const passwordHint = wrap.querySelector("#ea-password-hint");
  passwordInput.value = "";

  if (mode === "edit") {
    wrap.dataset.editingId = account.id;
    wrap.querySelector("#ea-modal-title").textContent = `editar: ${account.label}`;
    wrap.querySelector("#ea-save-btn").textContent = "salvar alterações";

    const isBroken = brokenAccounts.has(account.id);
    passwordInput.disabled = !isBroken;
    passwordInput.placeholder = isBroken
      ? "digite a nova senha de app"
      : "•••••••• (mantida)";
    passwordHint.style.display = "block";
    passwordHint.textContent = isBroken
      ? "a última sincronização falhou — troque a senha de app aqui se for esse o problema."
      : "senha atual mantida. só fica editável se a conexão desta conta falhar num sync.";
  } else {
    delete wrap.dataset.editingId;
    wrap.querySelector("#ea-modal-title").textContent = "nova conta de e-mail";
    wrap.querySelector("#ea-save-btn").textContent = "salvar conta";
    passwordInput.disabled = false;
    passwordInput.placeholder = "senha de app gerada no provedor";
    passwordHint.style.display = "none";
  }

  wrap.classList.add("open");
}

function closeAccountModal() {
  accountModalEl?.classList.remove("open");
}

// ---------------- modal "detalhe do e-mail" ----------------

function buildDetailModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "email-detail-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        detalhe do e-mail
        <span class="close" data-action="close">✕</span>
      </div>
      <div class="modal-body">
        <div class="email-detail-field">
          <label>assunto</label>
          <div class="val subject" id="ed-subject"></div>
        </div>
        <div class="email-detail-field">
          <label>remetente</label>
          <div class="val" id="ed-sender"></div>
        </div>
        <div class="email-detail-field">
          <label>recebido em</label>
          <div class="val" id="ed-date"></div>
        </div>
        <div class="email-detail-field">
          <label>prévia</label>
          <div class="val preview" id="ed-preview"></div>
          <button type="button" class="email-toggle-preview" id="ed-toggle-preview">ver mais ▾</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-action="close"]').addEventListener("click", () => wrap.classList.remove("open"));
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.classList.remove("open");
  });
  wrap.querySelector("#ed-toggle-preview").addEventListener("click", () => {
    const previewEl = wrap.querySelector("#ed-preview");
    const btn = wrap.querySelector("#ed-toggle-preview");
    const expanded = previewEl.classList.toggle("expanded");
    btn.textContent = expanded ? "ver menos ▴" : "ver mais ▾";
  });
  return wrap;
}

/**
 * Escapa o texto inteiro primeiro (nunca confia em nada vindo do
 * e-mail), e SÓ DEPOIS envolve as URLs já escapadas em <a>. Isso evita
 * qualquer chance de HTML do remetente escapar pro DOM — o que vira
 * link é sempre um recorte do texto já neutralizado, nunca o texto cru.
 */
function linkifyEscaped(rawText) {
  const escaped = escapeHtml(rawText);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const safeHref = url.replace(/"/g, "&quot;"); // defesa extra pro valor do atributo href
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="email-link">${url}</a>`;
  });
}

function renderPreview(wrap, bodyPreview) {
  const previewEl = wrap.querySelector("#ed-preview");
  const toggleBtn = wrap.querySelector("#ed-toggle-preview");

  previewEl.classList.remove("expanded");
  toggleBtn.textContent = "ver mais ▾";
  toggleBtn.style.display = "none";

  previewEl.innerHTML = bodyPreview
    ? linkifyEscaped(bodyPreview)
    : escapeHtml("sem prévia disponível pra este e-mail.");

  // só sabe se precisa do botão depois do layout calcular scrollHeight
  requestAnimationFrame(() => {
    if (previewEl.scrollHeight > previewEl.clientHeight + 2) {
      toggleBtn.style.display = "inline-block";
    }
  });
}

function openDetailModal(entry) {
  detailModalEl = detailModalEl || buildDetailModal();
  const wrap = detailModalEl;
  wrap.querySelector("#ed-subject").textContent = entry.subject || "(sem assunto)";
  wrap.querySelector("#ed-sender").textContent = entry.sender;
  wrap.querySelector("#ed-date").textContent = new Date(entry.received_at).toLocaleString("pt-BR");
  renderPreview(wrap, entry.body_preview);
  wrap.classList.add("open");
}

// ---------------- contas ----------------

async function refreshAccounts() {
  const body = containerEl.querySelector("#org-accounts-body");
  try {
    accountsCache = await listEmailAccounts();
  } catch (err) {
    body.innerHTML = `<div class="empty-state">erro ao carregar contas: ${err.message}</div>`;
    return;
  }

  if (!accountsCache.length) {
    body.innerHTML = '<div class="empty-state">nenhuma conta cadastrada ainda.</div>';
  } else {
    body.innerHTML = accountsCache
      .map(
        (a) => `
      <div class="org-account" data-account-row="${a.id}">
        <div class="org-account-info">
          <b>${escapeHtml(a.label)}</b>
          <span class="meta">${escapeHtml(a.username)} · ${escapeHtml(a.imap_host)}:${a.imap_port}</span>
        </div>
        <div class="org-account-actions">
          <span class="sync-msg" style="display:none;"></span>
          <button type="button" class="btn sm" data-sync="${a.id}">sincronizar</button>
          <span class="icon-btn" data-edit="${a.id}" title="editar conta">✎</span>
          <span class="widget-remove-btn" data-delete="${a.id}" title="remover conta">✕</span>
        </div>
      </div>`
      )
      .join("");
  }

  renderAccountFilterOptions();
}

function renderAccountFilterOptions() {
  const select = containerEl.querySelector("#org-filter-account");
  if (!select) return;
  const current = select.value || "all";
  select.innerHTML =
    `<option value="all">todas as contas</option>` +
    accountsCache.map((a) => `<option value="${a.id}">${escapeHtml(a.label)}</option>`).join("");
  // preserva a seleção se a conta ainda existir; senão volta pra "todas"
  select.value = accountsCache.some((a) => a.id === current) ? current : "all";
  filterAccountId = select.value;
}

async function handleSync(accountId, btn) {
  const row = btn.closest(".org-account");
  const msgEl = row.querySelector(".sync-msg");
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = "sincronizando…";
  msgEl.style.display = "none";

  try {
    const result = await syncEmailAccount(accountId);
    brokenAccounts.delete(accountId);
    msgEl.style.color = "var(--accent)";
    msgEl.textContent = `✓ ${result.new_messages} novo(s)`;
    msgEl.style.display = "inline";
    setTimeout(() => (msgEl.style.display = "none"), 2500);
    await refreshEmails();
  } catch (err) {
    brokenAccounts.add(accountId);
    msgEl.style.color = "var(--red)";
    msgEl.textContent = err.message;
    msgEl.style.display = "inline";
  }

  btn.disabled = false;
  btn.textContent = originalLabel;
}

async function handleDelete(accountId) {
  try {
    await deleteEmailAccount(accountId);
  } catch (err) {
    alert(`erro ao remover conta: ${err.message}`);
    return;
  }
  brokenAccounts.delete(accountId);
  await refreshAccounts();
  await refreshEmails(); // cache da conta é removido em cascata no backend
}

// ---------------- e-mails (cache) ----------------

function initialFromSender(sender) {
  // "sender" costuma vir como 'Nome <email@x.com>' ou só o e-mail
  const namePart = sender.split("<")[0].trim() || sender;
  return (namePart[0] || "?").toUpperCase();
}

async function refreshEmails() {
  const body = containerEl.querySelector("#org-emails-body");
  const params = {};
  if (filterAccountId !== "all") params.account_id = filterAccountId;
  if (filterReadStatus === "unread") params.is_read = false;
  if (filterReadStatus === "read") params.is_read = true;

  let emails;
  try {
    emails = await listEmailCache(params);
  } catch (err) {
    body.innerHTML = `<div class="empty-state">erro ao carregar e-mails: ${err.message}</div>`;
    return;
  }

  if (!emails.length) {
    body.innerHTML = accountsCache.length
      ? '<div class="empty-state">nenhum e-mail encontrado pra esse filtro.</div>'
      : '<div class="empty-state">nenhum e-mail sincronizado ainda — adicione uma conta e clique em "sincronizar".</div>';
    return;
  }

  body.innerHTML = `
    <div class="log-list" id="org-emails-list"></div>
  `;
  const listEl = body.querySelector("#org-emails-list");
  listEl.innerHTML = emails
    .map(
      (e) => `
    <div class="email-item${e.is_read ? "" : " unread"}" data-email-id="${e.id}">
      <div class="email-avatar">${escapeHtml(initialFromSender(e.sender))}</div>
      <div class="email-main">
        <div class="email-top">
          <span class="email-subject">${escapeHtml(e.subject) || "(sem assunto)"}</span>
          <span class="email-tag">${e.is_read ? "lido" : "novo"}</span>
        </div>
        <div class="email-sender">${escapeHtml(e.sender)}</div>
        ${e.body_preview ? `<div class="email-preview">${escapeHtml(e.body_preview)}</div>` : ""}
      </div>
      <div class="email-meta">${fmtRelDate(e.received_at)}</div>
    </div>`
    )
    .join("");

  // guarda os dados completos pra abrir o modal de detalhe sem outra
  // chamada de rede — a lista já tem tudo que o detalhe precisa
  listEl._entries = new Map(emails.map((e) => [e.id, e]));
}

async function handleOpenEmail(cacheId, itemEl) {
  const entry = containerEl.querySelector("#org-emails-list")?._entries?.get(cacheId);
  if (entry) openDetailModal(entry);

  if (itemEl.classList.contains("unread")) {
    try {
      await markEmailRead(cacheId);
    } catch (err) {
      console.error("erro ao marcar e-mail como lido:", err);
      return;
    }
    await refreshEmails();
  }
}

// ---------------- ciclo de vida da página ----------------

export async function mount(container) {
  containerEl = container;
  container.innerHTML = `
    <div class="wg-toolbar">
      <button type="button" class="btn sm" id="org-add-account">+ adicionar conta</button>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-head">contas de e-mail</div>
      <div class="card-body" id="org-accounts-body">
        <div class="empty-state">carregando…</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">e-mails</div>
      <div class="card-body">
        <div class="field-row" style="margin-bottom:8px;">
          <div class="field">
            <label>conta</label>
            <select id="org-filter-account">
              <option value="all">todas as contas</option>
            </select>
          </div>
          <div class="field">
            <label>status</label>
            <select id="org-filter-read">
              <option value="all">todos</option>
              <option value="unread">não lidos</option>
              <option value="read">lidos</option>
            </select>
          </div>
        </div>
        <div id="org-emails-body">
          <div class="empty-state">carregando…</div>
        </div>
      </div>
    </div>
  `;

  container.querySelector("#org-add-account").addEventListener("click", () => openAccountModal("create"));

  container.querySelector("#org-filter-account").addEventListener("change", (e) => {
    filterAccountId = e.target.value;
    refreshEmails();
  });
  container.querySelector("#org-filter-read").addEventListener("change", (e) => {
    filterReadStatus = e.target.value;
    refreshEmails();
  });

  // delegação de eventos — evita reanexar listener a cada refresh das listas
  container.addEventListener("click", (e) => {
    const syncBtn = e.target.closest("[data-sync]");
    if (syncBtn) {
      handleSync(syncBtn.dataset.sync, syncBtn);
      return;
    }
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      const account = accountsCache.find((a) => a.id === editBtn.dataset.edit);
      if (account) openAccountModal("edit", account);
      return;
    }
    const delBtn = e.target.closest("[data-delete]");
    if (delBtn) {
      handleDelete(delBtn.dataset.delete);
      return;
    }
    const emailItem = e.target.closest("[data-email-id]");
    if (emailItem) {
      handleOpenEmail(emailItem.dataset.emailId, emailItem);
    }
  });

  await refreshAccounts();
  await refreshEmails();
}

export function unmount() {
  containerEl = null;
  // os modais são singletons anexados a document.body (mesmo padrão de
  // avatar-modal.js) — persistem entre montagens da página, só garantimos
  // que não ficam abertos ao sair da tela.
  closeAccountModal();
  detailModalEl?.classList.remove("open");
}