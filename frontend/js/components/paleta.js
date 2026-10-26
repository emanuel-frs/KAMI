/**
 * components/paleta.js — busca global e comandos, Ctrl+K (ORG-03).
 *
 * Uma linha de comando no topo da tela: o que se digita procura em tudo
 * que o Kami guarda (notas, metas, trilhas, lançamentos, contas,
 * eventos, conquistas, e-mails… — backend em app/busca.py, ignorando
 * acento) e também nas AÇÕES do app ("nova nota", "ir para finanças",
 * "abrir configurações"…), que ficam só aqui no frontend.
 *
 * 100% teclado: ↑/↓ (ou Ctrl+P/Ctrl+N) escolhem, Enter abre, Esc fecha.
 * Sem texto, mostra as ações. Os resultados vêm agrupados por tipo, na
 * ordem do melhor resultado de cada grupo; ações que batem vêm antes.
 *
 * Abrir um item usa o caminho que cada tela já entende: nota/e-mail por
 * `navigateTo(..., opts)`, o resto por foco pendente
 * (components/pending-focus.js) + `remontar` (app.js monta a tela de
 * novo mesmo se já estiver nela, pra o foco ser lido).
 *
 * Ctrl+K dentro do editor de notas é "link" (como no Teams) — o editor
 * para o evento antes de chegar aqui (components/nota-editor.js).
 */
import { buscar } from "../api/busca.js";
import { getPin } from "../api/seguranca.js";
import { icon } from "./icons.js";
import { escapeHtml, fmtData, fmtMoney } from "./format.js";
import { noIdiomaAtual, t } from "../i18n.js";
import { navigateTo } from "./navigate.js";
import { setPendingFocus } from "./pending-focus.js";
import { openExternal } from "./open-external.js";
import { getShortcuts } from "./shortcuts.js";

const ESPERA_MS = 140;

// ---------------------------------------------------------------- texto

