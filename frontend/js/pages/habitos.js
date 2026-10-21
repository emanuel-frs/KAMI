import { listHabitos, updateHabito, deleteHabito, marcarHabito, desmarcarHabito } from "../api/habitos.js";
import { escapeHtml, localDateKey, fmtDataCurta } from "../components/format.js";
import { DIAS_CURTOS, alternarHoje, itemHojeHtml, rotuloAtributo, rotuloFrequencia, rotuloSequencia } from "../components/habito-linha.js";
import { icon } from "../components/icons.js";
import { showErrorModal } from "../modals/err-modal.js";
import { showConfirmModal } from "../modals/confirm-modal.js";
import { openHabitoModal, closeHabitoModal } from "../modals/habito-modal.js";
import { consumePendingFocus, focusRow } from "../components/pending-focus.js";
import { store } from "../state/store.js";
import { maybeStartHabitosTips, replayHabitosTips } from "./habitos-tips.js";
import { cancelActiveTipSequence } from "../components/tip-sequence.js";
import { registerScreenTipsReplay, clearScreenTipsReplay } from "../components/screen-tips-registry.js";
import { registerScreenShortcuts, clearScreenShortcuts } from "../components/shortcuts.js";

/**
 * pages/habitos.js — tela de hábitos (ORG-04, P-55), Alt+9.
 *
 *   hoje           a lista do dia: clique marca/desmarca (+5 xp no
 *                  atributo; desmarcar estorna). Hábito de dias fixos fora
 *                  do dia aparece apagado, sem botão.
 *   12 semanas     um card por hábito com a grade de texto (■ feito,
 *                  □ faltou, · não valia, ◇ hoje pendente), sequência,
 *                  recorde e "30 dias". Os dias até 2 atrás (P-43) são
 *                  botões na grade — é assim que se marca um dia passado.
 *   arquivados     escondidos atrás de um botão no fim; histórico e xp
 *                  ficam. Pausado (P-59) continua na grade, fora do "hoje".
 *
 * Regras (sequência em semanas pros "x por semana", P-57) no backend:
 * app/habitos.py. O widget "hábitos de hoje" (widgets/habitos-hoje.js)
 * usa a mesma API e avisa pelo evento kami:habitos-mudaram.
 */

const DIAS_PARA_TRAS = 2;
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const GLIFO = { feito: "■", faltou: "□", livre: "·", fora: "·", hoje: "◇", futuro: " " };
const ESTADO_FALADO = {
  feito: "feito",
  faltou: "faltou",
  livre: "sem marca",
  fora: "não valia",
  hoje: "hoje, pendente",
};

let containerEl = null;
let habitos = [];
let arquivados = null; // null = escondidos
let shortcutsToken = null;
let unsubscribeProfile = null;
let currentReplayFn = null;
let ouvirMudanca = null;

// ---------------------------------------------------------------- datas

function diaDaGrade(h, i) {
  const [a, m, d] = h.grade.inicio.split("-").map(Number);
  return new Date(a, m - 1, d + i);
}

function hojeLegivel() {
  const d = new Date();
  return `${DIAS_CURTOS[(d.getDay() + 6) % 7]} ${fmtDataCurta(localDateKey(d))}`;
}

// ---------------------------------------------------------------- grade

