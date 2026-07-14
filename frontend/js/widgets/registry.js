/**
 * Espelha app/widgets.py (backend) — é o mesmo catálogo fixo,
 * decisão 17. Precisa é ficar em sync manualmente com o backend;
 * o backend é sempre a fonte de verdade pra validação (o frontend
 * só usa isso pra render/clamp otimista antes do round-trip da API
 * e pra montar o popover de "+ adicionar widget").
 *
 * `component` é o caminho do módulo que sabe renderizar aquele
 * widget — carregado sob demanda (import dinâmico) por
 * js/widgets/grid.js, não importado tudo de uma vez aqui.
 */
export const WIDGET_CATALOG = {
  profile: {
    label: "widget de perfil (nome, cor, avatar)",
    screens: ["perfil"],
    removable: false,
    min_span: 3,
    max_span: 6,
    default_span: 4,
    component: "./profile.js",
  },
  attributes: {
    label: "atributos — nível por área",
    screens: ["nucleo", "perfil"],
    removable: true,
    min_span: 2,
    max_span: 6,
    default_span: 2,
    component: "./attributes.js",
  },
  priorities: {
    label: "prioridades da semana",
    screens: ["nucleo"],
    removable: true,
    min_span: 2,
    max_span: 6,
    default_span: 2,
    component: "./priorities.js",
  },
  log: {
    label: "log recente",
    screens: ["nucleo"],
    removable: true,
    min_span: 2,
    max_span: 6,
    default_span: 4,
    component: "./log.js",
  },
  registrar: {
    label: "registrar ação",
    screens: ["nucleo"],
    removable: true,
    min_span: 2,
    max_span: 6,
    default_span: 4,
    component: "./registrar.js",
  },
  achievements: {
    label: "conquistas — galeria",
    screens: ["nucleo", "perfil"],
    removable: true,
    min_span: 2,
    max_span: 6,
    default_span: 4,
    component: "./achievements.js",
  },
  org_notifications: {
    label: "notificações — organização (não lidos)",
    screens: ["nucleo", "perfil"],
    removable: true,
    min_span: 2,
    max_span: 6,
    default_span: 2,
    cross_module: true,
    component: "./org-notifications.js",
  },
};

export function isValidWidgetType(widgetType) {
  return widgetType in WIDGET_CATALOG;
}

export function screensFor(widgetType) {
  return WIDGET_CATALOG[widgetType]?.screens ?? [];
}

/** Widgets do catálogo permitidos numa tela específica (pro popover de "+ adicionar"). */
export function widgetsForScreen(screen) {
  return Object.entries(WIDGET_CATALOG)
    .filter(([, def]) => def.screens.includes(screen))
    .map(([type, def]) => ({ type, ...def }));
}
