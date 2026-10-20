"""
Catálogo fixo de widgets (decisão 17).

O usuário escolhe entre os tipos já definidos aqui — nunca cria um
widget customizado do zero. Cada tipo declara em código (não no
banco) seu tamanho mínimo/máximo em sextos da linha e em quais telas
pode aparecer. dashboard_widgets (no banco) só guarda QUAL widget,
ONDE, em QUE ORDEM e com QUE TAMANHO — a definição do tipo vive aqui.
"""

WIDGET_CATALOG = {
    "profile": {
        "label": "widget de perfil (nome, cor, avatar)",
        "screens": ["perfil"],
        "removable": False,   # fixo — decisão 17
        "pinned": True,        # também travado na posição 1/1, não-arrastável
                                # (ver data-pinned em profile.js/card-base.css).
                                # Distinto de "removable": um widget pode ser
                                # obrigatório (removable:False) sem ser pinado
                                # visualmente — ver carreira_perfil abaixo.
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "attributes": {
        "label": "atributos — nível por área",
        "screens": ["nucleo", "perfil"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 2,
    },
    "missoes": {
        "label": "missões — do dia e da semana",
        "screens": ["nucleo"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 6,
    },
    "priorities": {
        "label": "prioridades da semana",
        "screens": ["nucleo"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 2,
    },
    "log": {
        "label": "log recente",
        "screens": ["nucleo"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "registrar": {
        "label": "registrar ação",
        "screens": ["nucleo"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "achievements": {
        "label": "conquistas — galeria",
        "screens": ["nucleo", "perfil"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "perfil_atividade": {
        "label": "atividade — últimos meses",
        "screens": ["perfil"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 3,
    },
    "carteira": {
        "label": "wallet — bancos e contas",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "financas_resumo": {
        "label": "resumo financeiro",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 4,
        "default_span": 2,
    },
    "financas_renda": {
        "label": "renda recorrente",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 4,
        "default_span": 2,
    },
    "financas_registros": {
        "label": "registros financeiros",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "financas_assinaturas": {
        "label": "assinaturas",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 4,
        "default_span": 3,
    },
    "dividas": {
        "label": "dívidas",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 4,
        "default_span": 2,
    },
    "contas_fixas": {
        "label": "contas fixas",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 4,
        "default_span": 2,
    },
    "compras_parceladas": {
        "label": "compras parceladas",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 4,
        "default_span": 3,
    },
    "financas_grafico_fluxo": {
        "label": "gráfico — entradas vs saídas",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "financas_grafico_categorias": {
        "label": "gráfico — gastos por categoria",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 4,
        "default_span": 3,
    },
    "financas_grafico_evolucao": {
        "label": "gráfico — evolução do saldo",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "financas_grafico_limites": {
        "label": "gráfico — uso de limite",
        "screens": ["financas"],
        "removable": True,
        "min_span": 1,
        "max_span": 4,
        "default_span": 3,
    },
    "carreira_perfil": {
        "label": "área atual e área-meta",
        "screens": ["carreira"],
        "removable": False,
        "pinned": False,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "carreira_interesses": {
        "label": "interesses profissionais",
        "screens": ["carreira"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 2,
    },
    "carreira_posicoes": {
        "label": "linha do tempo de posições",
        "screens": ["carreira"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "carreira_formacoes": {
        "label": "formação acadêmica",
        "screens": ["carreira"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
    "carreira_salario": {
        "label": "evolução salarial",
        "screens": ["carreira"],
        "removable": True,
        "min_span": 1,
        "max_span": 6,
        "default_span": 4,
    },
}


def is_valid_widget_type(widget_type: str) -> bool:
    return widget_type in WIDGET_CATALOG


def screens_for(widget_type: str):
    return WIDGET_CATALOG.get(widget_type, {}).get("screens", [])

# ── layout padrão por tela (LAY-02) ─────────────────────────────────────
#
# Montado pra cada widget ficar no tamanho em que ele fica bonito, com
# vizinhos de altura parecida lado a lado — o empacotamento
# (frontend/js/widgets/grid.js, packLayout) só sobe os cards pros vãos,
# nunca estica nenhum. Vale pras duas grades mais comuns: 6 colunas
# (≥1400px de área útil, ex.: 1920) e 4 colunas (ex.: 1366), onde 2/6 vira
# 1 coluna, 3/6 vira 2 e 4/6 vira 3. Cada item é (widget, largura em
# sextos, altura em px ou None = pela altura do conteúdo). A ordem importa:
# é a ordem em que os cards são encaixados.
#
# Mudou o padrão? Suba LAYOUT_PADRAO_VERSAO: quem já usa o app vê o aviso
# "o layout padrão melhorou — aplicar?" (P-23, routers/dashboard.py).
# v3: sem widgets esticados pra tapar buraco (a v2 esticava).
LAYOUT_PADRAO_VERSAO = 3
LAYOUT_PADRAO = {
    "nucleo": [
        ("missoes", 3, None),       # missões | registrar
        ("registrar", 3, None),
        ("achievements", 4, None),  # galeria | prioridades + radar empilhados
        ("priorities", 2, None),
        ("attributes", 2, None),
        ("log", 6, None),
    ],
    "perfil": [
        ("profile", 3, None),       # fixo em 1/1; embaixo dele radar + atividade
        ("achievements", 3, 548),   # galeria alta, até perto da base da coluna da esquerda
        ("attributes", 1, None),
        ("perfil_atividade", 2, None),
    ],
    "financas": [
        ("financas_resumo", 2, None),           # visão geral (+ uso de limite na 4ª coluna em 1366)
        ("financas_grafico_fluxo", 2, None),
        ("financas_grafico_evolucao", 2, None),
        ("financas_grafico_limites", 2, None),
        ("financas_registros", 4, None),        # lançamentos | contas fixas + dívidas
        ("contas_fixas", 2, None),
        ("dividas", 2, None),
        ("carteira", 2, None),                  # o resto em colunas de 2/6
        ("financas_renda", 2, None),
        ("financas_assinaturas", 2, None),
        ("compras_parceladas", 2, None),
        ("financas_grafico_categorias", 2, None),
    ],
    "carreira": [
        ("carreira_perfil", 3, None),           # área | interesses (os dois baixos)
        ("carreira_interesses", 3, None),
        ("carreira_posicoes", 3, None),         # linha do tempo | salário (os dois altos)
        ("carreira_salario", 3, None),
        ("carreira_formacoes", 6, None),
    ],
}


def layout_padrao(screen: str) -> list[dict]:
    return [
        {"widget_type": w, "width": width, "height": height, "config_json": None}
        for w, width, height in LAYOUT_PADRAO.get(screen, [])
    ]
