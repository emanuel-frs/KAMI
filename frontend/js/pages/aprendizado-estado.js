/**
 * Estado da tela de aprendizado compartilhado entre as partes (MAN-02):
 * trilhas e módulos carregados, trilha selecionada, edição em andamento
 * e focos pendentes. Objeto, e não `let` exportado, porque várias partes
 * alteram esses valores.
 */
export const estado = {
  // ─── estado ────────────────────────────────────────────────────────────────
  containerEl: null,
  tracks: [],
  milestones: [],
  selectedTrackId: null,
  // Foco por teclado: as listas são redesenhadas via innerHTML a cada
  // mudança (selecionar, reordenar, marcar módulo...), o que derruba o foco
  // pro <body>. Estas variáveis guardam "quem tinha o foco" entre o
  // desenho antigo e o novo, e o render devolve o foco no elemento
  // equivalente.
  pendingTrackFocusId: null,
  pendingRoadmapFocus: null,  // { kind: "ms-checkbox" | "roadmap-title" | "roadmap-expand-btn", id }
  editingTrack: false,
  currentMilestoneId: null,
  selectedNodeId: null,
  expandedMilestoneId: null,
  heatmapEntries: null,
  heatmapResizeObserver: null,
  heatmapResizeTimer: null,
};
