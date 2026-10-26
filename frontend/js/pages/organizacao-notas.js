/**
 * pages/organizacao-notas.js — aba "notas" da Organização (ORG-01).
 *
 * Vive dentro de pages/organizacao.js (que só chama montarNotas /
 * desmontarNotas / focarNotas), separada pra não inchar aquele arquivo.
 *
 * Duas colunas: lista à esquerda (busca, ativas/arquivadas, tags, notas
 * fixadas no topo) e a nota aberta à direita (título, barra de meta e o
 * editor de components/nota-editor.js). Em tela estreita vira uma coluna
 * só, com "← notas" pra voltar.
 *
 * Salvamento automático (nada se perde ao fechar):
 *   - 700 ms depois da última tecla manda o que mudou (indicador
 *     "salvando…" → "salvo ✓"; falhou → tenta de novo em 5 s);
 *   - a cada tecla também guarda um rascunho local (localStorage) da nota
 *     NÃO trancada — se o app fechar antes do salvamento, ao abrir a nota
 *     de novo o rascunho mais novo que o servidor volta (e é salvo);
 *   - o botão de fechar do app espera o salvamento pendente
 *     (components/antes-de-fechar.js).
 *   Nota trancada nunca vai pro rascunho local (texto em claro no disco).
 *
 * Nota nova só existe no backend depois do primeiro texto/título — "+
 * nova nota" e sair sem escrever nada não deixa nota vazia nem rende xp.
 */
import { fmtDataCurta, localDateKey } from "../components/format.js";
import * as api from "../api/notas.js";
import { criarEditorNota } from "../components/nota-editor.js";
import { icon } from "../components/icons.js";
import { CORES_NOTA, corDaNota } from "../components/nota-cores.js";
import { registrarAntesDeFechar } from "../components/antes-de-fechar.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { showToast } from "../components/toast.js";
import { navigateTo } from "../components/navigate.js";
import { t } from "../i18n.js";

const SALVAR_APOS_MS = 700;
const TENTAR_DE_NOVO_MS = 5000;
const RASCUNHO_PREFIXO = "kami-nota-rascunho-v1:";

const vinculoTipos = () => [
  { tipo: "meta", rotulo: t("organizacao_notas.meta"), pagina: "metas" },
  { tipo: "trilha", rotulo: t("organizacao_notas.curso_trilha"), pagina: "aprendizado" },
  { tipo: "evento", rotulo: t("organizacao_notas.evento"), pagina: "calendario" },
  { tipo: "posicao", rotulo: t("organizacao_notas.posicao_de_carreira"), pagina: "carreira" },
];


const st = {
  raiz: null,
  notas: [],
  tags: [],
  filtro: { q: "", tag: "", arquivadas: false, vinculo: null }, // vinculo: {tipo, id, nome}
  atual: null, // nota aberta (formato NotaOut); id null = nova, ainda não salva
  chave: null, // chave de acesso da nota trancada aberta
  editor: null,
  salvo: { titulo: "", conteudo: "" }, // último estado confirmado pelo backend
  timer: null,
  salvando: null, // Promise do salvamento em andamento
  status: "",
  removerAntesDeFechar: null,
  buscaTimer: null,
};

// ---------------------------------------------------------------- util

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const $ = (sel) => st.raiz?.querySelector(sel);

function dataCurta(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (mesmoDia) return hh;
  return fmtDataCurta(localDateKey(d)); // ORG-07
}

function rascunhoChave(id) {
  return RASCUNHO_PREFIXO + (id || "nova");
}
function lerRascunho(id) {
  try {
    return JSON.parse(localStorage.getItem(rascunhoChave(id)) || "null");
  } catch {
    return null;
  }
}
function gravarRascunho(id, dados) {
  try {
    localStorage.setItem(rascunhoChave(id), JSON.stringify({ ...dados, em: new Date().toISOString() }));
  } catch {
    /* sem armazenamento: o salvamento normal continua valendo */
  }
}
function apagarRascunho(id) {
  try {
    localStorage.removeItem(rascunhoChave(id));
  } catch {
    /* idem */
  }
}

// ---------------------------------------------------------------- template

