"""
Módulo Widgets — expõe o catálogo fixo de widgets (app/widgets.py) pra
quem consome a API (ALINHAMENTO.md 2.6).

Endpoints:
  GET /api/widgets/catalog   devolve o WIDGET_CATALOG inteiro

Antes desse endpoint, o catálogo vivia duplicado à mão em dois lugares
(app/widgets.py no backend, frontend/js/widgets/registry.js no
frontend) — o comentário do arquivo do frontend até admitia isso
("precisa ficar em sync manualmente com o backend"). Esse endpoint
elimina a metade dos dados que é só configuração (label/screens/
min_span/max_span/default_span/removable/cross_module); o `component`
(caminho do módulo JS que sabe renderizar cada widget) continua só no
frontend por natureza — não é algo que o backend tem como saber, e
`grid.js` carrega isso via import dinâmico, não por essa API.
"""
from fastapi import APIRouter

from app.widgets import WIDGET_CATALOG

router = APIRouter()


@router.get("/catalog")
def get_widget_catalog():
    return WIDGET_CATALOG