function gradeHtml(h) {
  const semanas = h.grade.estados.length / 7;
  const limite = new Date();
  limite.setHours(0, 0, 0, 0);
  limite.setDate(limite.getDate() - DIAS_PARA_TRAS);
  const podeMexer = h.status === "ativo";

  // rótulo do mês na coluna da semana em que ele começa
  let meses = `<span></span>`;
  let ultimoMes = null;
  for (let w = 0; w < semanas; w++) {
    const mes = diaDaGrade(h, w * 7 + 6).getMonth();
    meses += `<span class="hb-mes">${mes !== ultimoMes ? MESES[mes] : ""}</span>`;
    ultimoMes = mes;
  }

  let linhas = "";
  for (let d = 0; d < 7; d++) {
    linhas += `<span class="hb-dia-sem">${DIAS_CURTOS[d]}</span>`;
    for (let w = 0; w < semanas; w++) {
      const i = w * 7 + d;
      const estado = h.grade.estados[i];
      const dia = diaDaGrade(h, i);
      const marcavel = podeMexer && dia >= limite && estado !== "fora" && estado !== "futuro";
      const glifo = GLIFO[estado] ?? " ";
      if (marcavel) {
        const feito = estado === "feito";
        const quando = `${DIAS_CURTOS[d]} ${fmtDataCurta(localDateKey(dia))}`;
        linhas += `<button type="button" class="hb-cel hb-e-${estado} hb-marcavel" data-dia="${localDateKey(dia)}" aria-pressed="${feito}"
          aria-label="${escapeHtml(`${h.nome}, ${quando}: ${ESTADO_FALADO[estado]} — ${feito ? "desmarcar" : "marcar"}`)}"
          data-tooltip="${quando}: ${feito ? "desmarcar" : "marcar"}">${glifo}</button>`;
      } else {
        linhas += `<span class="hb-cel hb-e-${estado}" aria-hidden="true">${glifo}</span>`;
      }
    }
  }
  const resumo = `${h.nome}: sequência ${rotuloSequencia(h)}, recorde ${rotuloSequencia(h, h.recorde)}`;
  return `<div class="hb-grade" style="--hb-semanas:${semanas}" role="group" aria-label="${escapeHtml(resumo)} — últimas ${semanas} semanas">${meses}${linhas}</div>`;
}

function cardHtml(h) {
  const arquivado = h.status === "arquivado";
  const pausado = h.status === "pausado";
  const pct = h.aproveitamento_30d == null ? "—" : `${h.aproveitamento_30d}%`;
  const acoes = arquivado
    ? `<span class="icon-btn" data-acao="desarquivar" data-tooltip="desarquivar" aria-label="desarquivar">${icon("archive", { size: 13 })}</span>`
    : `<span class="icon-btn" data-acao="${pausado ? "retomar" : "pausar"}" data-tooltip="${pausado ? "retomar" : "pausar (a sequência congela)"}" aria-label="${pausado ? "retomar" : "pausar"}">${icon(pausado ? "play" : "pause", { size: 13 })}</span>
       <span class="icon-btn" data-acao="lembrar" data-tooltip="lembrar (não avisa se já marcou no dia)" aria-label="lembrar">${icon("bell-ring", { size: 13 })}</span>
       <span class="icon-btn" data-acao="editar" data-tooltip="editar" aria-label="editar">${icon("pencil", { size: 15 })}</span>
       <span class="icon-btn" data-acao="arquivar" data-tooltip="arquivar (guarda o histórico)" aria-label="arquivar">${icon("archive", { size: 13 })}</span>`;
  return `
    <div class="card goal-card hb-card${arquivado || pausado ? " hb-parado" : ""}" data-habito-id="${h.id}">
      <div class="card-head">
        <span class="goal-title" data-tooltip="${escapeHtml(h.nome)}">${escapeHtml(h.nome)}</span>
        <span class="push goal-card-icons">
          ${acoes}
          <span class="icon-btn danger" data-acao="apagar" data-tooltip="apagar" aria-label="apagar">${icon("trash-2", { size: 15 })}</span>
        </span>
      </div>
      <div class="card-body">
        <div class="goal-tags">
          <span class="goal-type-tag">${escapeHtml(rotuloFrequencia(h))}</span>
          <span class="goal-type-tag">${escapeHtml(rotuloAtributo(h.atributo))}</span>
          ${pausado ? `<span class="goal-type-tag hb-tag-parado">pausado</span>` : ""}
          ${arquivado ? `<span class="goal-type-tag hb-tag-parado">arquivado</span>` : ""}
        </div>
        ${gradeHtml(h)}
        <div class="hb-stats">
          <span>sequência <b>${rotuloSequencia(h)}</b></span>
          <span>recorde <b>${rotuloSequencia(h, h.recorde)}</b></span>
          <span>30 dias <b>${pct}</b></span>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- render

function render() {
  if (!containerEl) return;
  const ativos = habitos.filter((h) => h.status === "ativo");
  const valendo = ativos.filter((h) => h.vale_hoje);
  const feitos = valendo.filter((h) => h.feito_hoje).length;

  containerEl.querySelector("#hb-sec-hoje").textContent = valendo.length
    ? `hoje — ${hojeLegivel()} · ${feitos} de ${valendo.length} feitos`
    : `hoje — ${hojeLegivel()}`;
  containerEl.querySelector("#hb-hoje").innerHTML = ativos.length
    ? ativos.map(itemHojeHtml).join("")
    : `<div class="empty-state">${habitos.length ? "nenhum hábito ativo — retome um pausado lá embaixo" : "nenhum hábito ainda — comece por um pequeno (beber água, ler 10 páginas, caminhar)"}</div>`;
  containerEl.querySelector("#hb-dica-hoje").hidden = !ativos.length;

  containerEl.querySelector("#hb-sec-grade").hidden = !habitos.length;
  containerEl.querySelector("#hb-legenda").hidden = !habitos.length;
  containerEl.querySelector("#hb-cards").innerHTML = habitos.map(cardHtml).join("");

  const btnArq = containerEl.querySelector("#hb-arquivados-btn");
  btnArq.textContent = arquivados ? "esconder arquivados" : "ver arquivados";
  const arqEl = containerEl.querySelector("#hb-arquivados");
  arqEl.hidden = !arquivados;
  arqEl.innerHTML = arquivados
    ? arquivados.length
      ? `<div class="goals-section-label">arquivados</div><div class="goals-grid">${arquivados.map(cardHtml).join("")}</div>`
      : `<div class="empty-state">nenhum hábito arquivado</div>`
    : "";
}

async function recarregar() {
  try {
    const [lista, arq] = await Promise.all([listHabitos(), arquivados ? listHabitos({ arquivados: true }) : null]);
    habitos = lista;
    if (arq) arquivados = arq.filter((h) => h.status === "arquivado");
  } catch (err) {
    if (containerEl) containerEl.querySelector("#hb-hoje").innerHTML = `<div class="empty-state">erro ao carregar hábitos: ${escapeHtml(err.message)}</div>`;
    return;
  }
  render();
}

/** Troca um hábito no estado (resposta da API) e redesenha, devolvendo o
 * foco pro mesmo controle — quem marca pelo teclado não perde o lugar. */
function atualizar(h) {
  const ativo = document.activeElement;
  const chave = ativo?.closest?.("[data-habito-id]") && containerEl?.contains(ativo)
    ? { id: ativo.closest("[data-habito-id]").dataset.habitoId, dia: ativo.dataset.dia, marcar: ativo.hasAttribute("data-marcar"), acao: ativo.dataset.acao }
    : null;
  habitos = habitos.map((x) => (x.id === h.id ? h : x));
  render();
  window.dispatchEvent(new CustomEvent("kami:habitos-mudaram", { detail: { origem: "tela" } }));
  if (!chave) return;
  let alvo = null;
  if (chave.dia) alvo = containerEl.querySelector(`.hb-card[data-habito-id="${chave.id}"] [data-dia="${chave.dia}"]`);
  else if (chave.marcar) alvo = containerEl.querySelector(`#hb-hoje [data-habito-id="${chave.id}"]`);
  alvo?.focus();
}


