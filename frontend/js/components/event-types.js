// js/components/event-types.js
//
// Metadados (label + cor) por tipo de registro — espelha
// app/routers/calendario.py. Fonte única usada tanto pelo Calendário
// (bolinhas/legenda/filtros) quanto pelo destaque de foco genérico
// (pending-focus.js), pra que a cor de uma "assinatura" (por exemplo)
// seja sempre a mesma em qualquer lugar do app que ela apareça.
// Antes essa tabela só existia dentro de pages/calendario.js.

export const TYPE_META = {
  conta_fixa: { label: "conta fixa", color: "var(--text-dim)", icon: "receipt" },
  divida: { label: "dívida", color: "var(--red)", icon: "trending-down" },
  assinatura: { label: "assinatura", color: "var(--amber)", icon: "repeat" },
  parcela: { label: "parcela", color: "var(--text-faint)", icon: "credit-card" },
  meta: { label: "meta", color: "var(--accent)", icon: "target" },
  acao: { label: "ação", color: "var(--accent-dim)", icon: "zap" },
};

export function typeColor(type) {
  return TYPE_META[type]?.color || "var(--accent)";
}

export function typeIcon(type) {
  return TYPE_META[type]?.icon || "circle-help";
}
