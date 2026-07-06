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
        "max_span": 5,
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
        "min_span": 3,
        "max_span": 6,
        "default_span": 4,
    },
    "registrar": {
        "label": "registrar ação",
        "screens": ["nucleo"],
        "removable": True,
        "min_span": 3,
        "max_span": 6,
        "default_span": 4,
    },
    "achievements": {
        "label": "conquistas — galeria",
        "screens": ["nucleo", "perfil"],
        "removable": True,
        "min_span": 3,
        "max_span": 6,
        "default_span": 4,
    },
    "org_notifications": {
        "label": "notificações — organização (não lidos)",
        "screens": ["nucleo", "perfil"],
        "removable": True,
        "min_span": 2,
        "max_span": 4,
        "default_span": 2,
        "cross_module": True,
    },
}


def is_valid_widget_type(widget_type: str) -> bool:
    return widget_type in WIDGET_CATALOG


def screens_for(widget_type: str):
    return WIDGET_CATALOG.get(widget_type, {}).get("screens", [])