async function aoClicar(e) {
  const linha = e.target.closest("[data-habito-id]");
  if (!linha) return;
  const id = linha.dataset.habitoId;
  const h = habitos.find((x) => x.id === id) || arquivados?.find((x) => x.id === id);
  if (!h) return;

  try {
    if (e.target.closest("[data-marcar]")) {
      atualizar(await alternarHoje(h));
      return;
    }
    const cel = e.target.closest("[data-dia]");
    if (cel) {
      const feito = cel.getAttribute("aria-pressed") === "true";
      atualizar(await (feito ? desmarcarHabito(id, cel.dataset.dia) : marcarHabito(id, cel.dataset.dia)));
      return;
    }
    const acao = e.target.closest("[data-acao]")?.dataset.acao;
    if (!acao) return;
    if (acao === "editar") openHabitoModal({ habito: h, onSaved: atualizar });
    else if (acao === "lembrar") {
      const { openLembreteModal } = await import("../modals/lembrete-modal.js");
      openLembreteModal({ vinculo: { tipo: "habito", id, nome: h.nome } });
    }
    else if (acao === "pausar") atualizar(await updateHabito(id, { status: "pausado" }));
    else if (acao === "retomar") atualizar(await updateHabito(id, { status: "ativo" }));
    else if (acao === "arquivar") {
      await updateHabito(id, { status: "arquivado" });
      if (arquivados) arquivados = null;
      await recarregar();
    } else if (acao === "desarquivar") {
      await updateHabito(id, { status: "ativo" });
      arquivados = arquivados.filter((x) => x.id !== id);
      await recarregar();
    } else if (acao === "apagar") {
      const xp = h.total_marcas * h.xp_por_marca;
      const ok = await showConfirmModal(
        `Apagar o hábito "${h.nome}"? O histórico some${h.total_marcas ? ` e os ${xp} xp das ${h.total_marcas} marcações são estornados` : ""}. Pra guardar o histórico, arquive em vez de apagar.`,
        { title: "apagar hábito", confirmText: "apagar", danger: true },
      );
      if (!ok) return;
      await deleteHabito(id);
      if (arquivados) arquivados = arquivados.filter((x) => x.id !== id);
      await recarregar();
      window.dispatchEvent(new CustomEvent("kami:habitos-mudaram", { detail: { origem: "tela" } }));
    }
  } catch (err) {
    showErrorModal(err.message, "hábitos");
  }
}

