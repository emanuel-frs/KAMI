import { t } from "../i18n.js";
// js/components/event-types.js
//
// Metadados (label + cor) por tipo de registro — espelha
// app/routers/calendario.py. Fonte única usada tanto pelo Calendário
// (bolinhas/legenda/filtros) quanto pelo destaque de foco genérico
// (pending-focus.js), pra que a cor de uma "assinatura" (por exemplo)
// seja sempre a mesma em qualquer lugar do app que ela apareça.
// Antes essa tabela só existia dentro de pages/calendario.js.

// 2.1.0: a cor de cada tipo é um token (--cal-<tipo>, tokens.css), que a
// pessoa pode trocar em configurações › aparência › cores
export const typeMeta = () => ({
  conta_fixa: { label: t("event_types.conta_fixa"), color: "var(--cal-conta_fixa)", icon: "receipt" },
  divida: { label: t("event_types.divida"), color: "var(--cal-divida)", icon: "trending-down" },
  assinatura: { label: t("event_types.assinatura"), color: "var(--cal-assinatura)", icon: "repeat" },
  parcela: { label: t("event_types.parcela"), color: "var(--cal-parcela)", icon: "credit-card" },
  meta: { label: t("event_types.meta"), color: "var(--cal-meta)", icon: "target" },
  acao: { label: t("event_types.acao"), color: "var(--cal-acao)", icon: "zap" },
  // único tipo com CRUD próprio (calendar_events) — cor do tipo abaixo,
  // mas cada evento pode sobrescrever via campo `color` (ver
  // modals/calendario-evento-modal.js); a grade/legenda usam a do tipo.
  evento: { label: t("event_types.evento"), color: "var(--cal-evento)", icon: "calendar-days" },
  contrato_fim: { label: t("event_types.fim_de_contrato"), color: "var(--cal-contrato_fim)", icon: "clock" },
  revisao_salarial: { label: t("event_types.revisao_salarial"), color: "var(--cal-revisao_salarial)", icon: "trending-up" },
  lembrete: { label: t("event_types.lembrete"), color: "var(--cal-lembrete)", icon: "bell-ring" }, // ORG-05
});

export function typeColor(type) {
  return typeMeta()[type]?.color || "var(--accent)";
}

// ─── alertas "vencendo em breve" ────────────────────────────────────────
// compartilhado entre pages/calendario.js (badge/modal de alertas) e
// components/calendar-notifications.js (resumo diário de notificação) —
// morava só em calendario.js antes disso.
//
// só entram no alerta os tipos com um estado "em aberto" reconhecível.
// conta_fixa segue o mesmo padrão de instância mensal + status
// pendente/paga que assinatura já tinha (item 1).
export function isPendingAlertEvent(e) {
  switch (e.type) {
    case "divida":
      return e.status !== "paga";
    case "assinatura":
    case "conta_fixa":
      return e.status === "pendente";
    case "meta":
      return e.status !== "concluida";
    case "contrato_fim":
    case "revisao_salarial":
      // sem status próprio (não tem "concluído"/"pago") — a simples
      // presença no calendário dentro da janela de alerta já significa
      // que ainda está por vir, mesmo critério de "evento" abaixo
      return true;
    default:
      return false;
  }
}
