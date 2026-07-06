"""
Módulo Dashboard — layout de widgets configuráveis (decisão 17).

Persiste o layout (quais widgets, ordem, largura) das telas 'perfil'
e 'nucleo'. Widgets não-removíveis do catálogo (ex: 'profile') fazem
parte da tabela como qualquer outro — só não podem ser omitidos de
um replace de layout, já que o usuário não pode removê-los pela UI.

Estratégia de persistência: replace-completo por tela. Cada mudança
de layout no frontend (reordenar, redimensionar, adicionar, remover)
manda o array inteiro de uma vez via PUT — evita sincronizar
posição/estado em várias chamadas incrementais.

Endpoints:
  GET /api/dashboard/{screen}   devolve o layout salvo (lista ordenada)
  PUT /api/dashboard/{screen}   substitui o layout inteiro daquela tela
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id
from app.widgets import WIDGET_CATALOG, is_valid_widget_type, screens_for

router = APIRouter()

# telas conhecidas do sistema — usadas só pra validar o parâmetro de rota;
# a permissão real de "widget X pode estar na tela Y" vem de screens_for()
KNOWN_SCREENS = {"perfil", "nucleo"}


class DashboardWidgetIn(BaseModel):
    widget_type: str
    width: int = Field(..., ge=1, le=6)
    height: Optional[int] = None
    config_json: Optional[str] = None


class DashboardWidgetOut(DashboardWidgetIn):
    id: str
    screen: str
    position: int


class DashboardLayoutIn(BaseModel):
    widgets: List[DashboardWidgetIn]


def _validate_screen(screen: str) -> None:
    if screen not in KNOWN_SCREENS:
        raise HTTPException(
            status_code=422,
            detail=f"screen inválida; valores aceitos: {sorted(KNOWN_SCREENS)}",
        )


def _validate_widget_for_screen(item: DashboardWidgetIn, screen: str) -> None:
    if not is_valid_widget_type(item.widget_type):
        raise HTTPException(
            status_code=422,
            detail=f"widget_type inválido: '{item.widget_type}'; não está no catálogo fixo",
        )
    if screen not in screens_for(item.widget_type):
        raise HTTPException(
            status_code=422,
            detail=f"widget '{item.widget_type}' não é permitido na tela '{screen}'",
        )
    catalog_entry = WIDGET_CATALOG[item.widget_type]
    min_span = catalog_entry["min_span"]
    max_span = catalog_entry["max_span"]
    if not (min_span <= item.width <= max_span):
        raise HTTPException(
            status_code=422,
            detail=(
                f"width inválido para '{item.widget_type}': {item.width} "
                f"(aceito entre {min_span} e {max_span})"
            ),
        )


def _validate_non_removable_present(payload_types: set, screen: str) -> None:
    """Widgets com removable=False no catálogo não podem sumir de um replace."""
    required = {
        widget_type
        for widget_type, entry in WIDGET_CATALOG.items()
        if not entry.get("removable", True) and screen in entry["screens"]
    }
    missing = required - payload_types
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"widget(s) obrigatório(s) ausente(s) do layout: {sorted(missing)}",
        )


@router.get("/{screen}", response_model=List[DashboardWidgetOut])
def get_layout(screen: str, db=Depends(get_db)):
    _validate_screen(screen)
    rows = db.execute(
        "SELECT * FROM dashboard_widgets WHERE screen = ? ORDER BY position",
        (screen,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.put("/{screen}", response_model=List[DashboardWidgetOut])
def replace_layout(screen: str, payload: DashboardLayoutIn, db=Depends(get_db)):
    _validate_screen(screen)
    for item in payload.widgets:
        _validate_widget_for_screen(item, screen)

    payload_types = {item.widget_type for item in payload.widgets}
    _validate_non_removable_present(payload_types, screen)

    db.execute("DELETE FROM dashboard_widgets WHERE screen = ?", (screen,))
    for position, item in enumerate(payload.widgets):
        db.execute(
            "INSERT INTO dashboard_widgets (id, screen, widget_type, position, width, height, config_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (new_id(), screen, item.widget_type, position, item.width, item.height, item.config_json),
        )
    db.commit()

    rows = db.execute(
        "SELECT * FROM dashboard_widgets WHERE screen = ? ORDER BY position",
        (screen,),
    ).fetchall()
    return [dict(r) for r in rows]