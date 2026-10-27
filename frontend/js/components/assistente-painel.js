/**
 * Painel do assistente (IA-02): chat no visual de terminal (`kami>`),
 * aberto pelo item "assistente kami" do menu ou por Alt+A, em qualquer
 * tela, à direita e POR CIMA do conteúdo (P-107 — não espreme os
 * widgets).
 *
 * - Resposta chega aos poucos (api/client.js postStream) e é desenhada
 *   com o mesmo markdown das notas (nota-markdown.js — monta o DOM só com
 *   createElement/textContent: a resposta do modelo é texto de fora e
 *   nunca vira HTML).
 * - Parar: aborta a conexão; o backend corta a chamada ao provedor e
 *   guarda o que já tinha chegado como "interrompida".
 * - Transparência (princípio 5): o topo mostra provedor · modelo, local ou
 *   nuvem e pra onde vai o texto; "o que foi enviado" (princípio 3) e o
 *   histórico (P-105) moram no próprio painel.
 * - Leitor de tela: a resposta é anunciada UMA vez, inteira, no fim (não
 *   a cada pedaço); tudo funciona por teclado (Enter envia, Shift+Enter
 *   quebra linha, Esc fecha e devolve o foco).
 * - Desligado ou sem provedor: o painel diz o que falta e leva pra
 *   configurações › assistente (P-110: o botão aparece mesmo assim, a
 *   menos que a pessoa esconda).
 */
import {
  apagarConversa,
  apagarEnvios,
  apagarTodasConversas,
  enviarMensagem,
  getAssistente,
  getConversa,
  getConversas,
  getEnvios,
} from "../api/assistente.js";
import { ApiError } from "../api/client.js";
import { announce, prefersReducedMotion } from "./a11y.js";
import { getTelaAtual } from "./error-notice.js";
import { escapeHtml, fmtDataHora } from "./format.js";
import { icon } from "./icons.js";
import { markdownParaDom } from "./nota-markdown.js";
import { openExternal } from "./open-external.js";
import { idiomaAtual, localeAtual, t } from "../i18n.js";

const TEXTO_MAX = 4000;

let painel = null;
let estadoIa = null;
let conversaId = null;
let mensagens = []; // [{papel, texto, interrompida, erro}] da conversa aberta
let enviando = null; // AbortController da resposta em andamento
let vista = "conversa"; // conversa | historico | envios
let focoAntes = null;

const num = (n) => new Intl.NumberFormat(localeAtual()).format(n);

