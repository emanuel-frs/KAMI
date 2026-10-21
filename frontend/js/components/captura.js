/**
 * components/captura.js — captura rápida (ORG-02).
 *
 * Alt+Q (e Alt+Espaço onde o sistema deixa — no GNOME ele é o menu da
 * janela e nunca chega ao app) abre uma linha no topo da tela, no visual
 * do terminal. Digita qualquer coisa e Enter:
 *   - sem prefixo: vai pra caixa de entrada (Organização › entrada) pra
 *     decidir depois o que vira;
 *   - "$ 25 almoço", "# ideia", "! amanhã 9h dentista", "@ 18h remédio": abre o formulário
 *     certo JÁ PREENCHIDO pra conferir (P-38) — interpretação em
 *     components/captura-texto.js, e a linha embaixo do campo mostra o que
 *     vai acontecer antes do Enter.
 *
 * Nada se perde: com prefixo, o texto entra na caixa de entrada primeiro
 * e só sai quando o formulário salva — cancelar deixa ele lá.
 *
 * converterItem() é o mesmo caminho usado pelos botões da caixa de
 * entrada (pages/organizacao-entrada.js): gasto, tarefa, nota, meta,
 * evento.
 */
import * as api from "../api/entrada.js";
import { listBanks } from "../api/carteira.js";
import { interpretarCaptura } from "./captura-texto.js";
import { icon } from "./icons.js";
import { escapeHtml, fmtMoney } from "./format.js";
import { showToast } from "./toast.js";
import { navigateTo } from "./navigate.js";
import { getShortcuts } from "./shortcuts.js";

export const TIPOS_CONVERSAO = [
  { tipo: "gasto", rotulo: "gasto", icone: "receipt" },
  { tipo: "tarefa", rotulo: "tarefa", icone: "check" },
  { tipo: "nota", rotulo: "nota", icone: "pencil" },
  { tipo: "meta", rotulo: "meta", icone: "target" },
  { tipo: "evento", rotulo: "evento", icone: "calendar-days" },
  { tipo: "lembrete", rotulo: "lembrete", icone: "bell-ring" },
];

function avisarMudou() {
  window.dispatchEvent(new CustomEvent("kami:entrada-mudou"));
}

async function tirarDaEntrada(id) {
  try {
    await api.descartarEntrada(id);
  } catch {
    /* já tinha saído */
  }
  avisarMudou();
}

/** Espera a criação acontecer (qualquer POST que bata com `caminho`,
 * visto pelo kami:data-changed do api/client.js) — pros formulários que
 * não têm callback de "salvou" (meta). Desiste sozinho em 15 min. */
function quandoCriar(caminho, fn) {
  const ouvir = (e) => {
    const { method, path } = e.detail || {};
    if (method === "POST" && caminho.test(path || "")) {
      parar();
      fn();
    }
  };
  const parar = () => window.removeEventListener("kami:data-changed", ouvir);
  window.addEventListener("kami:data-changed", ouvir);
  setTimeout(parar, 15 * 60 * 1000);
}

function dataLegivel(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}${a !== String(new Date().getFullYear()) ? `/${a}` : ""}`;
}

/** O que cada tipo vira, a partir do texto (com ou sem prefixo). */
function dadosPara(tipo, texto) {
  const semPrefixo = texto.replace(/^[$#!@]\s*/, "");
  if (tipo === "gasto") return interpretarCaptura(`$ ${semPrefixo}`);
  if (tipo === "evento") return interpretarCaptura(`! ${semPrefixo}`);
  if (tipo === "nota") return interpretarCaptura(`# ${semPrefixo}`);
  if (tipo === "lembrete") return interpretarCaptura(`@ ${semPrefixo}`);
  return { titulo: semPrefixo };
}

/**
 * Transforma um item da caixa de entrada. Abre o formulário preenchido;
 * o item sai da entrada quando o formulário salva.
 * @param {{id: string, texto: string}} item
 * @param {"gasto"|"tarefa"|"nota"|"meta"|"evento"} tipo
 */
