import { desmarcarHabito, marcarHabito } from "../api/habitos.js";
import { escapeHtml } from "./format.js";

/**
 * components/habito-linha.js — textos e a linha do "hoje" dos hábitos
 * (ORG-04), usados pela tela (pages/habitos.js), pelo widget "hábitos de
 * hoje" (widgets/habitos-hoje.js) e pelo modal (modals/habito-modal.js).
 */

export const DIAS_CURTOS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
export const ATRIBUTOS = [
  ["organizacao", "organização"],
  ["aprendizado", "aprendizado"],
  ["metas", "metas"],
  ["financas", "finanças"],
  ["carreira", "carreira"],
];

export function rotuloAtributo(nome) {
  return ATRIBUTOS.find(([v]) => v === nome)?.[1] ?? nome;
}

/** "todo dia" / "seg a sex" / "seg, qua, sex" / "3x por semana". */
export function rotuloFrequencia(h) {
  if (h.frequencia === "semana") return `${h.vezes_semana}x por semana`;
  if (h.frequencia !== "dias") return "todo dia";
  const d = h.dias_semana;
  if (d.length === 7) return "todo dia";
  if (d.join() === "0,1,2,3,4") return "seg a sex";
  if (d.join() === "5,6") return "fim de semana";
  return d.map((i) => DIAS_CURTOS[i]).join(", ");
}

export function rotuloSequencia(h, n = h.sequencia) {
  return h.frequencia === "semana" ? `${n} sem` : `${n}d`;
}

/** Linha do "hoje" (tela e widget). */
export function itemHojeHtml(h) {
  const semana = h.frequencia === "semana" ? `<span class="hb-semana">${h.feitas_na_semana}/${h.vezes_semana} na semana</span>` : "";
  const meta = `<span class="hb-attr">${escapeHtml(rotuloAtributo(h.atributo))} · +${h.xp_por_marca} xp</span>`;
  const seq = `<span class="hb-seq" data-tooltip="sequência">▲ ${rotuloSequencia(h)}</span>`;
  if (!h.vale_hoje) {
    return `
      <div class="hb-item hb-folga" data-habito-id="${h.id}">
        <span class="hb-check" aria-hidden="true"> - </span>
        <span class="hb-nome">${escapeHtml(h.nome)} <span class="hb-freq">· hoje não é dia</span></span>
        ${semana}${meta}${seq}
      </div>`;
  }
  return `
    <button type="button" class="hb-item${h.feito_hoje ? " done" : ""}" data-habito-id="${h.id}" data-marcar
      aria-pressed="${h.feito_hoje}" aria-label="${escapeHtml(`${h.nome}: ${h.feito_hoje ? "feito hoje — clique pra desmarcar" : "marcar como feito hoje"}`)}">
      <span class="hb-check" aria-hidden="true">${h.feito_hoje ? "[x]" : "[ ]"}</span>
      <span class="hb-nome">${escapeHtml(h.nome)}</span>
      ${semana}${meta}${seq}
    </button>`;
}

/** Marca hoje se não está feito, desmarca se está. Devolve o hábito novo. */
export async function alternarHoje(h) {
  return h.feito_hoje ? desmarcarHabito(h.id) : marcarHabito(h.id);
}
