/**
 * Catálogo de widgets (decisão 17).
 *
 * Até aqui isso era uma cópia manual de app/widgets.py (backend), com
 * o comentário admitindo "precisa ficar em sync manualmente com o
 * backend". Agora os dados (label/screens/min_span/max_span/
 * default_span/removable/cross_module) vêm de GET /api/widgets/catalog
 * — o backend continua sendo a única fonte de verdade, inclusive pra
 * validação (esse endpoint só espelha o que o backend já valida).
 *
 * `component` continua só aqui: é o caminho do módulo JS que sabe
 * renderizar cada widget, carregado sob demanda (import dinâmico) por
 * js/widgets/grid.js — não é algo que o backend tem como saber, então
 * não faz sentido esse pedaço vir da API.
 *
 * WIDGET_CATALOG é exportado como o MESMO objeto sempre (nunca
 * reatribuído) — loadWidgetCatalog() só preenche as chaves dele in
 * place. Isso significa que quem importa `{ WIDGET_CATALOG }` (grid.js,
 * dashboard.js) não precisa mudar nada: o binding do ES module já
 * aponta pro objeto certo, só precisa estar vazio na primeira leitura
 * síncrona (por isso createDashboardPage.mount() dá `await
 * loadWidgetCatalog()` antes de qualquer coisa usar o catálogo).
 */
import { getCatalog } from "../api/widgets.js";

const COMPONENT_PATHS = {
  profile: "./profile.js",
  attributes: "./attributes.js",
  priorities: "./priorities.js",
  log: "./log.js",
  registrar: "./registrar.js",
  achievements: "./achievements.js",
  carteira: "./carteira.js",
  financas_resumo: "./financas-resumo.js",
  financas_renda: "./financas-renda.js",
  financas_registros: "./financas-registros.js",
  financas_assinaturas: "./financas-assinaturas.js",
  dividas: "./dividas.js",
  contas_fixas: "./contas-fixas.js",
  compras_parceladas: "./compras-parceladas.js",
  financas_grafico_fluxo: "../charts/financas-grafico-fluxo.js",
  financas_grafico_categorias: "../charts/financas-grafico-categorias.js",
  financas_grafico_evolucao: "../charts/financas-grafico-evolucao.js",
  financas_grafico_limites: "../charts/financas-grafico-limites.js",
  carreira_perfil: "./carreira-perfil.js",
  carreira_interesses: "./carreira-interesses.js",
  carreira_posicoes: "./carreira-posicoes.js",
  carreira_formacoes: "./carreira-formacoes.js",
  carreira_salario: "./carreira-salario.js",
};

export const WIDGET_CATALOG = {};

let _loadPromise = null;

/**
 * Busca o catálogo uma única vez por sessão (cacheado) e popula
 * WIDGET_CATALOG in place. Chamadas subsequentes (ex: navegar entre
 * perfil/núcleo/finanças, que compartilham createDashboardPage)
 * reaproveitam a mesma promise em vez de refazer a requisição.
 */
export function loadWidgetCatalog() {
  if (!_loadPromise) {
    _loadPromise = getCatalog().then((backendCatalog) => {
      for (const [type, def] of Object.entries(backendCatalog)) {
        WIDGET_CATALOG[type] = { ...def, component: COMPONENT_PATHS[type] };
      }
      return WIDGET_CATALOG;
    });
  }
  return _loadPromise;
}

/** Widgets do catálogo permitidos numa tela específica (pro popover de "+ adicionar"). */
export function widgetsForScreen(screen) {
  return Object.entries(WIDGET_CATALOG)
    .filter(([, def]) => def.screens.includes(screen))
    .map(([type, def]) => ({ type, ...def }));
}