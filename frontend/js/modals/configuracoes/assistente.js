/**
 * Aba "assistente" das configurações (IA-01): ligar/desligar, provedores
 * salvos, chave da API, modelo e o teto de uso.
 *
 * Princípios que esta tela segue (docs/EVOLUCAO-CARDS.md, seção 9):
 * - desligado por padrão (6): o interruptor só destrava quando há um
 *   provedor pronto, e diz o que falta;
 * - transparência (5): mostra sempre qual provedor/modelo está em uso, se
 *   é local ou nuvem e PRA ONDE vai o que a pessoa escrever;
 * - envelhecer bem (8): o modelo vem do /models do provedor (botão
 *   "buscar modelos"), mas o campo aceita qualquer nome digitado;
 * - a chave da API nunca volta do backend (`tem_chave`); trocar o endereço
 *   de um provedor com chave salva apaga a chave (P-109) — o formulário
 *   avisa antes de salvar.
 *
 * O chat (painel, Alt+A) é do IA-02 (components/assistente-painel.js);
 * aqui fica a parte de guardar conversas (P-105) e o "apagar tudo".
 */
import {
  apagarProvedor,
  apagarTodasConversas,
  criarProvedor,
  editarProvedor,
  getAssistente,
  getCatalogo,
  getConversas,
  getProvedores,
  listarModelos,
  salvarConfigAssistente,
  testarProvedor,
  usarProvedor,
} from "../../api/assistente.js";
import { escapeHtml, fmtDataHora } from "../../components/format.js";
import { enhanceSelect, destroyCustomSelect } from "../../components/custom-select.js";
import { showConfirmModal } from "../confirm-modal.js";
import { icon } from "../../components/icons.js";
import { localeAtual, t } from "../../i18n.js";

// estado da aba (recarregado a cada abertura — ver carregarAssistente)
let catalogo = [];
let provedores = [];
let estadoIa = null;
let modelosCarregados = [];
let editando = null; // provedor salvo em edição, ou null (novo)

const num = (n) => new Intl.NumberFormat(localeAtual()).format(n);

// P-113: áreas que o assistente pode ler (mesma lista de backend/app/assistente/config.py::AREAS)
const AREAS = ["financas", "metas", "agenda", "habitos", "aprendizado", "progresso", "entrada", "links", "github", "notas"];

