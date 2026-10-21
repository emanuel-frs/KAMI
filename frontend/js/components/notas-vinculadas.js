/**
 * components/notas-vinculadas.js — "notas (N)" nos itens que uma nota
 * pode vincular (ORG-01, P-35): metas, trilhas, eventos do calendário e
 * posições de carreira.
 *
 * Cada tela pede a contagem uma vez por desenho (contarNotas(tipo) — uma
 * consulta só, {id: n}) e põe o link com linkNotasHtml(). O clique é
 * tratado aqui, num listener só no document (ligado no boot, app.js),
 * pra nenhuma tela precisar saber das notas:
 *   - 1 nota  -> abre a nota na Organização;
 *   - várias  -> abre a aba de notas filtrada por esse item;
 *   - nenhuma -> "+ nota" cria uma nota já vinculada.
 */
import { listNotas, contarNotasPorVinculo } from "../api/notas.js";
import { navigateTo } from "./navigate.js";
import { escapeHtml } from "./format.js";
import { icon } from "./icons.js";

/** {id: quantidade} — falha silenciosa (a tela continua sem o link). */
export async function contarNotas(tipo) {
  try {
    return await contarNotasPorVinculo(tipo);
  } catch {
    return {};
  }
}

export function linkNotasHtml(tipo, id, nome, n = 0) {
  const rotulo = n ? `notas (${n})` : "+ nota";
  const dica = n ? (n === 1 ? "abrir a nota vinculada" : "ver as notas vinculadas") : "criar uma nota vinculada a este item";
  return `<a href="#" class="notas-vinc${n ? " tem" : ""}" data-notas-vinculo="${escapeHtml(tipo)}" data-notas-id="${escapeHtml(id)}" data-notas-nome="${escapeHtml(nome || "")}" data-notas-n="${n}" data-tooltip="${dica}">${icon("pencil", { size: 9 })} ${rotulo}</a>`;
}

async function onClick(e) {
  const a = e.target.closest?.("[data-notas-vinculo]");
  if (!a) return;
  e.preventDefault();
  e.stopPropagation(); // o card por baixo (meta, posição…) não abre a edição
  const vinculo = { tipo: a.dataset.notasVinculo, id: a.dataset.notasId, nome: a.dataset.notasNome };
  const n = Number(a.dataset.notasN) || 0;
  if (!n) {
    navigateTo("organizacao", { tab: "notas", novaNota: { vinculo } });
    return;
  }
  if (n === 1) {
    const [nota] = await listNotas({ vinculo_tipo: vinculo.tipo, vinculo_id: vinculo.id }).catch(() => []);
    if (nota) {
      navigateTo("organizacao", { tab: "notas", notaId: nota.id });
      return;
    }
  }
  navigateTo("organizacao", { tab: "notas", vinculo });
}

let ligado = false;
export function wireNotasVinculadas() {
  if (ligado) return;
  ligado = true;
  // captura: roda antes dos listeners do card (que abririam a edição)
  document.addEventListener("click", onClick, true);
}