export function semAcento(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Todas as palavras digitadas aparecem no texto (sem acento, sem caixa). */
export function bate(texto, consulta) {
  const alvo = semAcento(texto);
  return semAcento(consulta)
    .split(/\s+/)
    .filter(Boolean)
    .every((p) => alvo.includes(p));
}

// ---------------------------------------------------------------- ações

const TELAS = [
  ["perfil", "user"],
  ["nucleo", "zap"],
  ["financas", "receipt"],
  ["carreira", "trending-up"],
  ["aprendizado", "target"],
  ["organizacao", "link"],
  ["metas", "target"],
  ["calendario", "calendar-days"],
  ["habitos", "repeat"],
];

/** Vai pra tela e roda a ação "N" dela (nova meta/trilha/evento…). */
async function rodarNaTela(pagina, code) {
  await navigateTo(pagina);
  getShortcuts().screen?.actions.find((a) => a.code === code)?.run();
}

async function abrirConfig(aba) {
  const { openConfiguracoesModal } = await import("../modals/configuracoes-modal.js");
  openConfiguracoesModal(aba);
}

function acoes(pinLigado) {
  const lista = [
    { rotulo: t("paleta.acao.nova_nota"), extra: t("paleta.extra.nova_nota"), icone: "pencil", run: () => navigateTo("organizacao", { tab: "notas", novaNota: {} }) },
    {
      rotulo: t("paleta.acao.nota_rapida"),
      extra: t("paleta.extra.nota_rapida"),
      icone: "pencil",
      run: async () => (await import("../modals/nota-rapida-modal.js")).openNotaRapida(),
    },
    {
      rotulo: t("paleta.acao.novo_lancamento"),
      extra: t("paleta.extra.novo_lancamento"),
      icone: "receipt",
      run: () => {
        setPendingFocus("lancamento", "novo");
        navigateTo("financas", { remontar: true });
      },
    },
    { rotulo: t("paleta.acao.nova_meta"), extra: t("paleta.extra.nova_meta"), icone: "target", run: () => rodarNaTela("metas", "KeyN") },
    { rotulo: t("paleta.acao.nova_trilha"), extra: t("paleta.extra.nova_trilha"), icone: "target", run: () => rodarNaTela("aprendizado", "KeyN") },
    { rotulo: t("paleta.acao.novo_evento"), extra: t("paleta.extra.novo_evento"), icone: "calendar-days", run: () => rodarNaTela("calendario", "KeyN") },
    {
      rotulo: t("paleta.acao.novo_lembrete"),
      extra: t("paleta.extra.novo_lembrete"),
      icone: "bell-ring",
      run: async () => (await import("../modals/lembrete-modal.js")).openLembreteModal(),
    },
    { rotulo: t("paleta.acao.novo_habito"), extra: t("paleta.extra.novo_habito"), icone: "repeat", run: () => rodarNaTela("habitos", "KeyN") },
    {
      rotulo: t("paleta.acao.sincronizar_emails"),
      extra: t("paleta.extra.sincronizar_emails"),
      icone: "refresh-cw",
      run: async () => {
        await navigateTo("organizacao", { tab: "email" });
        document.querySelector("#org-email-sync-btn")?.click();
      },
    },
    { rotulo: t("paleta.acao.abrir_configuracoes"), extra: t("paleta.extra.abrir_configuracoes"), icone: "settings", run: () => abrirConfig("aparencia") },
    { rotulo: t("paleta.acao.cfg_aparencia"), extra: t("paleta.extra.cfg_aparencia"), icone: "palette", run: () => abrirConfig("aparencia") },
    { rotulo: t("paleta.acao.cfg_seguranca"), extra: t("paleta.extra.cfg_seguranca"), icone: "shield", run: () => abrirConfig("seguranca") },
    { rotulo: t("paleta.acao.cfg_backup"), extra: t("paleta.extra.cfg_backup"), icone: "download", run: () => abrirConfig("backup") },
    { rotulo: t("paleta.acao.cfg_notificacoes"), extra: t("paleta.extra.cfg_notificacoes"), icone: "bell", run: () => abrirConfig("notificacoes") },
    {
      rotulo: t("paleta.acao.atalhos"),
      extra: t("paleta.extra.atalhos"),
      icone: "key",
      run: async () => (await import("../modals/shortcuts-help-modal.js")).openShortcutsHelp(),
    },
    ...TELAS.map(([pagina, ic]) => ({
      rotulo: t("paleta.ir_para", { tela: t(`nav.${pagina}`) }),
      extra: t("paleta.extra.tela"),
      icone: ic,
      tela: true,
      run: () => navigateTo(pagina),
    })),
  ];
  if (pinLigado) {
    lista.push({
      rotulo: t("paleta.acao.bloquear"),
      extra: t("paleta.extra.bloquear"),
      icone: "lock",
      run: async () => (await import("./lock-screen.js")).bloquearAgora(),
    });
  }
  return lista.map((a) => ({ ...a, tipo: "acao" }));
}

// ---------------------------------------------------------------- resultados do banco

// ícone e como abrir (o rótulo do grupo é paleta.grupo.<tipo>)
const TIPOS = {
  nota: { icone: "pencil", abrir: (r) => navigateTo("organizacao", { tab: "notas", notaId: r.id }) },
  meta: { icone: "target", abrir: (r) => foco("meta", r.id, "metas") },
  habito: { icone: "repeat", abrir: (r) => foco("habito", r.id, "habitos") },
  trilha: { icone: "trending-up", abrir: (r) => foco("trilha", r.id, "aprendizado") },
  marco: { icone: "check", abrir: (r) => foco("trilha", r.ref, "aprendizado") },
  lancamento: { icone: "receipt", abrir: (r) => foco("lancamento", `${r.id}|${r.data || ""}`, "financas") },
  conta_fixa: { icone: "repeat", abrir: (r) => foco("conta_fixa", r.id, "financas") },
  assinatura: { icone: "repeat", abrir: (r) => foco("assinatura", r.id, "financas") },
  divida: { icone: "credit-card", abrir: (r) => foco("divida", r.id, "financas") },
  parcela: { icone: "credit-card", abrir: (r) => foco("parcela", r.id, "financas") },
  conta: { icone: "credit-card", abrir: () => navigateTo("financas") },
  evento: { icone: "calendar-days", abrir: (r) => foco("data", r.ref, "calendario") },
  conquista: { icone: "star", abrir: (r) => foco("conquista", r.id, "nucleo") },
  posicao: { icone: "user", abrir: (r) => foco("posicao", r.id, "carreira") },
  formacao: { icone: "user", abrir: (r) => foco("formacao", r.id, "carreira") },
  link: { icone: "link", abrir: (r) => openExternal(r.ref) },
  repositorio: { icone: "external-link", abrir: () => navigateTo("organizacao", { tab: "github" }) },
  email: {
    icone: "mail",
    abrir: (r) => navigateTo("organizacao", { tab: "email", accountId: r.ref, focusEmailId: r.id }),
  },
};

function foco(tipo, id, pagina) {
  setPendingFocus(tipo, id);
  return navigateTo(pagina, { remontar: true });
}

function dataCurta(iso) {
  return /^\d{4}-\d{2}-\d{2}/.test(iso || "") ? fmtData(iso.slice(0, 10)) : "";
}

function detalheDe(r) {
  const partes = [];
  if (r.tipo === "nota" && r.ref === "1") partes.push(t("paleta.trancada"));
  if (r.tipo === "conquista") partes.push(r.ref === "1" ? t("paleta.desbloqueada") : t("paleta.bloqueada"));
  if (r.detalhe) partes.push(r.detalhe);
  if (r.valor != null) partes.push(fmtMoney(r.valor));
  if (r.data && ["lancamento", "evento", "email", "divida"].includes(r.tipo)) partes.push(dataCurta(r.data));
  return partes.join(" · ");
}

// ---------------------------------------------------------------- estado / DOM

let el = null;
let itens = []; // o que está na lista, na ordem: {tipo, rotulo, detalhe, icone, run}
let ativo = 0;
let pedido = 0;
let timer = null;
let listaAcoes = [];
let focoAntes = null;

function montar() {
  const wrap = document.createElement("div");
  wrap.className = "paleta-fundo";
  wrap.id = "paleta";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="paleta" role="dialog" aria-modal="true" aria-label="${t("paleta.aria")}">
      <div class="paleta-entrada">
        <span class="paleta-prompt" aria-hidden="true">&gt;</span>
        <input type="text" id="paleta-q" autocomplete="off" spellcheck="false"
          placeholder="${t("paleta.placeholder")}"
          role="combobox" aria-expanded="true" aria-controls="paleta-lista" aria-autocomplete="list">
        <span class="paleta-status" id="paleta-status" aria-live="polite"></span>
      </div>
      <div class="paleta-lista" id="paleta-lista" role="listbox" aria-label="${t("paleta.resultados")}"></div>
      <div class="paleta-rodape" aria-hidden="true">${t("paleta.rodape")}</div>
    </div>`;
  document.body.appendChild(wrap);

  const input = wrap.querySelector("#paleta-q");
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(atualizar, ESPERA_MS);
    mostrarSoAcoes(input.value); // as ações respondem na hora
  });
  input.addEventListener("keydown", onTecla);
  wrap.addEventListener("mousedown", (e) => {
    if (e.target === wrap) fechar();
  });
  wrap.addEventListener("mousemove", (e) => {
    const item = e.target.closest("[data-i]");
    if (item && Number(item.dataset.i) !== ativo) marcar(Number(item.dataset.i));
  });
  wrap.addEventListener("click", (e) => {
    const item = e.target.closest("[data-i]");
    if (item) escolher(Number(item.dataset.i));
  });
  return wrap;
}

function onTecla(e) {
  const k = e.key;
  if (k === "ArrowDown" || (e.ctrlKey && k.toLowerCase() === "n")) {
    e.preventDefault();
    marcar(ativo + 1);
  } else if (k === "ArrowUp" || (e.ctrlKey && k.toLowerCase() === "p")) {
    e.preventDefault();
    marcar(ativo - 1);
  } else if (k === "PageDown" || k === "PageUp") {
    e.preventDefault();
    marcar(ativo + (k === "PageDown" ? 6 : -6));
  } else if (k === "Enter") {
    e.preventDefault();
    escolher(ativo);
  } else if (k === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    fechar();
  } else if (k === "Tab") {
    e.preventDefault(); // o foco fica no campo; a lista é navegada pelas setas
  }
}

function marcar(i) {
  if (!itens.length) return;
  ativo = (i + itens.length) % itens.length;
  el.querySelectorAll("[data-i]").forEach((n) => {
    const on = Number(n.dataset.i) === ativo;
    n.classList.toggle("on", on);
    n.setAttribute("aria-selected", String(on));
    if (on) {
      n.scrollIntoView?.({ block: "nearest" });
      el.querySelector("#paleta-q").setAttribute("aria-activedescendant", n.id);
    }
  });
}

function desenhar(grupos) {
  itens = [];
  const html = grupos
    .filter((g) => g.itens.length)
    .map((g) => {
      const linhas = g.itens
        .map((it) => {
          const i = itens.push(it) - 1;
          return `
          <div class="paleta-item" id="paleta-i${i}" role="option" aria-selected="false" data-i="${i}">
            <span class="paleta-icone">${icon(it.icone || "chevron-right", { size: 12 })}</span>
            <span class="paleta-texto">
              <span class="paleta-rotulo">${escapeHtml(it.rotulo)}</span>
              ${it.detalhe ? `<span class="paleta-detalhe">${escapeHtml(it.detalhe)}</span>` : ""}
            </span>
          </div>`;
        })
        .join("");
      return `<div class="paleta-grupo" role="presentation">${escapeHtml(g.nome)}</div>${linhas}`;
    })
    .join("");
  const lista = el.querySelector("#paleta-lista");
  lista.innerHTML = html || `<div class="paleta-vazio">${t("paleta.nada")}</div>`;
  ativo = 0;
  marcar(0);
}

let ultimosResultados = [];

function gruposAcoes(q) {
  const acoesQueBatem = q.trim() ? listaAcoes.filter((a) => bate(`${a.rotulo} ${a.extra}`, q)) : listaAcoes;
  const comandos = acoesQueBatem.filter((a) => !a.tela);
  const telas = acoesQueBatem.filter((a) => a.tela);
  return [
    { nome: t("paleta.comandos"), itens: comandos },
    { nome: t("paleta.telas"), itens: telas },
  ];
}

function mostrarSoAcoes(q) {
  // enquanto a busca no banco não volta: ações na hora + os resultados de antes
  desenhar([...gruposAcoes(q), ...ultimosResultados]);
}

async function atualizar() {
  const q = el.querySelector("#paleta-q").value;
  const meu = ++pedido;
  if (!q.trim()) {
    ultimosResultados = [];
    desenhar(gruposAcoes(q));
    setStatus("");
    return;
  }
  setStatus(t("paleta.buscando"));
  let resultados = [];
  try {
    resultados = await buscar(q);
  } catch {
    if (meu === pedido) setStatus(t("paleta.indisponivel"));
    return;
  }
  if (meu !== pedido || el.hidden) return;
  setStatus(resultados.length ? "" : "");
  // agrupa por tipo, grupos na ordem do primeiro (melhor) resultado
  const porTipo = new Map();
  for (const r of resultados) {
    const def = TIPOS[r.tipo];
    if (!def) continue;
    if (!porTipo.has(r.tipo)) porTipo.set(r.tipo, { nome: t(`paleta.grupo.${r.tipo}`), itens: [] });
    porTipo.get(r.tipo).itens.push({
      tipo: r.tipo,
      rotulo: r.titulo,
      detalhe: detalheDe(r),
      icone: def.icone,
      run: () => def.abrir(r),
    });
  }
  ultimosResultados = [...porTipo.values()];
  const acoesGrupos = gruposAcoes(q);
  // ações que batem com o texto vêm primeiro; se nenhuma, só o banco
  desenhar([acoesGrupos[0], ...ultimosResultados, acoesGrupos[1]]);
}

function setStatus(texto) {
  const s = el?.querySelector("#paleta-status");
  if (s) s.textContent = texto;
}

function escolher(i) {
  const it = itens[i];
  if (!it) return;
  fechar({ devolverFoco: false });
  Promise.resolve()
    .then(() => it.run())
    .catch((err) => console.error("paleta: falha ao abrir", err));
}

export async function abrirPaleta() {
  el = noIdiomaAtual(el, montar);
  if (!el.hidden) {
    el.querySelector("#paleta-q").select();
    return;
  }
  focoAntes = document.activeElement;
  listaAcoes = acoes(false);
  ultimosResultados = [];
  el.hidden = false;
  const input = el.querySelector("#paleta-q");
  input.value = "";
  setStatus("");
  desenhar(gruposAcoes(""));
  input.focus();
  // "bloquear agora" só existe com o PIN ligado
  getPin()
    .then((estado) => {
      if (estado?.ativo && !el.hidden) {
        listaAcoes = acoes(true);
        if (!input.value.trim()) desenhar(gruposAcoes(""));
      }
    })
    .catch(() => {});
}

export function fechar({ devolverFoco = true } = {}) {
  if (!el || el.hidden) return;
  el.hidden = true;
  clearTimeout(timer);
  pedido++;
  if (devolverFoco && focoAntes?.isConnected) focoAntes.focus?.();
}

let ligado = false;
/** Ctrl+K em qualquer tela. Chamar uma vez no boot (app.js). */
export function wirePaleta() {
  if (ligado) return;
  ligado = true;
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k" || e.repeat) return;
    // tela de PIN, apresentação do primeiro uso, modal ou sequência de
    // dicas aberta: não (a dica fica por cima da paleta e o Esc é dela —
    // mesma regra dos atalhos Alt, contextIsBusy() em shortcuts.js;
    // achado no e2e do CONF-09)
    if (document.querySelector(".lock-screen:not([hidden]), .ki-backdrop.open, .modal-backdrop.open, .tip-seq-root")) return;
    e.preventDefault();
    if (el && !el.hidden) fechar();
    else abrirPaleta();
  });
}