export function buildAssistentePanel() {
  return `
    <div class="cfg-panel" data-panel="assistente">
      <div class="settings-section" style="padding-top:0;">
        <h4>${t("assistente.assistente_de_ia")} <span id="cfg-ia-badge" class="gh-token-badge"></span></h4>
        <p class="settings-desc">${t("assistente.descricao")}</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-ia-ativo" disabled>
          ${icon("terminal", { size: 12 })}
          <span>${t("assistente.ligar_o_assistente")} <small id="cfg-ia-falta"></small></span>
        </label>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-ia-escondido">
          ${icon("x", { size: 12 })}
          <span>${t("assistente.esconder_o_botao")} <small>${t("assistente.esconder_o_botao_dica")}</small></span>
        </label>
        <p class="cfg-seg-chave" id="cfg-ia-em-uso" hidden></p>
        <p class="settings-status" id="cfg-ia-status" role="status"></p>
      </div>

      <div class="settings-section">
        <h4>${t("assistente.provedores")}</h4>
        <p class="settings-desc">${t("assistente.provedores_desc")}</p>
        <div id="cfg-ia-lista"></div>
        <div class="form-actions" style="margin-top:8px;">
          <button type="button" class="btn sm" id="cfg-ia-novo">${t("assistente.adicionar_provedor")}</button>
        </div>
        <div id="cfg-ia-form" class="cfg-ia-form" hidden></div>
      </div>

      <div class="settings-section">
        <h4>${t("assistente.pode_ler")}</h4>
        <p class="settings-desc">${t("assistente.pode_ler_desc")}</p>
        <div class="cfg-ia-areas" id="cfg-ia-areas">
          ${AREAS.map((a) => `
          <label class="cfg-toggle">
            <input type="checkbox" data-ia-area="${a}">
            <span>${t(`assistente.area.${a}`)}</span>
          </label>`).join("")}
        </div>
        <p class="settings-note">${t("assistente.pode_ler_nota")}</p>
        <p class="settings-status" id="cfg-ia-areas-status" role="status"></p>
      </div>

      <div class="settings-section">
        <h4>${t("assistente.limites_de_uso")}</h4>
        <p class="settings-desc">${t("assistente.limites_desc")}</p>
        <p class="cfg-ia-uso" id="cfg-ia-uso"></p>
        <div class="field-row">
          <div class="field"><label for="cfg-ia-teto-chamadas">${t("assistente.chamadas_por_dia")}</label><input type="number" id="cfg-ia-teto-chamadas" min="1" max="10000" step="1"></div>
          <div class="field"><label for="cfg-ia-teto-tokens">${t("assistente.tokens_por_dia")}</label><input type="number" id="cfg-ia-teto-tokens" min="1000" max="100000000" step="1000"></div>
          <div class="field"><label for="cfg-ia-rodadas">${t("assistente.consultas_por_mensagem")}</label><input type="number" id="cfg-ia-rodadas" min="1" max="20" step="1"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn sm" id="cfg-ia-limites-ok">${t("assistente.salvar_limites")}</button>
        </div>
        <p class="settings-status" id="cfg-ia-limites-status" role="status"></p>
      </div>

      <div class="settings-section">
        <h4>${t("assistente.conversas")}</h4>
        <p class="settings-desc">${t("assistente.conversas_desc")}</p>
        <label class="cfg-toggle">
          <input type="checkbox" id="cfg-ia-guardar">
          ${icon("archive", { size: 12 })}
          <span>${t("assistente.guardar_conversas")} <small>${t("assistente.guardar_conversas_dica")}</small></span>
        </label>
        <div class="field-row">
          <div class="field"><label for="cfg-ia-dias">${t("assistente.apagar_depois_de_dias")}</label><input type="number" id="cfg-ia-dias" min="1" max="3650" step="1"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn sm" id="cfg-ia-dias-ok">${t("assistente.salvar_prazo")}</button>
          <button type="button" class="btn sm danger" id="cfg-ia-limpar-conversas">${t("assistente.chat.apagar_tudo")}</button>
        </div>
        <p class="settings-status" id="cfg-ia-conversas-status" role="status"></p>
      </div>
    </div>`;
}

// ── mensagens de status ───────────────────────────────────────────────

function status(wrap, id, html, erro = false) {
  const el = wrap.querySelector(`#${id}`);
  if (!el) return;
  el.innerHTML = html;
  el.classList.toggle("settings-status--visible", Boolean(html));
  el.classList.toggle("cfg-ia-falha", erro);
}

/** Mensagem do erro + o que o provedor disse (quando disse algo). */
function textoDoErro(err) {
  const detalhe = err?.body?.vars?.detalhe;
  const base = escapeHtml(err?.message || String(err));
  return detalhe ? `${base}<br><small class="cfg-ia-detalhe">${escapeHtml(t("assistente.o_provedor_disse", { detalhe }))}</small>` : base;
}

