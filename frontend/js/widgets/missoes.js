// js/widgets/missoes.js
import { getMissoes } from "../api/nucleo.js";
import { escapeHtml, fmtData } from "../components/format.js";
import { navigateTo } from "../components/navigate.js";
import { listenWhileConnected } from "../components/window-listener.js";
import { xpBar } from "../components/xp-bar.js";

/**
 * Missões do dia e da semana (GAM-07) — topo do Núcleo. Somente leitura:
 * a missão se conclui sozinha quando a ação acontece no módulo dela
 * (backend/app/missoes.py). Cada linha é um botão que leva à tela onde a
 * missão se cumpre. "[x]"/"[ ]" em texto, barra "[###--]" na semanal,
 * no mesmo estilo de terminal das conquistas. Barra + recompensa ficam
 * num bloco só (.ms-meta) que desce pra uma segunda linha quando o card
 * é estreito, em vez de espremer o título (ver widget-missoes.css).
 *
 * Recarrega a cada `kami:action-registered` (o progress-watcher dispara
 * depois de qualquer escrita que mexeu no progresso — inclusive a que
 * concluiu ou desfez uma missão).
 */

// tela onde cada tipo de missão se cumpre
const SCREEN_BY_TYPE = {
  lancamento: "financas",
  conta_fixa: "financas",
  renda: "financas",
  lancamentos: "financas",
  meta: "metas",
  marco: "aprendizado",
  marco_esquecido: "aprendizado",
  marcos: "aprendizado",
  link: "organizacao",
  habito: "habitos",
  habitos_dias: "habitos",
};

// nome do atributo como aparece na tela (a chave técnica vem sem acento)
const ATTRIBUTE_LABELS = { financas: "finanças", organizacao: "organização" };
const attributeLabel = (name) => ATTRIBUTE_LABELS[name] ?? name;

/** "renova em 5h" / "renova em 40min" — até a meia-noite local. */
export function renewsIn(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const minutes = Math.max(1, Math.ceil((midnight - now) / 60000));
  return minutes >= 60 ? `renova em ${Math.floor(minutes / 60)}h` : `renova em ${minutes}min`;
}

function missionRow(m, { weekly = false } = {}) {
  const screen = SCREEN_BY_TYPE[m.tipo];
  const progress = weekly
    ? `<span class="ms-bar" aria-hidden="true">${xpBar((m.progresso / m.quantidade) * 100, 5)}</span><span class="ms-count">${m.progresso}/${m.quantidade}</span>`
    : "";
  const label = `${m.concluida ? "concluída" : "pendente"}: ${m.titulo}${
    weekly ? `, ${m.progresso} de ${m.quantidade}` : ""
  }, ${attributeLabel(m.atributo)}, +${m.xp_bonus} xp${screen && !m.concluida ? `, abrir ${screen}` : ""}`;
  const tag = screen && !m.concluida ? "button" : "div";
  return `
    <${tag} class="ms-item${m.concluida ? " done" : ""}"${tag === "button" ? ` type="button" data-screen="${screen}"` : ""} aria-label="${escapeHtml(label)}">
      <span class="ms-check" aria-hidden="true">${m.concluida ? "[x]" : "[ ]"}</span>
      <span class="ms-title">${escapeHtml(m.titulo)}</span>
      <span class="ms-meta">${progress}<span class="ms-reward">${escapeHtml(attributeLabel(m.atributo))} · +${m.xp_bonus} xp</span></span>
    </${tag}>`;
}

export async function render(el, widget) {
  el.innerHTML = '<div class="empty-state">carregando missões…</div>';

  async function load() {
    let data;
    try {
      data = await getMissoes();
    } catch (err) {
      el.innerHTML = `<div class="empty-state">erro ao carregar missões: ${escapeHtml(err.message)}</div>`;
      return;
    }

    const daily = data.diarias.length
      ? data.diarias.map((m) => missionRow(m)).join("")
      : '<div class="empty-state">nenhuma missão hoje</div>';
    const doneToday = data.diarias.filter((m) => m.concluida).length;

    el.innerHTML = `
      <div class="missoes">
        <div class="ms-head">
          <span>hoje · ${doneToday}/${data.diarias.length}</span>
          <span class="ms-when">${renewsIn()}</span>
        </div>
        ${daily}
        ${
          data.semanal
            ? `<div class="ms-head ms-head--week">
                 <span>semana</span>
                 <span class="ms-when">até ${fmtData(data.semana_fim)}</span>
               </div>
               ${missionRow(data.semanal, { weekly: true })}`
            : ""
        }
      </div>`;

    el.querySelectorAll("button.ms-item").forEach((btn) =>
      btn.addEventListener("click", () => navigateTo(btn.dataset.screen))
    );
  }

  await load();
  listenWhileConnected(el, "kami:action-registered", load);
}
