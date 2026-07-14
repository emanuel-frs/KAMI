import {
  listEmailAccounts,
  createEmailAccount,
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
 * Backend: app/routers/organizacao.py — senha de app nunca sai da API
 * (ver EmailAccountOut), sync é sempre manual (sem chamada automática
 * ao criar a conta), e busca as últimas 20 mensagens da caixa por
 * padrão (não é uma janela de dias, é contagem — ver `limit` no router).
 */

let containerEl = null;
let modalEl = null;

// ---------------- modal "nova conta de e-mail" ----------------

function buildModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "email-account-modal";
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        nova conta de e-mail
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
        </div>
        <p class="al-hint">
          não é a senha normal da conta — gmail, outlook e a maioria dos provedores
          exigem gerar uma "senha de app" separada pra acesso imap de terceiros.
          a conexão só é testada na hora de sincronizar, não ao salvar.
        </p>
        <div style="display:flex; gap:8px; margin-top:4px;">
          <button type="button" class="btn primary" data-action="save">salvar conta</button>
          <button type="button" class="btn sm" data-action="cancel">cancelar</button>
        </div>
        <div class="ea-error" style="display:none; color:var(--red); font-size:10.5px; margin-top:8px;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wireModal(wrap);
  return wrap;
}

function resetModalFields(wrap) {
  wrap.querySelector("#ea-label").value = "";
  wrap.querySelector("#ea-host").value = "";
  wrap.querySelector("#ea-port").value = "993";
  wrap.querySelector("#ea-username").value = "";
  wrap.querySelector("#ea-password").value = "";
  wrap.querySelector(".ea-error").style.display = "none";
}

function wireModal(wrap) {
  wrap.querySelector('[data-action="close"]').addEventListener("click", () => closeModal());
  wrap.querySelector('[data-action="cancel"]').addEventListener("click", () => closeModal());
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeModal(); // fecha clicando fora, mesma convenção do modal de avatar
  });

  wrap.querySelector('[data-action="save"]').addEventListener("click", async () => {
    const label = wrap.querySelector("#ea-label").value.trim();
    const imapHost = wrap.querySelector("#ea-host").value.trim();
    const imapPort = parseInt(wrap.querySelector("#ea-port").value, 10) || 993;
    const username = wrap.querySelector("#ea-username").value.trim();
    const appPassword = wrap.querySelector("#ea-password").value;
    const errorEl = wrap.querySelector(".ea-error");
    errorEl.style.display = "none";

    if (!label || !imapHost || !username || !appPassword) {
      errorEl.textContent = "preencha apelido, host, usuário e senha de app.";
      errorEl.style.display = "block";
      return;
    }

    try {
      await createEmailAccount({
        label,
        imap_host: imapHost,
        imap_port: imapPort,
        username,
        app_password: appPassword,
      });
    } catch (err) {
      errorEl.textContent = `erro ao salvar conta: ${err.message}`;
      errorEl.style.display = "block";
      return;
    }

    closeModal();
    await refreshAccounts();
  });
}

function openModal() {
  modalEl = modalEl || buildModal();
  resetModalFields(modalEl);
  modalEl.classList.add("open");
}

function closeModal() {
  modalEl?.classList.remove("open");
}

// ---------------- contas ----------------

async function refreshAccounts() {
  const body = containerEl.querySelector("#org-accounts-body");
  let accounts;
  try {
    accounts = await listEmailAccounts();
  } catch (err) {
    body.innerHTML = `<div class="empty-state">erro ao carregar contas: ${err.message}</div>`;
    return;
  }

  if (!accounts.length) {
    body.innerHTML = '<div class="empty-state">nenhuma conta cadastrada ainda.</div>';
    return;
  }

  body.innerHTML = accounts
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
        <span class="widget-remove-btn" data-delete="${a.id}" title="remover conta">✕</span>
      </div>
    </div>`
    )
    .join("");
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
    msgEl.textContent = `✓ ${result.new_messages} novo(s)`;
    msgEl.style.display = "inline";
    setTimeout(() => (msgEl.style.display = "none"), 2500);
    await refreshEmails();
  } catch (err) {
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
  await refreshAccounts();
  await refreshEmails(); // cache da conta é removido em cascata no backend
}

// ---------------- e-mails (cache) ----------------

async function refreshEmails() {
  const body = containerEl.querySelector("#org-emails-body");
  let emails;
  try {
    emails = await listEmailCache();
  } catch (err) {
    body.innerHTML = `<div class="empty-state">erro ao carregar e-mails: ${err.message}</div>`;
    return;
  }

  if (!emails.length) {
    body.innerHTML = '<div class="empty-state">nenhum e-mail sincronizado ainda — adicione uma conta e clique em "sincronizar".</div>';
    return;
  }

  body.innerHTML = `
    <div class="log-list">
      ${emails
        .map(
          (e) => `
        <div class="log-item${e.is_read ? "" : " unread"}" data-mark-read="${e.id}" style="cursor:${e.is_read ? "default" : "pointer"};">
          <span class="desc">${escapeHtml(e.subject) || "(sem assunto)"}</span>
          <span class="meta">${escapeHtml(e.sender)} · ${fmtRelDate(e.received_at)}</span>
          <span class="tag${e.is_read ? "" : " unread"}">${e.is_read ? "lido" : "novo"}</span>
        </div>`
        )
        .join("")}
    </div>
  `;
}

async function handleMarkRead(cacheId, itemEl) {
  try {
    await markEmailRead(cacheId);
  } catch (err) {
    console.error("erro ao marcar e-mail como lido:", err);
    return;
  }
  await refreshEmails();
}

// ---------------- ciclo de vida da página ----------------

export async function mount(container) {
  containerEl = container;
  container.innerHTML = `
    <div class="page-head">
      <h1>organização</h1>
      <span class="tag-v1">v1</span>
    </div>
    <p class="page-sub">contas de e-mail conectadas via imap — sincronização é sempre manual.</p>
    <hr class="rule">

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
      <div class="card-body" id="org-emails-body">
        <div class="empty-state">carregando…</div>
      </div>
    </div>
  `;

  container.querySelector("#org-add-account").addEventListener("click", openModal);

  // delegação de eventos — evita reanexar listener a cada refresh das listas
  container.addEventListener("click", (e) => {
    const syncBtn = e.target.closest("[data-sync]");
    if (syncBtn) {
      handleSync(syncBtn.dataset.sync, syncBtn);
      return;
    }
    const delBtn = e.target.closest("[data-delete]");
    if (delBtn) {
      handleDelete(delBtn.dataset.delete);
      return;
    }
    const emailItem = e.target.closest("[data-mark-read]");
    if (emailItem && emailItem.classList.contains("unread")) {
      handleMarkRead(emailItem.dataset.markRead, emailItem);
    }
  });

  await Promise.all([refreshAccounts(), refreshEmails()]);
}

export function unmount() {
  containerEl = null;
  // o modal é um singleton anexado a document.body (mesmo padrão de
  // avatar-modal.js) — persiste entre montagens da página, só garantimos
  // que não fica aberto ao sair da tela.
  closeModal();
}