/**
 * Organização — aba links: atalhos agrupados por categoria.
 * MAN-02: saiu de pages/organizacao.js, que continua montando a tela
 * (template, eventos, troca de aba) e guarda o `state` compartilhado.
 */
import * as api from "../api/organizacao.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "../modals/err-modal.js";
import { state, rootEl, escapeHtml, escapeAttr } from "./organizacao.js";
import { t } from "../i18n.js";

/* ==================== links ==================== */

export async function loadLinks() {
  state.links = await api.listLinks();
}

export function renderLinks() {
  const wrap = rootEl.querySelector("#org-linkgroups");
  if (!state.links.length) {
    wrap.innerHTML = `<div class="empty-state">${t("organizacao_links.nenhum_link_cadastrado_ainda")}</div>`;
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
          // Antes buscávamos o favicon em www.google.com/s2/favicons, o que
          // mandava o domínio de cada link salvo pro Google a cada abertura
          // — incompatível com a promessa de o app não falar com a internet
          // sem você pedir. Agora é só a inicial do domínio, calculada aqui.
          let initial = "?";
          try {
            initial = new URL(l.url).hostname.replace(/^www\./, "").charAt(0).toUpperCase() || "?";
          } catch (e) {
            /* url inválida — fica o "?" */
          }
          return `
            <div class="linkrow">
              <span class="favicon favicon-letter" aria-hidden="true">${escapeHtml(initial)}</span>
              <span class="lr-title" data-open-link="${escapeAttr(l.url)}" data-tooltip="${escapeHtml(l.title)}">${escapeHtml(l.title)}</span>
              <span class="lr-go" data-open-link="${escapeAttr(l.url)}">${icon("external-link", { size: 11 })}</span>
              <span class="lr-edit" data-tooltip="${t("geral.editar")}" aria-label="${t("geral.editar")}" data-edit-link="${l.id}">${icon("pencil", { size: 12 })}</span>
              <span class="lr-delete" data-delete-link="${l.id}">${icon("x")}</span>
            </div>`;
        })
        .join("");
      return `<div class="linkgroup"><div class="lg-label">${escapeHtml(cat)}</div>${rows}</div>`;
    })
    .join("");
}

export function openLinkModal(linkId) {
  const titleEl = rootEl.querySelector("#link-modal-title");
  const saveBtn = rootEl.querySelector("#link-save-btn");
  if (linkId) {
    const l = state.links.find((x) => x.id === linkId);
    rootEl.querySelector("#link-edit-id").value = l.id;
    rootEl.querySelector("#link-title").value = l.title;
    rootEl.querySelector("#link-url").value = l.url;
    rootEl.querySelector("#link-cat").value = l.category;
    titleEl.textContent = t("organizacao_links.editar_link");
    saveBtn.textContent = t("organizacao_links.salvar_link");
  } else {
    ["link-edit-id", "link-title", "link-url", "link-cat"].forEach((id) => (rootEl.querySelector("#" + id).value = ""));
    titleEl.textContent = t("organizacao_links.novo_link");
    saveBtn.textContent = t("organizacao_links.adicionar_link");
  }
  rootEl.querySelector("#link-modal").classList.add("open");
}
export function closeLinkModal() {
  rootEl.querySelector("#link-modal").classList.remove("open");
}

export async function handleSaveLink() {
  const editId = rootEl.querySelector("#link-edit-id").value;
  const title = rootEl.querySelector("#link-title").value.trim();
  const url = rootEl.querySelector("#link-url").value.trim();
  const category = rootEl.querySelector("#link-cat").value.trim() || "geral";
  if (!title || !url) {
    showErrorModal(t("organizacao_links.preencha_titulo_e_url"), t("geral.atencao"));
    return;
  }
  if (editId) {
    await api.updateLink(editId, { title, url, category });
  } else {
    await api.createLink({ title, url, category });
  }
  closeLinkModal();
  await loadLinks();
  renderLinks();
}

export async function handleDeleteLink(linkId) {
  await api.deleteLink(linkId);
  await loadLinks();
  renderLinks();
}