function hostDe(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ── estado geral (interruptor, em uso, uso de hoje) ─────────────────────

const FALTA = {
  provedor: "assistente.falta_provedor",
  modelo: "assistente.falta_modelo",
  chave: "assistente.falta_chave",
};

function renderEstado(wrap) {
  const e = estadoIa;
  const ativo = wrap.querySelector("#cfg-ia-ativo");
  ativo.checked = e.config.ativo;
  ativo.disabled = !(e.pronto || e.falta === "desligado");
  // teste que falhou não trava o interruptor (pode ter sido a internet),
  // mas fica dito ao lado dele
  const falhou = e.provedor?.teste_ok === false;
  wrap.querySelector("#cfg-ia-falta").textContent = FALTA[e.falta] ? t(FALTA[e.falta]) : falhou ? t("assistente.teste_falhou") : "";
  wrap.querySelector("#cfg-ia-escondido").checked = e.config.escondido;

  const badge = wrap.querySelector("#cfg-ia-badge");
  badge.innerHTML = `<span class="status-dot"></span> ${e.config.ativo ? t("assistente.ligado") : t("assistente.desligado")}`;
  badge.classList.toggle("on", e.config.ativo);

  const emUso = wrap.querySelector("#cfg-ia-em-uso");
  const p = e.provedor;
  emUso.hidden = !p;
  if (p) {
    // local ganha a borda de "protegido" da aba segurança; nuvem fica neutra
    if (p.local) emUso.dataset.local = "cofre";
    else delete emUso.dataset.local;
    const onde = p.local ? t("assistente.em_uso_local") : t("assistente.em_uso_nuvem", { host: hostDe(p.url_base) });
    emUso.innerHTML = `${icon(p.local ? "lock" : "external-link", { size: 12 })} ${escapeHtml(
      t("assistente.em_uso", { nome: p.nome, modelo: p.modelo || "—" })
    )}<br><small>${escapeHtml(onde)}</small>`;
  }

  const u = e.uso_hoje;
  const limitado = p && !p.local;
  wrap.querySelector("#cfg-ia-uso").innerHTML = escapeHtml(
    t("assistente.uso_hoje", {
      chamadas: num(u.chamadas),
      teto_chamadas: num(e.config.teto_chamadas),
      tokens: num(u.tokens),
      teto_tokens: num(e.config.teto_tokens),
    })
  ) + (u.estimado ? ` <small>${escapeHtml(t("assistente.estimado"))}</small>` : "")
    + (p && !limitado ? `<br><small>${escapeHtml(t("assistente.local_sem_teto"))}</small>` : "");

  wrap.querySelector("#cfg-ia-teto-chamadas").value = e.config.teto_chamadas;
  wrap.querySelector("#cfg-ia-teto-tokens").value = e.config.teto_tokens;
  wrap.querySelector("#cfg-ia-rodadas").value = e.config.max_rodadas;
  wrap.querySelector("#cfg-ia-guardar").checked = e.config.guardar_conversas;
  wrap.querySelectorAll("[data-ia-area]").forEach((cb) => (cb.checked = Boolean(e.permissoes?.[cb.dataset.iaArea])));
  wrap.querySelector("#cfg-ia-dias").value = e.config.dias_historico;
}

// ── lista de provedores ────────────────────────────────────────────────

function textoDoTeste(p) {
  if (p.teste_ok === null) return `<span class="cfg-ia-teste">${escapeHtml(t("assistente.nao_testado"))}</span>`;
  if (!p.teste_ok) return `<span class="cfg-ia-teste cfg-ia-teste--falha">${icon("triangle-alert", { size: 10 })} ${escapeHtml(t("assistente.teste_falhou"))}</span>`;
  const quando = escapeHtml(fmtDataHora(p.teste_em));
  return p.ferramentas_ok
    ? `<span class="cfg-ia-teste cfg-ia-teste--ok">${icon("check", { size: 10 })} ${escapeHtml(t("assistente.teste_ok_ferramentas"))} · ${quando}</span>`
    : `<span class="cfg-ia-teste cfg-ia-teste--aviso">${icon("triangle-alert", { size: 10 })} ${escapeHtml(t("assistente.teste_ok_sem_ferramentas"))} · ${quando}</span>`;
}

function textoDoSelo(p) {
  return p.selo
    ? t("assistente.selo_testado", { data: p.selo.data, modelo: p.selo.modelo })
    : t("assistente.selo_deve_funcionar");
}

function renderLista(wrap) {
  const el = wrap.querySelector("#cfg-ia-lista");
  if (!provedores.length) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(t("assistente.nenhum_provedor"))}</div>`;
    return;
  }
  const emUsoId = estadoIa?.config.provedor_id;
  el.innerHTML = provedores
    .map((p) => {
      const emUso = p.id === emUsoId;
      const tags = [
        p.local ? t("assistente.local") : t("assistente.nuvem"),
        p.chave_exigida && !p.tem_chave ? t("assistente.sem_chave") : null,
      ].filter(Boolean);
      return `
      <div class="org-account cfg-ia-prov${emUso ? " is-em-uso" : ""}" data-ia-prov="${escapeHtml(p.id)}">
        <div class="org-account-info">
          <b>${escapeHtml(p.nome)}${emUso ? ` <span class="cfg-ia-tag cfg-ia-tag--uso">${escapeHtml(t("assistente.em_uso_tag"))}</span>` : ""}
            ${tags.map((x) => `<span class="cfg-ia-tag">${escapeHtml(x)}</span>`).join("")}</b>
          <span class="meta">${escapeHtml(p.modelo || t("assistente.sem_modelo"))} · ${escapeHtml(hostDe(p.url_base))}</span>
          <span class="meta">${textoDoTeste(p)} · <span class="cfg-ia-selo">${escapeHtml(textoDoSelo(p))}</span></span>
          <p class="settings-status cfg-ia-prov-status" role="status"></p>
        </div>
        <div class="org-account-actions">
          ${emUso ? "" : `<button type="button" class="btn sm" data-ia-acao="usar">${escapeHtml(t("assistente.usar"))}</button>`}
          <button type="button" class="btn sm" data-ia-acao="testar">${escapeHtml(t("assistente.testar"))}</button>
          <span class="icon-btn" role="button" tabindex="0" data-tooltip="${escapeHtml(t("geral.editar"))}" aria-label="${escapeHtml(t("geral.editar"))}" data-ia-acao="editar">${icon("pencil", { size: 12 })}</span>
          <span class="icon-btn" role="button" tabindex="0" data-tooltip="${escapeHtml(t("geral.remover"))}" aria-label="${escapeHtml(t("geral.remover"))}" data-ia-acao="remover">${icon("x")}</span>
        </div>
      </div>`;
    })
    .join("");
}

function statusDaLinha(wrap, id, html, erro = false) {
  const linha = [...wrap.querySelectorAll("[data-ia-prov]")].find((x) => x.dataset.iaProv === id);
  const el = linha?.querySelector(".cfg-ia-prov-status");
  if (!el) return;
  el.innerHTML = html;
  el.classList.toggle("settings-status--visible", Boolean(html));
  el.classList.toggle("cfg-ia-falha", erro);
}

async function testar(wrap, id, botao) {
  if (botao) botao.disabled = true;
  statusDaLinha(wrap, id, escapeHtml(t("assistente.testando")));
  try {
    const r = await testarProvedor(id);
    provedores = provedores.map((p) => (p.id === id ? r.provedor : p));
    estadoIa = { ...estadoIa, uso_hoje: r.uso_hoje };
    renderLista(wrap);
    renderEstado(wrap);
    const seg = (r.ms / 1000).toLocaleString(localeAtual(), { maximumFractionDigits: 1 });
    statusDaLinha(
      wrap,
      id,
      escapeHtml(r.ferramentas ? t("assistente.resultado_ok", { seg }) : t("assistente.resultado_sem_ferramentas", { seg })),
      false
    );
  } catch (err) {
    await recarregar(wrap);
    statusDaLinha(wrap, id, textoDoErro(err), true);
  }
}

async function acaoDaLinha(wrap, el) {
  const linha = el.closest("[data-ia-prov]");
  const id = linha?.dataset.iaProv;
  const p = provedores.find((x) => x.id === id);
  if (!p) return;
  const acao = el.dataset.iaAcao;
  if (acao === "testar") return testar(wrap, id, el);
  if (acao === "editar") return abrirForm(wrap, p);
  if (acao === "usar") {
    try {
      estadoIa = await usarProvedor(id);
      renderEstado(wrap);
      renderLista(wrap);
    } catch (err) {
      statusDaLinha(wrap, id, textoDoErro(err), true);
    }
    return;
  }
  if (acao === "remover") {
    const ok = await showConfirmModal(t("assistente.remover_confirma", { nome: p.nome }), {
      title: t("assistente.remover_provedor"),
      confirmText: t("geral.remover"),
      danger: true,
    });
    if (!ok) return;
    try {
      await apagarProvedor(id);
      if (editando?.id === id) fecharForm(wrap);
      await recarregar(wrap);
    } catch (err) {
      statusDaLinha(wrap, id, textoDoErro(err), true);
    }
  }
}

// ── formulário (novo / editar) ──────────────────────────────────────────

function catalogoDe(id) {
  return catalogo.find((c) => c.id === id) || catalogo.find((c) => c.id === "outro");
}

function infoDoCatalogo(c) {
  const partes = [];
  if (c.gratuito === "sim") partes.push(t("assistente.gratuito_sim"));
  else if (c.gratuito === "limitado") partes.push(t("assistente.gratuito_limitado"));
  else if (c.gratuito === "nao") partes.push(t("assistente.gratuito_nao"));
  partes.push(c.local ? t("assistente.roda_neste_computador") : t("assistente.roda_na_nuvem"));
  const links = [];
  if (c.links?.chave) links.push(`<span class="cfg-ia-link" role="link" tabindex="0" data-open-link="${escapeHtml(c.links.chave)}">${escapeHtml(t("assistente.criar_chave"))}</span>`);
  if (c.links?.privacidade) links.push(`<span class="cfg-ia-link" role="link" tabindex="0" data-open-link="${escapeHtml(c.links.privacidade)}">${escapeHtml(t("assistente.politica_de_dados"))}</span>`);
  if (!links.length && c.links?.site) links.push(`<span class="cfg-ia-link" role="link" tabindex="0" data-open-link="${escapeHtml(c.links.site)}">${escapeHtml(t("assistente.site"))}</span>`);
  return `${escapeHtml(partes.join(" · "))}${links.length ? ` · ${links.join(" · ")}` : ""}`;
}

function formHtml(p) {
  const opcoes = catalogo
    .map((c) => `<option value="${escapeHtml(c.id)}"${(p ? p.catalogo : "gemini") === c.id ? " selected" : ""}>${escapeHtml(c.id === "outro" ? t("assistente.outro_compativel") : c.nome)}</option>`)
    .join("");
  return `
    <h5 class="cfg-subhead">${escapeHtml(p ? t("assistente.editar_provedor", { nome: p.nome }) : t("assistente.novo_provedor"))}</h5>
    <div class="field">
      <label for="cfg-ia-catalogo">${escapeHtml(t("assistente.provedor"))}</label>
      <select id="cfg-ia-catalogo"${p ? " disabled" : ""}>${opcoes}</select>
    </div>
    <p class="settings-note" id="cfg-ia-cat-info"></p>
    <div class="field">
      <label for="cfg-ia-url">${escapeHtml(t("assistente.endereco_da_api"))}</label>
      <input type="text" inputmode="url" id="cfg-ia-url" autocomplete="off" spellcheck="false">
    </div>
    <div class="field" id="cfg-ia-chave-campo">
      <label for="cfg-ia-chave">${escapeHtml(t("assistente.chave_da_api"))} <span id="cfg-ia-chave-dica" class="cfg-ia-dica"></span></label>
      <input type="password" id="cfg-ia-chave" autocomplete="off" spellcheck="false">
    </div>
    <p class="settings-note cfg-ia-aviso-url" id="cfg-ia-aviso-url" hidden>${escapeHtml(t("assistente.aviso_troca_endereco"))}</p>
    <div class="field">
      <label for="cfg-ia-modelo">${escapeHtml(t("assistente.modelo"))}</label>
      <div class="cfg-ia-modelo-linha">
        <input type="text" id="cfg-ia-modelo" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="cfg-ia-modelos" aria-expanded="false" placeholder="${escapeHtml(t("assistente.modelo_placeholder"))}">
        <button type="button" class="btn sm" id="cfg-ia-buscar">${escapeHtml(t("assistente.buscar_modelos"))}</button>
      </div>
      <label class="cfg-toggle cfg-ia-so-gratis" id="cfg-ia-so-gratis-campo" hidden>
        <input type="checkbox" id="cfg-ia-so-gratis" checked>
        <span>${escapeHtml(t("assistente.so_gratuitos"))}</span>
      </label>
      <ul class="cfg-ia-modelos" id="cfg-ia-modelos" role="listbox" aria-label="${escapeHtml(t("assistente.modelos"))}" hidden></ul>
    </div>
    <p class="settings-status" id="cfg-ia-form-status" role="status"></p>
    <div class="form-actions">
      <button type="button" class="btn sm" id="cfg-ia-form-ok">${escapeHtml(t("assistente.salvar_e_testar"))}</button>
      <button type="button" class="btn sm" id="cfg-ia-form-voltar">${escapeHtml(t("geral.cancelar"))}</button>
    </div>`;
}

function catalogoDoForm(wrap) {
  return catalogoDe(editando ? editando.catalogo : wrap.querySelector("#cfg-ia-catalogo").value);
}

/** Ajusta o formulário ao provedor escolhido (endereço, chave, links). */
function aplicarCatalogo(wrap, { trocarUrl }) {
  const c = catalogoDoForm(wrap);
  wrap.querySelector("#cfg-ia-cat-info").innerHTML = infoDoCatalogo(c);
  if (trocarUrl) wrap.querySelector("#cfg-ia-url").value = c.url_base || "";
  const campoChave = wrap.querySelector("#cfg-ia-chave-campo");
  campoChave.hidden = c.chave === "nenhuma";
  const dica = wrap.querySelector("#cfg-ia-chave-dica");
  const input = wrap.querySelector("#cfg-ia-chave");
  if (editando?.tem_chave) {
    dica.textContent = t("assistente.chave_salva_dica");
    input.placeholder = "••••••••";
  } else {
    dica.textContent = c.chave === "opcional" ? t("assistente.opcional") : "";
    input.placeholder = "";
  }
  wrap.querySelector("#cfg-ia-so-gratis-campo").hidden = c.id !== "openrouter";
  modelosCarregados = [];
  renderModelos(wrap);
  avisoUrl(wrap);
}

function avisoUrl(wrap) {
  const aviso = wrap.querySelector("#cfg-ia-aviso-url");
  if (!aviso) return;
  const url = wrap.querySelector("#cfg-ia-url").value.trim().replace(/\/+$/, "");
  const chaveNova = wrap.querySelector("#cfg-ia-chave").value.trim();
  aviso.hidden = !(editando?.tem_chave && url && url !== editando.url_base && !chaveNova);
}

function renderModelos(wrap) {
  const lista = wrap.querySelector("#cfg-ia-modelos");
  const input = wrap.querySelector("#cfg-ia-modelo");
  if (!modelosCarregados.length) {
    lista.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }
  const filtro = input.value.trim().toLowerCase();
  const soGratis = catalogoDoForm(wrap).id === "openrouter" && wrap.querySelector("#cfg-ia-so-gratis").checked;
  const visiveis = modelosCarregados
    .filter((m) => !soGratis || m.endsWith(":free") || m === "openrouter/free")
    .filter((m) => !filtro || m.toLowerCase().includes(filtro) || m === input.value.trim());
  lista.innerHTML = visiveis.length
    ? visiveis
        .map((m) => `<li role="option" tabindex="-1" data-modelo="${escapeHtml(m)}" aria-selected="${m === input.value.trim()}">${escapeHtml(m)}</li>`)
        .join("")
    : `<li class="cfg-ia-modelos-vazio">${escapeHtml(t("assistente.nenhum_modelo_com_esse_nome"))}</li>`;
  lista.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

async function buscarModelos(wrap) {
  const botao = wrap.querySelector("#cfg-ia-buscar");
  const c = catalogoDoForm(wrap);
  botao.disabled = true;
  status(wrap, "cfg-ia-form-status", escapeHtml(t("assistente.buscando_modelos")));
  try {
    const r = await listarModelos({
      catalogo: c.id,
      url_base: wrap.querySelector("#cfg-ia-url").value.trim(),
      api_key: wrap.querySelector("#cfg-ia-chave").value.trim() || null,
      provedor_id: editando?.id || null,
    });
    modelosCarregados = r.modelos;
    status(wrap, "cfg-ia-form-status", escapeHtml(t("assistente.modelos_encontrados", { n: r.modelos.length })));
    renderModelos(wrap);
  } catch (err) {
    modelosCarregados = [];
    renderModelos(wrap);
    status(wrap, "cfg-ia-form-status", textoDoErro(err), true);
  } finally {
    botao.disabled = false;
  }
}

function escolherModelo(wrap, nome) {
  const input = wrap.querySelector("#cfg-ia-modelo");
  input.value = nome;
  modelosCarregados = [];
  renderModelos(wrap);
  input.focus();
}

async function salvar(wrap) {
  const botao = wrap.querySelector("#cfg-ia-form-ok");
  const c = catalogoDoForm(wrap);
  const dados = {
    url_base: wrap.querySelector("#cfg-ia-url").value.trim(),
    modelo: wrap.querySelector("#cfg-ia-modelo").value.trim(),
  };
  const chave = wrap.querySelector("#cfg-ia-chave").value.trim();
  if (chave) dados.api_key = chave;
  if (!dados.modelo) {
    status(wrap, "cfg-ia-form-status", escapeHtml(t("assistente.escolha_um_modelo")), true);
    return;
  }
  botao.disabled = true;
  try {
    const salvo = editando ? await editarProvedor(editando.id, dados) : await criarProvedor({ catalogo: c.id, ...dados });
    fecharForm(wrap);
    await recarregar(wrap);
    await testar(wrap, salvo.id, null);
  } catch (err) {
    status(wrap, "cfg-ia-form-status", textoDoErro(err), true);
  } finally {
    botao.disabled = false;
  }
}

function abrirForm(wrap, p = null) {
  editando = p;
  const box = wrap.querySelector("#cfg-ia-form");
  box.querySelectorAll("select").forEach(destroyCustomSelect);
  box.innerHTML = formHtml(p);
  box.hidden = false;
  wrap.querySelector("#cfg-ia-novo").hidden = true;
  const select = box.querySelector("#cfg-ia-catalogo");
  enhanceSelect(select);
  select.addEventListener("change", () => aplicarCatalogo(wrap, { trocarUrl: true }));
  if (p) {
    box.querySelector("#cfg-ia-url").value = p.url_base;
    box.querySelector("#cfg-ia-modelo").value = p.modelo || "";
  }
  aplicarCatalogo(wrap, { trocarUrl: !p });
  box.querySelector("#cfg-ia-url").addEventListener("input", () => {
    avisoUrl(wrap);
    modelosCarregados = [];
    renderModelos(wrap);
  });
  box.querySelector("#cfg-ia-chave").addEventListener("input", () => avisoUrl(wrap));
  box.querySelector("#cfg-ia-buscar").addEventListener("click", () => buscarModelos(wrap));
  box.querySelector("#cfg-ia-so-gratis").addEventListener("change", () => renderModelos(wrap));
  const inputModelo = box.querySelector("#cfg-ia-modelo");
  inputModelo.addEventListener("input", () => renderModelos(wrap));
  inputModelo.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      const primeiro = box.querySelector("#cfg-ia-modelos [data-modelo]");
      if (primeiro) {
        e.preventDefault();
        primeiro.focus();
      }
    }
  });
  const lista = box.querySelector("#cfg-ia-modelos");
  lista.addEventListener("click", (e) => {
    const li = e.target.closest("[data-modelo]");
    if (li) escolherModelo(wrap, li.dataset.modelo);
  });
  lista.addEventListener("keydown", (e) => {
    const li = e.target.closest("[data-modelo]");
    if (!li) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      escolherModelo(wrap, li.dataset.modelo);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const alvo = e.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling;
      (alvo?.matches("[data-modelo]") ? alvo : e.key === "ArrowUp" ? inputModelo : li).focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      modelosCarregados = [];
      renderModelos(wrap);
      inputModelo.focus();
    }
  });
  box.querySelector("#cfg-ia-form-ok").addEventListener("click", () => salvar(wrap));
  box.querySelector("#cfg-ia-form-voltar").addEventListener("click", () => fecharForm(wrap));
  (p ? box.querySelector("#cfg-ia-modelo") : box.querySelector("#cfg-ia-catalogo"))?.focus?.();
}

export function fecharForm(wrap) {
  editando = null;
  modelosCarregados = [];
  const box = wrap.querySelector("#cfg-ia-form");
  if (!box) return;
  box.querySelectorAll("select").forEach(destroyCustomSelect);
  box.innerHTML = "";
  box.hidden = true;
  wrap.querySelector("#cfg-ia-novo").hidden = false;
}

// ── carregar / ligar os eventos ───────────────────────────────────────────

async function recarregar(wrap) {
  [estadoIa, provedores] = await Promise.all([getAssistente(), getProvedores()]);
  renderEstado(wrap);
  renderLista(wrap);
}

export async function carregarAssistente(wrap) {
  try {
    if (!catalogo.length) catalogo = await getCatalogo();
    await recarregar(wrap);
  } catch (err) {
    status(wrap, "cfg-ia-status", textoDoErro(err), true);
  }
}

async function salvarConfig(wrap, campos, statusId = "cfg-ia-status") {
  try {
    estadoIa = await salvarConfigAssistente(campos);
    renderEstado(wrap);
    renderLista(wrap);
    status(wrap, statusId, `${icon("check", { size: 12 })} ${escapeHtml(t("assistente.salvo"))}`);
    window.dispatchEvent(new CustomEvent("kami:assistente-config", { detail: estadoIa }));
  } catch (err) {
    status(wrap, statusId, textoDoErro(err), true);
    if (estadoIa) renderEstado(wrap);
  }
}

export function wireAssistenteTab(wrap) {
  wrap.querySelector('.cfg-tab[data-tab="assistente"]').addEventListener("click", () => carregarAssistente(wrap));
  wrap.querySelector("#cfg-ia-ativo").addEventListener("change", (e) => salvarConfig(wrap, { ativo: e.target.checked }));
  wrap.querySelector("#cfg-ia-escondido").addEventListener("change", (e) => salvarConfig(wrap, { escondido: e.target.checked }));
  wrap.querySelector("#cfg-ia-novo").addEventListener("click", () => abrirForm(wrap));
  wrap.querySelector("#cfg-ia-limites-ok").addEventListener("click", () =>
    salvarConfig(
      wrap,
      {
        teto_chamadas: Number(wrap.querySelector("#cfg-ia-teto-chamadas").value),
        teto_tokens: Number(wrap.querySelector("#cfg-ia-teto-tokens").value),
        max_rodadas: Number(wrap.querySelector("#cfg-ia-rodadas").value),
      },
      "cfg-ia-limites-status"
    )
  );
  // IA-03 (P-113): o que pode ler
  wrap.querySelector("#cfg-ia-areas").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-ia-area]");
    if (cb) salvarConfig(wrap, { permissoes: { [cb.dataset.iaArea]: cb.checked } }, "cfg-ia-areas-status");
  });
  // IA-02 (P-105): conversas
  // Desligar "guardar" vale pras conversas novas; as que JÁ estão guardadas
  // ficariam lá — e quem desliga espera que nada fique (teste do Emanuel,
  // 2026-10-27). Então pergunta na hora. Esc/fechar = "só desligar" (a
  // opção que não apaga nada).
  wrap.querySelector("#cfg-ia-guardar").addEventListener("change", async (e) => {
    const guardar = e.target.checked;
    if (!guardar) {
      let guardadas = 0;
      try {
        guardadas = (await getConversas()).filter((c) => c.guardada).length;
      } catch {
        guardadas = 0;
      }
      if (guardadas) {
        const apagar = await showConfirmModal(t("assistente.desligar_guardar_pergunta", { n: guardadas }), {
          title: t("assistente.desligar_guardar_titulo"),
          confirmText: t("assistente.desligar_e_apagar"),
          cancelText: t("assistente.so_desligar"),
          danger: true,
        });
        if (apagar) {
          try {
            await apagarTodasConversas();
          } catch (err) {
            status(wrap, "cfg-ia-conversas-status", textoDoErro(err), true);
          }
        }
      }
    }
    salvarConfig(wrap, { guardar_conversas: guardar }, "cfg-ia-conversas-status");
  });
  wrap.querySelector("#cfg-ia-dias-ok").addEventListener("click", () =>
    salvarConfig(wrap, { dias_historico: Number(wrap.querySelector("#cfg-ia-dias").value) }, "cfg-ia-conversas-status")
  );
  wrap.querySelector("#cfg-ia-limpar-conversas").addEventListener("click", async () => {
    const ok = await showConfirmModal(t("assistente.chat.apagar_tudo_confirma"), {
      title: t("assistente.chat.apagar_tudo"),
      confirmText: t("geral.remover"),
      danger: true,
    });
    if (!ok) return;
    try {
      await apagarTodasConversas();
      status(wrap, "cfg-ia-conversas-status", `${icon("check", { size: 12 })} ${escapeHtml(t("assistente.conversas_apagadas"))}`);
    } catch (err) {
      status(wrap, "cfg-ia-conversas-status", textoDoErro(err), true);
    }
  });
  const lista = wrap.querySelector("#cfg-ia-lista");
  lista.addEventListener("click", (e) => {
    const el = e.target.closest("[data-ia-acao]");
    if (el) acaoDaLinha(wrap, el);
  });
  lista.addEventListener("keydown", (e) => {
    const el = e.target.closest("span[data-ia-acao]");
    if (el && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      acaoDaLinha(wrap, el);
    }
  });
  // links do catálogo (criar chave, política) — role=link com teclado
  wrap.querySelector("#cfg-ia-form").addEventListener("keydown", (e) => {
    const link = e.target.closest(".cfg-ia-link");
    if (link && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      link.click();
    }
  });
}