function novoHabito() {
  openHabitoModal({
    onSaved: async () => {
      await recarregar();
      window.dispatchEvent(new CustomEvent("kami:habitos-mudaram", { detail: { origem: "tela" } }));
    },
  });
}

export function preload() {
  return listHabitos();
}

// ─── montagem / desmontagem ─────────────────────────────────────────────────

export async function mount(container) {
  containerEl = container;
  arquivados = null;
  shortcutsToken = registerScreenShortcuts({
    name: "hábitos",
    actions: [{ code: "KeyN", label: "novo hábito", run: () => novoHabito() }],
  });

  container.innerHTML = `
    <div class="goals-toolbar">
      <button type="button" class="btn sm push" id="hb-add-btn">+ novo hábito</button>
    </div>
    <div class="goals-section-label" id="hb-sec-hoje">hoje</div>
    <div class="hb-hoje" id="hb-hoje"><div class="empty-state">carregando…</div></div>
    <div class="hb-legenda" id="hb-dica-hoje" hidden>clique marca/desmarca · dias passados (até 2 atrás) se marcam na grade · desmarcar devolve o xp</div>
    <div class="goals-section-label" id="hb-sec-grade" hidden>últimas 12 semanas</div>
    <div class="goals-grid" id="hb-cards"></div>
    <div class="hb-legenda" id="hb-legenda" hidden><b>■</b> feito · □ faltou · · não valia (ou sem marca, nos "x por semana") · <u>◇</u> hoje, pendente</div>
    <div class="hb-rodape"><button type="button" class="btn sm" id="hb-arquivados-btn">ver arquivados</button></div>
    <div id="hb-arquivados" hidden></div>
  `;

  container.querySelector("#hb-add-btn").addEventListener("click", novoHabito);
  container.querySelector("#hb-arquivados-btn").addEventListener("click", async () => {
    if (arquivados) {
      arquivados = null;
      render();
      return;
    }
    try {
      arquivados = (await listHabitos({ arquivados: true })).filter((h) => h.status === "arquivado");
    } catch (err) {
      showErrorModal(err.message, "hábitos");
      return;
    }
    render();
  });
  // Enter/Espaço nos ícones (.icon-btn) vem do components/clickable-a11y.js
  container.addEventListener("click", aoClicar);
  ouvirMudanca = (e) => {
    if (e.detail?.origem !== "tela") recarregar();
  };
  window.addEventListener("kami:habitos-mudaram", ouvirMudanca);

  await recarregar();

  const focoId = consumePendingFocus("habito");
  if (focoId) focusRow(containerEl?.querySelector(`.hb-card[data-habito-id="${focoId}"]`), "habito");

  maybeStartHabitosTips();
  unsubscribeProfile = store.subscribe("profile", () => maybeStartHabitosTips());
  currentReplayFn = () => replayHabitosTips();
  registerScreenTipsReplay(currentReplayFn);
}

export function unmount() {
  cancelActiveTipSequence();
  clearScreenShortcuts(shortcutsToken);
  shortcutsToken = null;
  unsubscribeProfile?.();
  unsubscribeProfile = null;
  if (currentReplayFn) clearScreenTipsReplay(currentReplayFn);
  currentReplayFn = null;
  if (ouvirMudanca) window.removeEventListener("kami:habitos-mudaram", ouvirMudanca);
  ouvirMudanca = null;
  closeHabitoModal();
  containerEl = null;
  habitos = [];
  arquivados = null;
}
