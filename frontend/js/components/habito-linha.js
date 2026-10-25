import { desmarcarHabito, marcarHabito } from "../api/habitos.js";
import { escapeHtml } from "./format.js";
import { nomeAtributo } from "./textos-sistema.js";
import { t } from "../i18n.js";

/**
 * components/habito-linha.js — textos e a linha do "hoje" dos hábitos
 * (ORG-04), usados pela tela (pages/habitos.js), pelo widget "hábitos de
 * hoje" (widgets/habitos-hoje.js) e pelo modal (modals/habito-modal.js).
 */

/** ["seg", "ter", …, "dom"] no idioma atual (0 = segunda). */
export const diasCurtos = () => [0, 1, 2, 3, 4, 5, 6].map((i) => t(`dias.curto.${i}`));
export const ATRIBUTOS = ["organizacao", "aprendizado", "metas", "financas", "carreira"];

export const rotuloAtributo = nomeAtributo;

/** "todo dia" / "seg a sex" / "seg, qua, sex" / "3x por semana". */
export function rotuloFrequencia(h) {
  if (h.frequencia === "semana") return t("habito.freq.semana", { n: h.vezes_semana });
  if (h.frequencia !== "dias") return t("habito.freq.todo_dia");
  const d = h.dias_semana;
  if (d.length === 7) return t("habito.freq.todo_dia");
  if (d.join() === "0,1,2,3,4") return t("habito.freq.seg_sex");
  if (d.join() === "5,6") return t("habito.freq.fim_de_semana");
  const nomes = diasCurtos();
  return d.map((i) => nomes[i]).join(", ");
}

export function rotuloSequencia(h, n = h.sequencia) {
  return h.frequencia === "semana" ? t("habito.seq.semanas", { n }) : t("habito.seq.dias", { n });
}

/** Linha do "hoje" (tela e widget). */
export function itemHojeHtml(h) {
  const semana = h.frequencia === "semana" ? `<span class="hb-semana">${t("habito.na_semana", { feitas: h.feitas_na_semana, total: h.vezes_semana })}</span>` : "";
  const meta = `<span class="hb-attr">${escapeHtml(rotuloAtributo(h.atributo))} · +${h.xp_por_marca} xp</span>`;
  const seq = `<span class="hb-seq" data-tooltip="${t("habito.sequencia")}">▲ ${rotuloSequencia(h)}</span>`;
  if (!h.vale_hoje) {
    return `
      <div class="hb-item hb-folga" data-habito-id="${h.id}">
        <span class="hb-check" aria-hidden="true"> - </span>
        <span class="hb-nome">${escapeHtml(h.nome)} <span class="hb-freq">${t("habito.nao_e_dia")}</span></span>
        ${semana}${meta}${seq}
      </div>`;
  }
  return `
    <button type="button" class="hb-item${h.feito_hoje ? " done" : ""}" data-habito-id="${h.id}" data-marcar
      aria-pressed="${h.feito_hoje}" aria-label="${escapeHtml(t(h.feito_hoje ? "habito.feito_aria" : "habito.marcar_aria", { nome: h.nome }))}">
      <span class="hb-check" aria-hidden="true">${h.feito_hoje ? "[x]" : "[ ]"}</span>
      <span class="hb-nome">${escapeHtml(h.nome)}</span>
      ${semana}${meta}${seq}
    </button>`;
}

/** Marca hoje se não está feito, desmarca se está. Devolve o hábito novo. */
export async function alternarHoje(h) {
  return h.feito_hoje ? desmarcarHabito(h.id) : marcarHabito(h.id);
}