function hostDe(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ── montagem ────────────────────────────────────────────────────────────

function montar() {
  const el = document.createElement("aside");
  el.className = "ia-painel";
  el.id = "ia-painel";
  el.hidden = true;
  el.setAttribute("aria-labelledby", "ia-titulo");
  el.dataset.idioma = idiomaAtual();
  el.innerHTML = `
    <header class="ia-cab">
      <h2 id="ia-titulo"><span class="ia-sinal">kami&gt;</span> ${escapeHtml(t("assistente.chat.titulo"))}</h2>
      <div class="ia-cab-acoes">
        ${botaoIcone("nova", "plus", t("assistente.chat.nova_conversa"))}
        ${botaoIcone("historico", "clock", t("assistente.chat.historico"))}
        ${botaoIcone("envios", "external-link", t("assistente.chat.o_que_foi_enviado"))}
        ${botaoIcone("configurar", "settings", t("assistente.chat.configurar"))}
        ${botaoIcone("sair", "x", t("geral.fechar"))}
      </div>
    </header>
    <p class="ia-provedor" id="ia-provedor"></p>
    <div class="ia-corpo" id="ia-corpo" tabindex="-1"></div>
    <form class="ia-entrada" id="ia-form" autocomplete="off">
      <label for="ia-texto" class="sr-only">${escapeHtml(t("assistente.chat.sua_mensagem"))}</label>
      <span class="ia-sinal" aria-hidden="true">&gt;</span>
      <textarea id="ia-texto" rows="2" maxlength="${TEXTO_MAX}" placeholder="${escapeHtml(t("assistente.chat.placeholder"))}"></textarea>
      <button type="submit" class="btn sm" id="ia-enviar">${escapeHtml(t("assistente.chat.enviar"))}</button>
    </form>`;
  document.body.appendChild(el);
  ligarEventos(el);
  return el;
}

function botaoIcone(acao, nome, rotulo) {
  return `<button type="button" class="ia-icone" data-ia="${acao}" aria-label="${escapeHtml(rotulo)}" data-tooltip="${escapeHtml(rotulo)}">${icon(nome, { size: 13 })}</button>`;
}

// ── cabeçalho: provedor em uso (princípio 5) ────────────────────────────

function renderProvedor() {
  const el = painel.querySelector("#ia-provedor");
  const p = estadoIa?.provedor;
  if (!p || !estadoIa.pronto) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const onde = p.local ? t("assistente.local") : t("assistente.chat.nuvem_para", { host: hostDe(p.url_base) });
  const u = estadoIa.uso_hoje;
  const usoTxt = p.local
    ? t("assistente.chat.uso_local", { chamadas: num(u.chamadas) })
    : t("assistente.chat.uso_nuvem", { chamadas: num(u.chamadas), teto: num(estadoIa.config.teto_chamadas) });
  el.innerHTML = `${icon(p.local ? "lock" : "external-link", { size: 11 })} <b>${escapeHtml(p.nome)}</b> · ${escapeHtml(p.modelo || "")} · ${escapeHtml(onde)}<span class="ia-uso">${escapeHtml(usoTxt)}</span>`;
}

// ── vistas ────────────────────────────────────────────────────────────────

function corpo() {
  return painel.querySelector("#ia-corpo");
}

function mostrarEntrada(sim) {
  painel.querySelector("#ia-form").hidden = !sim;
}

const FALTA = {
  provedor: "assistente.chat.falta_provedor",
  modelo: "assistente.chat.falta_modelo",
  chave: "assistente.chat.falta_chave",
  desligado: "assistente.chat.falta_desligado",
};

function renderFalta() {
  mostrarEntrada(false);
  corpo().innerHTML = `
    <div class="ia-vazio">
      <p class="ia-linha"><span class="ia-sinal">kami&gt;</span> ${escapeHtml(t(FALTA[estadoIa.falta] || FALTA.provedor))}</p>
      <p class="ia-nota">${escapeHtml(t("assistente.chat.opcional"))}</p>
      <div class="form-actions"><button type="button" class="btn sm" data-ia="configurar">${escapeHtml(t("assistente.chat.ir_para_configuracoes"))}</button></div>
    </div>`;
}

function renderVazio() {
  const p = estadoIa.provedor;
  const onde = p.local ? t("assistente.em_uso_local") : t("assistente.em_uso_nuvem", { host: hostDe(p.url_base) });
  corpo().innerHTML = `
    <div class="ia-vazio">
      <p class="ia-linha"><span class="ia-sinal">kami&gt;</span> ${escapeHtml(t("assistente.chat.pronto"))}</p>
      <p class="ia-nota">${escapeHtml(t("assistente.chat.o_que_faz"))}</p>
      <p class="ia-nota">${escapeHtml(onde)}</p>
    </div>`;
}

function htmlErro(erro) {
  const texto = erro.chave ? t(erro.chave, erro.vars || {}) : erro.detail;
  const detalhe = erro.vars?.detalhe ? `<small>${escapeHtml(t("assistente.o_provedor_disse", { detalhe: erro.vars.detalhe }))}</small>` : "";
  const configurar = /teto|falta|chave_invalida|modelo_indisponivel|desligado/.test(erro.chave || "")
    ? ` <button type="button" class="ia-link" data-ia="configurar">${escapeHtml(t("assistente.chat.ir_para_configuracoes"))}</button>`
    : "";
  return `${icon("triangle-alert", { size: 11 })} ${escapeHtml(texto)}${configurar}${detalhe}`;
}

function noMensagem(m, i) {
  const div = document.createElement("div");
  div.className = `ia-msg ia-msg--${m.papel === "usuario" ? "usuario" : "kami"}`;
  div.dataset.i = String(i);
  if (m.papel === "usuario") {
    const sinal = document.createElement("span");
    sinal.className = "ia-sinal";
    sinal.textContent = "> ";
    sinal.setAttribute("aria-hidden", "true");
    const txt = document.createElement("span");
    txt.className = "ia-msg-texto";
    txt.textContent = m.texto;
    div.append(sinal, txt);
    return div;
  }
  const txt = document.createElement("div");
  txt.className = "ia-msg-texto nota-md";
  if (m.texto) txt.append(markdownParaDom(m.texto));
  div.append(txt);
  if (m.carregando) {
    const cursor = document.createElement("span");
    cursor.className = "ia-cursor";
    cursor.setAttribute("aria-hidden", "true");
    cursor.textContent = "█";
    (txt.lastElementChild || txt).append(cursor);
  }
  if (m.interrompida && !m.erro && !m.carregando) {
    const tag = document.createElement("small");
    tag.className = "ia-interrompida";
    tag.textContent = t("assistente.chat.interrompida");
    div.append(tag);
  }
  if (m.erro) {
    const e = document.createElement("p");
    e.className = "ia-falha";
    e.innerHTML = htmlErro(m.erro);
    div.append(e);
  }
  return div;
}

function renderConversa() {
  mostrarEntrada(true);
  if (!mensagens.length) {
    renderVazio();
    return;
  }
  const lista = document.createElement("div");
  lista.className = "ia-mensagens";
  lista.setAttribute("role", "log");
  lista.setAttribute("aria-label", t("assistente.chat.conversa"));
  mensagens.forEach((m, i) => lista.append(noMensagem(m, i)));
  corpo().replaceChildren(lista);
  rolarProFim();
}

/** Redesenha só a última mensagem (a que está chegando aos poucos). */
let quadroPendente = false;
function atualizarUltima() {
  if (quadroPendente) return;
  quadroPendente = true;
  requestAnimationFrame(() => {
    quadroPendente = false;
    const lista = corpo().querySelector(".ia-mensagens");
    if (!lista) return renderConversa();
    const i = mensagens.length - 1;
    const velho = lista.querySelector(`[data-i="${i}"]`);
    const novo = noMensagem(mensagens[i], i);
    if (velho) velho.replaceWith(novo);
    else lista.append(novo);
    rolarProFim();
  });
}

function rolarProFim() {
  const c = corpo();
  c.scrollTo?.({ top: c.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

async function renderHistorico() {
  vista = "historico";
  mostrarEntrada(false);
  corpo().innerHTML = `<p class="ia-nota">${escapeHtml(t("assistente.chat.carregando"))}</p>`;
  let lista;
  try {
    lista = await getConversas();
  } catch (err) {
    corpo().innerHTML = `<p class="ia-falha">${escapeHtml(err.message)}</p>`;
    return;
  }
  const guardar = estadoIa?.config.guardar_conversas;
  corpo().innerHTML = `
    <div class="ia-secao">
      <h3>${escapeHtml(t("assistente.chat.historico"))}</h3>
      <p class="ia-nota">${escapeHtml(guardar ? t("assistente.chat.historico_desc", { dias: estadoIa.config.dias_historico }) : t("assistente.chat.historico_nao_guarda"))}</p>
      ${lista.length ? `<ul class="ia-lista">${lista.map((c) => `
        <li>
          <button type="button" class="ia-item" data-ia="abrir" data-id="${escapeHtml(c.id)}">
            <span class="ia-item-titulo">${escapeHtml(c.titulo)}</span>
            <span class="ia-item-meta">${escapeHtml(fmtDataHora(c.updated_at))}${c.guardada ? "" : ` · ${escapeHtml(t("assistente.chat.so_nesta_sessao"))}`}</span>
          </button>
          <button type="button" class="ia-icone" data-ia="remover" data-id="${escapeHtml(c.id)}" aria-label="${escapeHtml(t("assistente.chat.apagar_conversa", { titulo: c.titulo }))}">${icon("x", { size: 12 })}</button>
        </li>`).join("")}</ul>` : `<p class="ia-nota">${escapeHtml(t("assistente.chat.nenhuma_conversa"))}</p>`}
      <div class="form-actions">
        <button type="button" class="btn sm" data-ia="voltar">${escapeHtml(t("assistente.chat.voltar"))}</button>
        ${lista.length ? `<button type="button" class="btn sm danger" data-ia="limpar-tudo">${escapeHtml(t("assistente.chat.apagar_tudo"))}</button>` : ""}
      </div>
    </div>`;
  corpo().focus();
}

function htmlItemEnviado(item) {
  if (item.tipo === "mensagem") return `<li><b>${escapeHtml(t("assistente.chat.enviado_mensagem"))}</b> ${escapeHtml(item.texto)}</li>`;
  if (item.tipo === "historico") return `<li>${escapeHtml(t("assistente.chat.enviado_historico", { n: item.mensagens }))}</li>`;
  if (item.tipo === "instrucoes") return `<li>${escapeHtml(t("assistente.chat.enviado_instrucoes", { versao: item.versao }))}</li>`;
  if (item.tipo === "ferramenta") {
    return `<li><b>${escapeHtml(t("assistente.chat.enviado_ferramenta", { nome: item.nome }))}</b> <code>${escapeHtml(item.resultado)}</code></li>`;
  }
  return `<li>${escapeHtml(JSON.stringify(item))}</li>`;
}

async function renderEnvios() {
  vista = "envios";
  mostrarEntrada(false);
  corpo().innerHTML = `<p class="ia-nota">${escapeHtml(t("assistente.chat.carregando"))}</p>`;
  let lista;
  try {
    lista = await getEnvios();
  } catch (err) {
    corpo().innerHTML = `<p class="ia-falha">${escapeHtml(err.message)}</p>`;
    return;
  }
  corpo().innerHTML = `
    <div class="ia-secao">
      <h3>${escapeHtml(t("assistente.chat.o_que_foi_enviado"))}</h3>
      <p class="ia-nota">${escapeHtml(t("assistente.chat.envios_desc"))}</p>
      ${lista.length ? `<ol class="ia-envios">${lista.map((e) => `
        <li>
          <span class="ia-item-meta">${escapeHtml(fmtDataHora(e.created_at))} · ${escapeHtml(e.provedor)} · ${escapeHtml(e.modelo || "")} → ${escapeHtml(e.local ? t("assistente.local") : e.destino)}${e.tokens_entrada != null ? ` · ${escapeHtml(t("assistente.chat.tokens", { entrada: num(e.tokens_entrada), saida: num(e.tokens_saida) }))}` : ""}</span>
          <ul>${e.itens.map(htmlItemEnviado).join("")}</ul>
        </li>`).join("")}</ol>` : `<p class="ia-nota">${escapeHtml(t("assistente.chat.nada_enviado"))}</p>`}
      <div class="form-actions">
        <button type="button" class="btn sm" data-ia="voltar">${escapeHtml(t("assistente.chat.voltar"))}</button>
        ${lista.length ? `<button type="button" class="btn sm danger" data-ia="limpar-envios">${escapeHtml(t("assistente.chat.apagar_registro"))}</button>` : ""}
      </div>
    </div>`;
  corpo().focus();
}

function voltarPraConversa() {
  vista = "conversa";
  if (estadoIa?.pronto) renderConversa();
  else renderFalta();
}

// ── enviar / parar ───────────────────────────────────────────────────────

function modoEnviando(sim) {
  const botao = painel.querySelector("#ia-enviar");
  botao.textContent = sim ? t("assistente.chat.parar") : t("assistente.chat.enviar");
  botao.classList.toggle("warn", sim);
  painel.querySelector("#ia-form").setAttribute("aria-busy", String(sim));
}

async function enviar() {
  const campo = painel.querySelector("#ia-texto");
  const texto = campo.value.trim();
  if (!texto || enviando) return;
  campo.value = "";
  vista = "conversa";
  mensagens.push({ papel: "usuario", texto });
  const resposta = { papel: "assistente", texto: "", carregando: true };
  mensagens.push(resposta);
  renderConversa();
  modoEnviando(true);
  announce(t("assistente.chat.respondendo"));
  enviando = new AbortController();
  try {
    await enviarMensagem(
      { texto, conversa_id: conversaId, tela: getTelaAtual() || null, idioma: idiomaAtual() },
      {
        signal: enviando.signal,
        onEvento: (ev) => {
          if (ev.tipo === "inicio") conversaId = ev.conversa_id;
          else if (ev.tipo === "texto") {
            resposta.texto += ev.delta;
            atualizarUltima();
          } else if (ev.tipo === "fim" || ev.tipo === "falha") {
            if (ev.tipo === "falha") resposta.erro = ev;
            if (ev.motivo === "parado") resposta.interrompida = true;
            if (ev.uso_hoje && estadoIa) estadoIa = { ...estadoIa, uso_hoje: ev.uso_hoje };
          }
        },
      }
    );
    if (enviando.signal.aborted) {
      resposta.interrompida = true;
      await carregarEstado(); // o "fim" não chega depois do parar — o uso do dia vem daqui
    }
  } catch (err) {
    resposta.erro = err instanceof ApiError && err.body?.chave ? err.body : { detail: err.message };
    if (!conversaId) mensagens.splice(mensagens.length - 2, 1); // a pergunta não chegou a lugar nenhum
  } finally {
    resposta.carregando = false;
    enviando = null;
    modoEnviando(false);
    renderProvedor();
    renderConversa();
    const lido = resposta.erro ? corpo().querySelector(".ia-msg:last-child .ia-falha")?.textContent : resposta.texto;
    announce(`${t("assistente.chat.resposta_pronta")} ${lido || ""}`.trim());
    campo.focus();
  }
}

function parar() {
  enviando?.abort();
}

// ── abrir / fechar ───────────────────────────────────────────────────────

async function carregarEstado() {
  try {
    estadoIa = await getAssistente();
  } catch {
    estadoIa = null;
  }
  return estadoIa;
}

async function abrirConversa(id) {
  try {
    const c = await getConversa(id);
    conversaId = c.id;
    mensagens = c.mensagens.map((m) => ({
      papel: m.papel,
      texto: m.texto,
      interrompida: m.interrompida,
      erro: m.erro_chave ? { chave: m.erro_chave, vars: {} } : null,
    }));
    vista = "conversa";
    renderConversa();
    painel.querySelector("#ia-texto").focus();
  } catch (err) {
    corpo().innerHTML = `<p class="ia-falha">${escapeHtml(err.message)}</p>`;
  }
}

function novaConversa() {
  if (enviando) return;
  conversaId = null;
  mensagens = [];
  vista = "conversa";
  voltarPraConversa();
  painel.querySelector("#ia-texto")?.focus();
}

export async function abrirAssistente() {
  if (painel && painel.dataset.idioma !== idiomaAtual()) {
    painel.remove();
    painel = null;
  }
  painel = painel || montar();
  if (painel.hidden) focoAntes = document.activeElement;
  painel.hidden = false;
  document.body.classList.add("ia-aberto");
  atualizarBotaoMenu();
  await carregarEstado();
  if (!estadoIa) {
    mostrarEntrada(false);
    corpo().innerHTML = `<p class="ia-falha">${escapeHtml(t("assistente.chat.sem_conexao"))}</p>`;
    return;
  }
  renderProvedor();
  if (vista === "conversa") voltarPraConversa();
  (estadoIa.pronto ? painel.querySelector("#ia-texto") : painel.querySelector('[data-ia="configurar"]'))?.focus();
}

export function fecharAssistente() {
  if (!painel || painel.hidden) return;
  painel.hidden = true;
  document.body.classList.remove("ia-aberto");
  atualizarBotaoMenu();
  if (focoAntes && document.contains(focoAntes)) focoAntes.focus();
  focoAntes = null;
}

export function alternarAssistente() {
  if (painel && !painel.hidden) fecharAssistente();
  else abrirAssistente();
}

async function irParaConfiguracoes() {
  const { openConfiguracoesModal } = await import("../modals/configuracoes-modal.js");
  openConfiguracoesModal("assistente");
}

function ligarEventos(el) {
  el.addEventListener("click", async (e) => {
    // link na resposta do modelo: nunca navega o app — abre no navegador
    const link = e.target.closest(".ia-msg-texto a[href]");
    if (link) {
      e.preventDefault();
      openExternal(link.href);
      return;
    }
    const alvo = e.target.closest("[data-ia]");
    if (!alvo) return;
    const acao = alvo.dataset.ia;
    if (acao === "sair") fecharAssistente();
    else if (acao === "nova") novaConversa();
    else if (acao === "historico") renderHistorico();
    else if (acao === "envios") renderEnvios();
    else if (acao === "voltar") voltarPraConversa();
    else if (acao === "configurar") irParaConfiguracoes();
    else if (acao === "abrir") abrirConversa(alvo.dataset.id);
    else if (acao === "remover") {
      await apagarConversa(alvo.dataset.id).catch(() => {});
      if (alvo.dataset.id === conversaId) {
        conversaId = null;
        mensagens = [];
      }
      renderHistorico();
    } else if (acao === "limpar-tudo" || acao === "limpar-envios") {
      const { showConfirmModal } = await import("../modals/confirm-modal.js");
      const tudo = acao === "limpar-tudo";
      const ok = await showConfirmModal(t(tudo ? "assistente.chat.apagar_tudo_confirma" : "assistente.chat.apagar_registro_confirma"), {
        title: t(tudo ? "assistente.chat.apagar_tudo" : "assistente.chat.apagar_registro"),
        confirmText: t("geral.remover"),
        danger: true,
      });
      if (!ok) return;
      if (tudo) {
        await apagarTodasConversas().catch(() => {});
        conversaId = null;
        mensagens = [];
        renderHistorico();
      } else {
        await apagarEnvios().catch(() => {});
        renderEnvios();
      }
    }
  });
  const form = el.querySelector("#ia-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (enviando) parar();
    else enviar();
  });
  el.querySelector("#ia-texto").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!enviando) enviar();
    }
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.stopPropagation();
      if (vista !== "conversa") voltarPraConversa();
      else fecharAssistente();
    }
  });
}

