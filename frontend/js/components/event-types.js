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
  // único tipo com CRUD próprio (calendar_events) — cor default abaixo,
  // mas cada evento pode sobrescrever via campo `color` (ver
  // modals/calendar-event-modal.js); a grade/legenda usam o default.
  evento: { label: "evento", color: "#7fa8d9", icon: "calendar-days" },
};

export function typeColor(type) {
  return TYPE_META[type]?.color || "var(--accent)";
}

export function typeIcon(type) {
  return TYPE_META[type]?.icon || "circle-help";
}

// ─── alertas "vencendo em breve" ────────────────────────────────────────
// compartilhado entre pages/calendario.js (badge/modal de alertas) e
// components/calendar-notifications.js (resumo diário de notificação) —
// morava só em calendario.js antes disso.
//
// só entram no alerta os tipos com um estado "em aberto" reconhecível.
// conta_fixa segue o mesmo padrão de instância mensal + status
// pendente/paga que assinatura já tinha (item 1 do mapa de problemas).
export function isPendingAlertEvent(e) {
  switch (e.type) {
    case "divida":
      return e.status !== "paga";
    case "assinatura":
    case "conta_fixa":
      return e.status === "pendente";
    case "meta":
      return e.status !== "concluida";
    default:
      return false;
  }
}
