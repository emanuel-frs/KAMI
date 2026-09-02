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