export async function converterItem(item, tipo) {
  const d = dadosPara(tipo, item.texto);
  const sair = () => tirarDaEntrada(item.id);

  if (tipo === "tarefa") {
    await api.virarTarefa(item.id);
    avisarMudou();
    showToast({ title: "virou tarefa", message: 'está na nota "tarefas" (organização › notas)', iconName: "check", duration: 4000, sound: false });
    return;
  }
  if (tipo === "gasto") {
    const { openTransacaoModal } = await import("../modals/transacao-modal.js");
    const banks = await listBanks().catch(() => []);
    openTransacaoModal({
      accounts: banks.flatMap((b) => b.accounts.map((a) => ({ ...a, bankNome: b.nome }))),
      inicial: { type: "saida", description: d.descricao || "", amount: d.valor ?? "", date: d.data || undefined },
      onSaved: () => {
        sair();
        window.dispatchEvent(new CustomEvent("kami:wallet-changed"));
      },
    });
    return;
  }
  if (tipo === "evento") {
    const { openCalendarioEventoModal } = await import("../modals/calendario-evento-modal.js");
    const hoje = new Date();
    const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    openCalendarioEventoModal({ date: d.data || hojeIso, inicial: { title: d.titulo, time: d.hora || "" }, onSaved: sair });
    return;
  }
  if (tipo === "nota") {
    const { openNotaRapida } = await import("../modals/nota-rapida-modal.js");
    openNotaRapida({ titulo: d.titulo, conteudo: d.conteudo || "", onCriada: sair });
    return;
  }
  if (tipo === "lembrete") {
    const { openLembreteModal } = await import("../modals/lembrete-modal.js");
    const inicial = { titulo: d.titulo };
    if (d.data) inicial.data = d.data;
    if (d.hora) inicial.hora = d.hora;
    openLembreteModal({ inicial, onSaved: (l) => l && sair() });
    return;
  }
  if (tipo === "meta") {
    quandoCriar(/^\/api\/metas\/?$/, sair);
    await navigateTo("metas");
    getShortcuts().screen?.actions.find((a) => a.code === "KeyN")?.run();
    // o modal de meta monta sozinho; o título entra quando ele aparecer
    setTimeout(() => {
      const campo = document.querySelector("#goal-modal.open #goal-title-input");
      if (campo && !campo.value) {
        campo.value = d.titulo;
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, 120);
  }
}

// ---------------------------------------------------------------- a linha de captura

let el = null;
let focoAntes = null;

function previa(texto) {
  const t = texto.trim();
  if (!t) return "";
  const r = interpretarCaptura(t);
  if (r.tipo === "gasto") {
    const partes = [r.valor != null ? fmtMoney(r.valor) : "valor a preencher", r.descricao || "sem descrição", r.data ? dataLegivel(r.data) : "hoje"];
    return `${icon("receipt", { size: 11 })} gasto: ${escapeHtml(partes.join(" · "))} — confira e confirme`;
  }
  if (r.tipo === "nota") return `${icon("pencil", { size: 11 })} nota: ${escapeHtml(r.titulo || "(sem título)")}`;
  if (r.tipo === "evento") {
    const quando = [r.data ? dataLegivel(r.data) : "hoje", r.hora].filter(Boolean).join(" às ");
    return `${icon("calendar-days", { size: 11 })} evento: ${escapeHtml(r.titulo || "(sem título)")} · ${escapeHtml(quando)} — confira e confirme`;
  }
  if (r.tipo === "lembrete") {
    const quando = [r.data ? dataLegivel(r.data) : "hoje", r.hora || "(hora a escolher)"].join(" às ");
    return `${icon("bell-ring", { size: 11 })} lembrete: ${escapeHtml(r.titulo || "(sem texto)")} · ${escapeHtml(quando)} — confira e confirme`;
  }
  return `${icon("download", { size: 11 })} vai pra caixa de entrada — decida depois o que vira`;
}

function montar() {
  const wrap = document.createElement("div");
  wrap.className = "paleta-fundo captura-fundo";
  wrap.id = "captura";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="paleta captura" role="dialog" aria-modal="true" aria-label="captura rápida">
      <div class="paleta-entrada">
        <span class="paleta-prompt" aria-hidden="true">+</span>
        <input type="text" id="captura-q" autocomplete="off" spellcheck="true" maxlength="2000"
          placeholder="anote qualquer coisa…" aria-describedby="captura-previa">
      </div>
      <div class="captura-previa" id="captura-previa" aria-live="polite"></div>
      <div class="paleta-rodape" aria-hidden="true">
        <kbd>$</kbd> 25 almoço = gasto · <kbd>#</kbd> ideia = nota · <kbd>!</kbd> amanhã 9h dentista = evento · <kbd>@</kbd> 18h remédio = lembrete · enter guarda · esc fecha
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector("#captura-q");
  input.addEventListener("input", () => {
    wrap.querySelector("#captura-previa").innerHTML = previa(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      fecharCaptura();
    } else if (e.key === "Enter") {
      e.preventDefault();
      enviar(input.value);
    }
  });
  wrap.addEventListener("mousedown", (e) => {
    if (e.target === wrap) fecharCaptura();
  });
  return wrap;
}

async function enviar(texto) {
  const t = texto.trim();
  if (!t) return;
  const r = interpretarCaptura(t);
  let item;
  try {
    item = await api.guardarEntrada(t);
  } catch {
    return; // o client já mostrou o erro; o texto continua no campo
  }
  fecharCaptura({ devolverFoco: r.tipo === "entrada" });
  avisarMudou();
  if (r.tipo === "entrada") {
    showToast({
      title: "guardado na caixa de entrada",
      message: t.length > 60 ? t.slice(0, 57) + "…" : t,
      iconName: "download",
      duration: 3500,
      sound: false,
      actions: [{ label: "ver", onClick: () => navigateTo("organizacao", { tab: "entrada" }) }],
    });
    return;
  }
  converterItem(item, r.tipo).catch((err) => console.error("captura: falha ao abrir o formulário", err));
}

export function abrirCaptura() {
  el = el && el.isConnected ? el : montar();
  if (!el.hidden) {
    el.querySelector("#captura-q").select();
    return;
  }
  focoAntes = document.activeElement;
  el.hidden = false;
  const input = el.querySelector("#captura-q");
  input.value = "";
  el.querySelector("#captura-previa").innerHTML = "";
  input.focus();
}

export function fecharCaptura({ devolverFoco = true } = {}) {
  if (!el || el.hidden) return;
  el.hidden = true;
  if (devolverFoco && focoAntes?.isConnected) focoAntes.focus?.();
}
