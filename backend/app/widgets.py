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
# Montado como composição numa grade de 6 colunas: em cada faixa as
# larguras fecham 6 (4+2, 3+3, 2+2+2), e o que fica lado a lado tem altura
# parecida — o empacotamento (frontend/js/widgets/grid.js, packLayout)
# alinha o resto esticando o desenho. Cada item é (widget, largura em
# sextos, altura em px ou None = pela altura do conteúdo). A ordem importa:
# é a ordem em que os cards são encaixados.
#
# Mudou o padrão? Suba LAYOUT_PADRAO_VERSAO: quem já usa o app vê o aviso
# "o layout padrão melhorou — aplicar?" (P-23, routers/dashboard.py).
LAYOUT_PADRAO_VERSAO = 2
LAYOUT_PADRAO = {
    "nucleo": [
        ("missoes", 6, None),
        ("achievements", 4, 396),   # galeria larga | registrar + prioridades empilhados
        ("registrar", 2, None),
        ("priorities", 2, None),
        ("log", 3, 308),            # log | radar, lado a lado
        ("attributes", 3, 308),
    ],
    "perfil": [
        ("profile", 4, None),       # fixo em 1/1
        ("attributes", 2, None),
        ("achievements", 4, 492),
        ("perfil_atividade", 2, None),
    ],
    "financas": [
        ("financas_resumo", 2, None),           # visão geral: 3 cards de 2/6
        ("financas_grafico_fluxo", 2, None),
        ("financas_grafico_evolucao", 2, None),
        ("financas_registros", 3, 420),         # lançamentos | contas fixas + dívidas
        ("contas_fixas", 3, None),
        ("dividas", 3, None),
        ("carteira", 2, None),                  # contas, renda, assinaturas
        ("financas_renda", 2, None),
        ("financas_assinaturas", 2, None),
        ("financas_grafico_categorias", 2, None),
        ("financas_grafico_limites", 2, None),
        ("compras_parceladas", 2, None),
    ],
    "carreira": [
        ("carreira_posicoes", 3, None),         # linha do tempo | formação + área (o nivelamento alinha)
        ("carreira_formacoes", 3, None),
        ("carreira_perfil", 3, None),
        ("carreira_interesses", 3, None),
        ("carreira_salario", 3, None),
    ],
}


def layout_padrao(screen: str) -> list[dict]:
    return [
        {"widget_type": w, "width": width, "height": height, "config_json": None}
        for w, width, height in LAYOUT_PADRAO.get(screen, [])
    ]
