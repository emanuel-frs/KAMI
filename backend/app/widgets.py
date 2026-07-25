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
        "min_span": 3,
        "max_span": 6,
        "default_span": 4,
    },
    "attributes": {
        "label": "atributos — nível por área",
        "screens": ["nucleo", "perfil"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 2,
    },
    "priorities": {
        "label": "prioridades da semana",
        "screens": ["nucleo"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 2,
    },
    "log": {
        "label": "log recente",
        "screens": ["nucleo"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 4,
    },
    "registrar": {
        "label": "registrar ação",
        "screens": ["nucleo"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 4,
    },
    "achievements": {
        "label": "conquistas — galeria",
        "screens": ["nucleo", "perfil"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 4,
    },
    "org_notifications": {
        "label": "notificações — organização (não lidos)",
        "screens": ["nucleo", "perfil"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 2,
        "cross_module": True,
    },
    "wallet": {
        "label": "wallet — bancos e contas",
        "screens": ["financas"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 4,
    },
    "financas_resumo": {
        "label": "resumo financeiro",
        "screens": ["financas"],
        "removable": True,
        "min_span": 2,
        "max_span": 4,
        "default_span": 2,
    },
    "financas_registros": {
        "label": "registros financeiros",
        "screens": ["financas"],
        "removable": True,
        "min_span": 2,
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
        "min_span": 2,
        "max_span": 6,
        "default_span": 4,
    },
    "financas_grafico_categorias": {
        "label": "gráfico — gastos por categoria",
        "screens": ["financas"],
        "removable": True,
        "min_span": 2,
        "max_span": 4,
        "default_span": 3,
    },
    "financas_grafico_evolucao": {
        "label": "gráfico — evolução do saldo",
        "screens": ["financas"],
        "removable": True,
        "min_span": 2,
        "max_span": 6,
        "default_span": 4,
    },
    "financas_grafico_limites": {
        "label": "gráfico — uso de limite",
        "screens": ["financas"],
        "removable": True,
        "min_span": 2,
        "max_span": 4,
        "default_span": 3,
    },
}


def is_valid_widget_type(widget_type: str) -> bool:
    return widget_type in WIDGET_CATALOG


def screens_for(widget_type: str):
    return WIDGET_CATALOG.get(widget_type, {}).get("screens", [])