function template() {
  return `
    <div class="notas" data-modo="lista">
      <aside class="notas-lista" aria-label="${t("organizacao_notas.lista_de_notas")}">
        <div class="notas-lista-topo">
          <button type="button" class="btn primary sm notas-nova" data-nt="nova">${icon("plus", { size: 12 })} ${t("organizacao_notas.nova_nota")}</button>
          <input type="search" id="notas-busca" placeholder="${t("organizacao_notas.buscar_nas_notas")}" aria-label="${t("organizacao_notas.buscar_nas_notas_2")}" autocomplete="off">
          <div class="notas-filtros" id="notas-filtros"></div>
        </div>
        <div class="notas-itens" id="notas-itens" role="list"></div>
      </aside>
      <section class="notas-painel" id="notas-painel" aria-label="${t("organizacao_notas.nota_aberta")}"></section>
    </div>`;
}

function renderFiltros() {
  const el = $("#notas-filtros");
  if (!el) return;
  const { arquivadas, tag, vinculo } = st.filtro;
  el.innerHTML = `
    ${vinculo ? `<span class="nota-tag-filtro on" data-nt-sem-vinculo data-tooltip="${t("organizacao_notas.mostrar_todas")}">${icon("link", { size: 9 })} ${esc(vinculo.nome || t("organizacao_notas.vinculo"))} ${icon("x", { size: 9 })}</span>` : ""}
    <span class="email-filter-opt${arquivadas ? "" : " on"}" data-nt-arquivadas="0">${t("organizacao_notas.ativas")}</span>
    <span class="email-filter-opt${arquivadas ? " on" : ""}" data-nt-arquivadas="1">${t("organizacao_notas.arquivadas")}</span>
    ${st.tags
      .map(
        (t) =>
          `<span class="nota-tag-filtro${tag === t.tag ? " on" : ""}" data-nt-tag="${esc(t.tag)}">#${esc(t.tag)} <span class="email-filter-count">${t.notas}</span></span>`
      )
      .join("")}`;
}

function itemHtml(n) {
  const cor = corDaNota(n.cor);
  const aberta = st.atual?.id === n.id;
  return `
    <div class="nota-item${aberta ? " on" : ""}${n.trancada ? " trancada" : ""}" role="listitem" data-nt-abrir="${n.id}"${cor ? ` style="--nota-cor:${cor}"` : ""}>
      <div class="nota-item-topo">
        ${n.fixada ? `<span class="nota-item-pin" data-tooltip="${t("organizacao_notas.fixada")}">${icon("star", { size: 10, fill: "currentColor" })}</span>` : ""}
        ${n.trancada ? `<span class="nota-item-lock" data-tooltip="${t("organizacao_notas.trancada")}">${icon("lock", { size: 10 })}</span>` : ""}
        <span class="nota-item-titulo">${esc(n.titulo || t("organizacao_notas.sem_titulo"))}</span>
        <span class="nota-item-data">${dataCurta(n.atualizada_em)}</span>
      </div>
      ${n.trancada ? `<div class="nota-item-previa">${t("organizacao_notas.conteudo_trancado")}</div>` : n.previa ? `<div class="nota-item-previa">${esc(n.previa)}</div>` : ""}
      ${n.tags.length || n.vinculo ? `<div class="nota-item-rodape">${n.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}${n.vinculo ? `<span class="nota-item-vinculo">${icon("link", { size: 9 })} ${esc(n.vinculo.nome)}</span>` : ""}</div>` : ""}
    </div>`;
}

function renderLista() {
  const el = $("#notas-itens");
  if (!el) return;
  const novaNaLista = st.atual && !st.atual.id ? `<div class="nota-item on nova" role="listitem"><div class="nota-item-topo"><span class="nota-item-titulo">${esc(st.atual.titulo || t("organizacao_notas.nova_nota"))}</span><span class="nota-item-data">${t("organizacao_notas.rascunho")}</span></div></div>` : "";
  if (!st.notas.length && !novaNaLista) {
    const vazio = st.filtro.q || st.filtro.tag || st.filtro.vinculo
      ? t("organizacao_notas.nenhuma_nota_encontrada")
      : st.filtro.arquivadas
        ? t("organizacao_notas.nenhuma_nota_arquivada")
        : t("organizacao_notas.vazio", { atalho: "<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>" });
    el.innerHTML = `<div class="empty-state">${vazio}</div>`;
    return;
  }
  el.innerHTML = novaNaLista + st.notas.map(itemHtml).join("");
}

// ---------------------------------------------------------------- dados

async function carregarLista() {
  const { q, tag, arquivadas, vinculo } = st.filtro;
  const [notas, tags] = await Promise.all([
    api.listNotas({ q, tag, arquivadas, vinculo_tipo: vinculo?.tipo, vinculo_id: vinculo?.id }),
    api.listTagsNotas(),
  ]);
  if (!st.raiz) return;
  st.notas = notas;
  st.tags = tags;
  renderFiltros();
  renderLista();
}

function atualizarNaLista(nota) {
  const i = st.notas.findIndex((n) => n.id === nota.id);
  if (i >= 0) st.notas[i] = { ...st.notas[i], ...nota };
  else if (!st.filtro.arquivadas) st.notas.unshift(nota);
  // fixadas primeiro, depois a editada mais recente (mesma ordem do backend)
  st.notas.sort((a, b) => (b.fixada - a.fixada) || (a.atualizada_em < b.atualizada_em ? 1 : -1));
  renderLista();
}

// ---------------------------------------------------------------- salvar

function setStatus(texto, tipo = "") {
  st.status = texto;
  const el = $("#nota-status");
  if (el) {
    el.textContent = texto;
    el.dataset.tipo = tipo;
  }
}

function lerTela() {
  return {
    titulo: ($("#nota-titulo")?.value || "").trim(),
    conteudo: st.editor ? st.editor.getMarkdown() : st.salvo.conteudo,
  };
}

function mudou() {
  const agora = lerTela();
  return agora.titulo !== st.salvo.titulo || agora.conteudo !== st.salvo.conteudo;
}

function aoEditar() {
  if (!st.atual) return;
  setStatus(t("notas.editando"));
  if (!st.atual.trancada) gravarRascunho(st.atual.id, lerTela());
  clearTimeout(st.timer);
  st.timer = setTimeout(() => salvarAgora(), SALVAR_APOS_MS);
}

/**
 * Manda o que mudou. Devolve a Promise (usada pelo "antes de fechar").
 * O texto é lido da tela ANTES de qualquer espera: chamado no desmontar
 * da tela, o DOM some logo depois — ler depois salvaria título vazio.
 * `forcar`: cria a nota nova mesmo vazia (tag/cor/vínculo antes do texto).
 */
async function salvarAgora({ forcar = false } = {}) {
  clearTimeout(st.timer);
  st.timer = null;
  const nota = st.atual;
  if (!nota) return;
  const dados = st.raiz && $("#nota-titulo") ? lerTela() : null;
  if (st.salvando) await st.salvando.catch(() => {});
  if (!dados) return;
  const igual = dados.titulo === st.salvo.titulo && dados.conteudo === st.salvo.conteudo;
  if (nota.id && igual) {
    if (st.atual === nota) setStatus(t("notas.salvo"), "ok");
    return;
  }
  // nova e ainda vazia: não cria nada (a não ser que peçam)
  if (!nota.id && !forcar && !dados.titulo && !dados.conteudo) return;

  setStatus(t("notas.salvando"));
  st.salvando = (async () => {
    try {
      let salva;
      if (!nota.id) {
        salva = await api.createNota({
          titulo: dados.titulo,
          conteudo: dados.conteudo,
          tags: nota.tags || [],
          cor: nota.cor || null,
          vinculo_tipo: nota.vinculo?.tipo || null,
          vinculo_id: nota.vinculo?.id || null,
        });
        apagarRascunho(null);
        nota.id = salva.id;
      } else {
        salva = await api.updateNota(nota.id, { ...dados, chave: st.chave || undefined });
      }
      if (st.atual === nota) {
        st.salvo = dados;
        Object.assign(nota, { atualizada_em: salva.atualizada_em, criada_em: salva.criada_em });
        if (!nota.trancada) apagarRascunho(nota.id);
        if (st.raiz && $("#nota-titulo") && mudou()) aoEditar(); // digitou durante o envio
        else setStatus(t("notas.salvo"), "ok");
      }
      atualizarNaLista(salva);
    } catch (err) {
      console.error("notas: falha ao salvar", err);
      if (st.atual === nota) {
        setStatus(err?.status === 423 ? t("organizacao_notas.a_nota_foi_trancada_de") : t("organizacao_notas.nao_salvou_tentando_de_novo"), "erro");
        if (err?.status !== 423) st.timer = setTimeout(() => salvarAgora(), TENTAR_DE_NOVO_MS);
      }
    }
  })();
  try {
    await st.salvando;
  } finally {
    st.salvando = null;
  }
}

// ---------------------------------------------------------------- painel

function fecharEditor() {
  st.editor?.destroy();
  st.editor = null;
}

function renderVazio() {
  fecharEditor();
  const p = $("#notas-painel");
  if (!p) return;
  p.innerHTML = `
    <div class="notas-vazio">
      <pre aria-hidden="true">  _______
 |       |
 | ~~~~~ |
 | ~~~   |
 |_______|</pre>
      <p>${t("organizacao_notas.abra_uma_nota_da_lista")}</p>
      <p class="dica">${t("organizacao_notas.dica_atalho", { atalho: "<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>" })}</p>
    </div>`;
  $(".notas")?.setAttribute("data-modo", "lista");
}

function metaHtml(n) {
  const cor = corDaNota(n.cor);
  return `
    <div class="nota-meta">
      <div class="nota-tags" id="nota-tags">
        ${n.tags.map((tag) => `<span class="nota-tag">#${esc(tag)}<button type="button" data-nt-tirar-tag="${esc(tag)}" aria-label="${esc(t("notas.tirar_tag", { tag }))}">${icon("x", { size: 9 })}</button></span>`).join("")}
        <input type="text" id="nota-tag-input" placeholder="${n.tags.length ? "+ tag" : t("organizacao_notas.tags_enter")}" aria-label="${t("organizacao_notas.adicionar_tag")}" maxlength="40" autocomplete="off">
      </div>
      <div class="nota-acoes">
        <span class="nota-cor-wrap">
          <button type="button" class="nota-acao" data-nt="cor" data-tooltip="${t("organizacao_notas.cor_da_nota")}" aria-label="${t("organizacao_notas.cor_da_nota")}"><span class="nota-cor-ponto"${cor ? ` style="background:${cor}"` : ""}></span></button>
          <span class="nota-cores" id="nota-cores" hidden>
            <button type="button" class="nota-cor-opcao sem" data-nt-cor="" data-tooltip="${t("organizacao_notas.sem_cor")}" aria-label="${t("organizacao_notas.sem_cor")}">${icon("x", { size: 10 })}</button>
            ${CORES_NOTA.map((c) => `<button type="button" class="nota-cor-opcao" data-nt-cor="${c.nome}" style="background:${c.hex}" data-tooltip="${esc(c.rotulo)}" aria-label="${esc(c.rotulo)}"></button>`).join("")}
          </span>
        </span>
        <button type="button" class="nota-acao" data-nt="vinculo" data-tooltip="${n.vinculo ? t("organizacao_notas.vinculo_2") + esc(n.vinculo.nome) : t("organizacao_notas.vincular_a_uma_meta_trilha")}" aria-label="${t("organizacao_notas.vinculo")}">${icon("link", { size: 12 })}</button>
        <button type="button" class="nota-acao${n.fixada ? " on" : ""}" data-nt="fixar" data-tooltip="${n.fixada ? "desafixar" : t("organizacao_notas.fixar_no_topo_e_no")}" aria-label="${n.fixada ? "desafixar" : "fixar"}" aria-pressed="${n.fixada}">${icon("star", { size: 12, fill: n.fixada ? "currentColor" : "none" })}</button>
        <button type="button" class="nota-acao${n.trancada ? " on" : ""}" data-nt="trancar" data-tooltip="${n.trancada ? t("organizacao_notas.destrancar_pede_o_pin") : t("organizacao_notas.trancar_com_o_pin")}" aria-label="${n.trancada ? "destrancar" : "trancar"}">${icon(n.trancada ? "lock" : "lock-open", { size: 12 })}</button>
        <button type="button" class="nota-acao" data-nt="lembrar" data-tooltip="${t("organizacao_notas.criar_um_lembrete_desta_nota")}" aria-label="${t("organizacao_notas.lembrar")}">${icon("bell-ring", { size: 12 })}</button>
        <button type="button" class="nota-acao" data-nt="arquivar" data-tooltip="${n.arquivada ? "desarquivar" : "arquivar"}" aria-label="${n.arquivada ? "desarquivar" : "arquivar"}">${icon("archive", { size: 12 })}</button>
        <button type="button" class="nota-acao perigo" data-nt="apagar" data-tooltip="${t("geral.apagar")}" aria-label="${t("geral.apagar")}">${icon("x", { size: 12 })}</button>
      </div>
    </div>
    ${n.vinculo ? `<div class="nota-vinculo">${icon("link", { size: 10 })} ${esc(vinculoTipos().find((v) => v.tipo === n.vinculo.tipo)?.rotulo || "")}: <a href="#" data-nt="ir-vinculo">${esc(n.vinculo.nome)}</a> <button type="button" class="nota-vinculo-tirar" data-nt="tirar-vinculo" aria-label="${t("organizacao_notas.remover_vinculo")}">${icon("x", { size: 9 })}</button></div>` : ""}
    <div class="nota-vinculo-form" id="nota-vinculo-form" hidden>
      <select id="nota-vinculo-tipo" aria-label="${t("organizacao_notas.tipo_de_vinculo")}">
        ${vinculoTipos().map((v) => `<option value="${v.tipo}">${v.rotulo}</option>`).join("")}
      </select>
      <select id="nota-vinculo-alvo" aria-label="${t("organizacao_notas.item")}"></select>
      <button type="button" class="btn sm" data-nt="vincular">${t("organizacao_notas.vincular")}</button>
      <button type="button" class="btn sm" data-nt="vinculo">${t("geral.cancelar")}</button>
    </div>`;
}

function renderNota() {
  const n = st.atual;
  const p = $("#notas-painel");
  if (!p || !n) return;
  fecharEditor();
  $(".notas")?.setAttribute("data-modo", "nota");
  const cor = corDaNota(n.cor);
  p.innerHTML = `
    <div class="nota-aberta"${cor ? ` style="--nota-cor:${cor}"` : ""}>
      <div class="nota-cab">
        <button type="button" class="nota-voltar" data-nt="voltar" aria-label="${t("organizacao_notas.voltar_pra_lista")}">${icon("arrow-left", { size: 12 })} ${t("organizacao_notas.notas")}</button>
        <input type="text" id="nota-titulo" class="nota-titulo" placeholder="${t("organizacao_notas.titulo")}" value="${esc(n.titulo)}" maxlength="200" aria-label="${t("organizacao_notas.titulo_da_nota")}" autocomplete="off">
        <span class="nota-status" id="nota-status" aria-live="polite">${esc(st.status)}</span>
      </div>
      ${n.trancada && !n.conteudo_disponivel ? "" : metaHtml(n)}
      <div class="nota-corpo" id="nota-corpo"></div>
    </div>`;

  if (n.trancada && !n.conteudo_disponivel) {
    renderTrancada();
    return;
  }
  st.editor = criarEditorNota($("#nota-corpo"), {
    markdown: n.conteudo || "",
    onChange: aoEditar,
    placeholder: t("organizacao_notas.escreva_aqui_markdown_funciona_lista"),
  });
  $("#nota-titulo").addEventListener("input", aoEditar);
  $("#nota-titulo").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      st.editor?.focus();
    }
  });
}

function renderTrancada() {
  const corpo = $("#nota-corpo");
  corpo.innerHTML = `
    <form class="nota-trancada" id="nota-trancada-form">
      <pre aria-hidden="true">  .---.
 /  _  \\
 | (_) |
 |  |  |
 '-----'</pre>
      <p>${t("organizacao_notas.nota_trancada_digite_o_pin")}</p>
      <input type="password" id="nota-pin" inputmode="numeric" maxlength="8" autocomplete="off" aria-label="${t("organizacao_notas.pin")}">
      <button type="submit" class="btn primary sm">${t("organizacao_notas.abrir")}</button>
      <p class="nota-trancada-erro" id="nota-pin-erro" role="alert"></p>
    </form>`;
  $("#nota-titulo").readOnly = true;
  corpo.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = $("#nota-pin").value;
    try {
      const aberta = await api.abrirNota(st.atual.id, pin);
      st.chave = aberta.chave;
      st.atual = aberta;
      st.salvo = { titulo: aberta.titulo, conteudo: aberta.conteudo };
      setStatus("");
      renderNota();
      st.editor?.focus();
    } catch (err) {
      $("#nota-pin-erro").textContent = err?.message || t("organizacao_notas.nao_foi_possivel_abrir");
      $("#nota-pin").select();
    }
  });
  setTimeout(() => $("#nota-pin")?.focus(), 0);
}

async function abrir(id) {
  await salvarAgora();
  if (!st.raiz) return;
  st.chave = null;
  let nota;
  try {
    nota = await api.getNota(id);
  } catch {
    return;
  }
  if (!st.raiz) return;
  st.atual = nota;
  st.salvo = { titulo: nota.titulo, conteudo: nota.conteudo };
  setStatus("");

  // rascunho local mais novo que o servidor = o app fechou antes de salvar
  const rascunho = !nota.trancada ? lerRascunho(id) : null;
  let recuperado = false;
  if (rascunho && rascunho.em > nota.atualizada_em && (rascunho.conteudo !== nota.conteudo || rascunho.titulo !== nota.titulo)) {
    nota.titulo = rascunho.titulo;
    nota.conteudo = rascunho.conteudo;
    recuperado = true;
  } else if (rascunho) {
    apagarRascunho(id);
  }
  renderNota();
  renderLista();
  if (recuperado) {
    showToast({ title: t("organizacao_notas.texto_recuperado"), message: t("organizacao_notas.esta_nota_tinha_alteracoes_que"), iconName: "undo", sound: false });
    aoEditar();
  }
}

function nova(dados = {}) {
  return (async () => {
    await salvarAgora();
    st.chave = null;
    st.atual = {
      id: null, titulo: dados.titulo || "", conteudo: dados.conteudo || "", tags: [], cor: null,
      fixada: false, arquivada: false, trancada: false, vinculo: dados.vinculo || null,
      conteudo_disponivel: true, pin_ligado: false,
    };
    st.salvo = { titulo: "", conteudo: "" };
    setStatus("");
    renderNota();
    renderLista();
    $("#nota-titulo")?.focus();
    if (dados.titulo || dados.conteudo) aoEditar();
  })();
}

// ---------------------------------------------------------------- ações

async function garantirSalva() {
  // ações de meta (tag, cor, vínculo…) precisam da nota no backend — cria
  // mesmo vazia: a pessoa está organizando antes de escrever
  if (st.atual && !st.atual.id) await salvarAgora({ forcar: true });
  return st.atual?.id;
}

async function aplicarMeta(dados, { recarregar = false } = {}) {
  const id = await garantirSalva();
  if (!id) return;
  const salva = await api.updateNota(id, { ...dados, chave: st.chave || undefined });
  Object.assign(st.atual, { ...salva, conteudo: st.atual.conteudo });
  if (st.editor) st.atual.conteudo = st.editor.getMarkdown();
  // redesenha só a barra de meta (o editor e o cursor ficam)
  const meta = $(".nota-meta");
  if (meta) {
    const novo = document.createElement("div");
    novo.innerHTML = metaHtml(st.atual);
    $(".nota-vinculo")?.remove();
    $("#nota-vinculo-form")?.remove();
    meta.replaceWith(...novo.childNodes);
  }
  const aberta = $(".nota-aberta");
  const cor = corDaNota(st.atual.cor);
  if (aberta) cor ? aberta.style.setProperty("--nota-cor", cor) : aberta.style.removeProperty("--nota-cor");
  if (recarregar) await carregarLista();
  else atualizarNaLista(salva);
}

function adicionarTag(texto) {
  const novas = texto.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean);
  if (!novas.length) return;
  const tags = [...new Set([...(st.atual.tags || []), ...novas])];
  aplicarMeta({ tags }, { recarregar: true }).then(() => $("#nota-tag-input")?.focus());
}

async function trancarOuDestrancar() {
  const n = st.atual;
  if (n.trancada) {
    const { showPromptModal } = await import("../modals/prompt-modal.js");
    const pin = await showPromptModal("PIN", { title: t("organizacao_notas.destrancar_nota"), inputType: "password", confirmText: t("organizacao_notas.destrancar") });
    if (pin == null) return;
    try {
      const livre = await api.destrancarNota(n.id, pin);
      st.chave = null;
      st.atual = livre;
      st.salvo = { titulo: livre.titulo, conteudo: livre.conteudo };
      renderNota();
      atualizarNaLista(livre);
    } catch {
      /* o client já mostra o erro (PIN errado / espera) */
    }
    return;
  }
  const ok = await showConfirmModal(
    t("organizacao_notas.o_texto_fica_cifrado_e") +
      t("organizacao_notas.aviso_chave"),
    { title: t("organizacao_notas.trancar_nota"), confirmText: t("organizacao_notas.trancar") }
  );
  if (!ok) return;
  const id = await garantirSalva();
  if (!id) return;
  await salvarAgora();
  try {
    const trancada = await api.trancarNota(id);
    apagarRascunho(id);
    st.chave = trancada.chave;
    st.atual = trancada;
    st.salvo = { titulo: trancada.titulo, conteudo: trancada.conteudo };
    renderNota();
    atualizarNaLista(trancada);
  } catch (err) {
    if (err?.status === 409) {
      const irAgora = await showConfirmModal(t("organizacao_notas.pra_trancar_notas_ative_antes"), {
        title: t("organizacao_notas.pin_desligado"),
        confirmText: t("organizacao_notas.abrir_configuracoes"),
      });
      if (irAgora) {
        const { openConfiguracoesModal } = await import("../modals/configuracoes-modal.js");
        openConfiguracoesModal("seguranca");
      }
    }
  }
}

async function apagar() {
  const n = st.atual;
  if (!n.id) {
    apagarRascunho(null);
    st.atual = null;
    renderVazio();
    renderLista();
    return;
  }
  const ok = await showConfirmModal(t("organizacao_notas.apagar_confirma", { titulo: n.titulo || t("organizacao_notas.sem_titulo") }), {
    title: t("organizacao_notas.apagar_nota"),
    confirmText: t("geral.apagar"),
    danger: true,
  });
  if (!ok) return;
  clearTimeout(st.timer);
  await api.deleteNota(n.id, st.chave || undefined);
  apagarRascunho(n.id);
  st.atual = null;
  st.chave = null;
  st.notas = st.notas.filter((x) => x.id !== n.id);
  renderVazio();
  carregarLista();
}

async function abrirFormVinculo() {
  const form = $("#nota-vinculo-form");
  if (!form) return;
  form.hidden = !form.hidden;
  if (form.hidden) return;
  const tipoSel = $("#nota-vinculo-tipo");
  if (st.atual.vinculo) tipoSel.value = st.atual.vinculo.tipo;
  await carregarAlvos();
}

async function carregarAlvos() {
  const tipo = $("#nota-vinculo-tipo")?.value;
  const sel = $("#nota-vinculo-alvo");
  if (!sel) return;
  sel.innerHTML = `<option value="">${t("geral.carregando")}</option>`;
  const alvos = await api.listAlvosNota(tipo).catch(() => []);
  sel.innerHTML = alvos.length
    ? alvos.map((a) => `<option value="${esc(a.id)}"${st.atual?.vinculo?.id === a.id ? " selected" : ""}>${esc(a.nome)}</option>`).join("")
    : `<option value="">${t("organizacao_notas.nada_cadastrado_ainda")}</option>`;
}

// ---------------------------------------------------------------- eventos

function onClick(e) {
  const alvo = e.target.closest("[data-nt], [data-nt-abrir], [data-nt-tag], [data-nt-arquivadas], [data-nt-cor], [data-nt-tirar-tag], [data-nt-sem-vinculo]");
  if (!alvo) {
    if (!e.target.closest(".nota-cor-wrap")) $("#nota-cores")?.setAttribute("hidden", "");
    return;
  }
  if (alvo.dataset.ntAbrir) return abrir(alvo.dataset.ntAbrir);
  if (alvo.dataset.ntSemVinculo !== undefined) {
    st.filtro.vinculo = null;
    return carregarLista();
  }
  if (alvo.dataset.ntTag !== undefined) {
    st.filtro.tag = st.filtro.tag === alvo.dataset.ntTag ? "" : alvo.dataset.ntTag;
    return carregarLista();
  }
  if (alvo.dataset.ntArquivadas !== undefined) {
    st.filtro.arquivadas = alvo.dataset.ntArquivadas === "1";
    return carregarLista();
  }
  if (alvo.dataset.ntCor !== undefined) {
    $("#nota-cores")?.setAttribute("hidden", "");
    const nome = alvo.dataset.ntCor;
    return aplicarMeta(nome ? { cor: nome } : { limpar_cor: true });
  }
  if (alvo.dataset.ntTirarTag !== undefined) {
    return aplicarMeta({ tags: st.atual.tags.filter((t) => t !== alvo.dataset.ntTirarTag) }, { recarregar: true });
  }
  const acao = alvo.dataset.nt;
  if (acao === "nova") return nova();
  if (!st.atual && acao !== "voltar") return;
  if (acao === "voltar") {
    salvarAgora();
    $(".notas")?.setAttribute("data-modo", "lista");
    return;
  }
  if (acao === "cor") return $("#nota-cores")?.toggleAttribute("hidden");
  if (acao === "fixar") return aplicarMeta({ fixada: !st.atual.fixada });
  if (acao === "lembrar") {
    // ORG-05: lembrete ligado a esta nota
    const { id, titulo } = st.atual;
    return import("../modals/lembrete-modal.js").then((m) =>
      m.openLembreteModal({ vinculo: { tipo: "nota", id, nome: titulo || t("organizacao_notas.sem_titulo") } }),
    );
  }
  if (acao === "arquivar") {
    const arquivar = !st.atual.arquivada;
    return aplicarMeta({ arquivada: arquivar }, { recarregar: true }).then(() => {
      showToast({ title: arquivar ? t("organizacao_notas.nota_arquivada") : t("organizacao_notas.nota_de_volta_as_ativas"), iconName: "archive", duration: 3000, sound: false });
      st.atual = null;
      renderVazio();
      renderLista();
    });
  }
  if (acao === "apagar") return apagar();
  if (acao === "trancar") return trancarOuDestrancar();
  if (acao === "vinculo") return abrirFormVinculo();
  if (acao === "vincular") {
    const vid = $("#nota-vinculo-alvo")?.value;
    if (!vid) return;
    return aplicarMeta({ vinculo_tipo: $("#nota-vinculo-tipo").value, vinculo_id: vid });
  }
  if (acao === "tirar-vinculo") return aplicarMeta({ limpar_vinculo: true });
  if (acao === "ir-vinculo") {
    e.preventDefault();
    const pagina = vinculoTipos().find((v) => v.tipo === st.atual.vinculo?.tipo)?.pagina;
    if (pagina) salvarAgora().then(() => navigateTo(pagina));
  }
}

function onKeydown(e) {
  if (e.target.id === "nota-tag-input") {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      adicionarTag(e.target.value);
      e.target.value = "";
    } else if (e.key === "Backspace" && !e.target.value && st.atual?.tags?.length) {
      aplicarMeta({ tags: st.atual.tags.slice(0, -1) }, { recarregar: true }).then(() => $("#nota-tag-input")?.focus());
    }
  }
}

function onChange(e) {
  if (e.target.id === "nota-vinculo-tipo") carregarAlvos();
}

function onInputBusca(e) {
  if (e.target.id !== "notas-busca") return;
  clearTimeout(st.buscaTimer);
  st.buscaTimer = setTimeout(() => {
    st.filtro.q = e.target.value.trim();
    carregarLista();
  }, 200);
}

// ---------------------------------------------------------------- ciclo de vida

/** Monta a aba dentro de `painel` (chamado uma vez por montagem da tela). */
export async function montarNotas(painel, opts = {}) {
  st.raiz = painel;
  painel.innerHTML = template();
  painel.addEventListener("click", onClick);
  painel.addEventListener("keydown", onKeydown);
  painel.addEventListener("change", onChange);
  painel.addEventListener("input", onInputBusca);
  st.removerAntesDeFechar = registrarAntesDeFechar(() => salvarAgora());
  renderVazio();
  await carregarLista();

  // nota nova que ficou só no rascunho local (app fechou antes do 1º salvamento)
  const rascunhoNova = lerRascunho(null);
  if (rascunhoNova && (rascunhoNova.titulo || rascunhoNova.conteudo) && !opts.notaId) {
    await nova({ titulo: rascunhoNova.titulo, conteudo: rascunhoNova.conteudo });
    showToast({ title: t("organizacao_notas.texto_recuperado"), message: t("organizacao_notas.uma_nota_nova_nao_chegou"), iconName: "undo", sound: false });
  }
  await focarNotas(opts);
}

/** Abrir uma nota específica / criar uma nova vinculada (vindo de outra tela). */
export async function focarNotas(opts = {}) {
  if (!st.raiz) return;
  if (opts.vinculo) {
    // "notas (N)" de uma meta/trilha/evento/posição: lista só as dela
    st.filtro = { q: "", tag: "", arquivadas: false, vinculo: opts.vinculo };
    const busca = $("#notas-busca");
    if (busca) busca.value = "";
    await carregarLista();
  }
  if (opts.notaId) await abrir(opts.notaId);
  else if (opts.novaNota) await nova(opts.novaNota);
}

export function desmontarNotas() {
  if (!st.raiz) return;
  salvarAgora(); // dispara; o backend recebe mesmo com a tela já desmontada
  st.removerAntesDeFechar?.();
  fecharEditor();
  st.raiz.removeEventListener("click", onClick);
  st.raiz.removeEventListener("keydown", onKeydown);
  st.raiz.removeEventListener("change", onChange);
  st.raiz.removeEventListener("input", onInputBusca);
  Object.assign(st, { raiz: null, notas: [], tags: [], atual: null, chave: null, status: "" });
  st.filtro = { q: "", tag: "", arquivadas: false, vinculo: null };
}