// ── botão no menu (item "assistente kami") ───────────────────────────────

function botaoMenu() {
  return document.querySelector('.nav-link[data-assistente]');
}

function atualizarBotaoMenu() {
  const b = botaoMenu();
  if (!b) return;
  b.setAttribute("aria-expanded", String(Boolean(painel && !painel.hidden)));
  b.classList.toggle("active", Boolean(painel && !painel.hidden));
}

function aplicarVisibilidade(estado) {
  const b = botaoMenu();
  if (b) b.hidden = Boolean(estado?.config?.escondido);
}

/** Chamar uma vez no boot (app.js). */
export async function wireAssistente() {
  const b = botaoMenu();
  if (b) {
    b.addEventListener("click", alternarAssistente);
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        alternarAssistente();
      }
    });
  }
  window.addEventListener("kami:assistente-config", (e) => {
    estadoIa = e.detail;
    aplicarVisibilidade(estadoIa);
    if (painel && !painel.hidden) {
      renderProvedor();
      if (vista === "conversa") voltarPraConversa();
    }
  });
  // PIN: bloqueou com o painel aberto — fecha (a conversa não pode ficar à mostra)
  window.addEventListener("kami:bloqueado", () => {
    parar();
    fecharAssistente();
  });
  aplicarVisibilidade(await carregarEstado());
}
