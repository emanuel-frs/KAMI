"""
Módulo Dashboard — layout de widgets configuráveis (decisão 17).

Persiste o layout (quais widgets, ordem, largura) das telas com dashboard
configurável — hoje 'perfil', 'nucleo', 'financas' e 'carreira' (ver
KNOWN_SCREENS logo abaixo; ao adicionar uma tela nova, essa lista é a
única coisa que precisa mudar aqui). Widgets não-removíveis do catálogo
(ex: 'profile') fazem
parte da tabela como qualquer outro — só não podem ser omitidos de
um replace de layout, já que o usuário não pode removê-los pela UI.

Estratégia de persistência: replace-completo por tela. Cada mudança
de layout no frontend (reordenar, redimensionar, adicionar, remover)
manda o array inteiro de uma vez via PUT — evita sincronizar
posição/estado em várias chamadas incrementais.

Endpoints:
  GET  /api/dashboard/novidade        o layout padrão mudou desde a última
                                      vez? quais telas estão diferentes (P-23)
  POST /api/dashboard/novidade        aplica o padrão novo nessas telas (e
                                      devolve os layouts anteriores, pro
                                      desfazer) ou só dispensa o aviso
  GET  /api/dashboard/{screen}/padrao o layout padrão da tela (LAY-05 e o
                                      tamanho de um widget readicionado)
  GET  /api/dashboard/{screen}        devolve o layout salvo (lista ordenada)
  PUT  /api/dashboard/{screen}        substitui o layout inteiro daquela tela
"""
from typing import ClassVar, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id
from app.widgets import LAYOUT_PADRAO_VERSAO, WIDGET_CATALOG, is_valid_widget_type, layout_padrao, screens_for
from app.limites import Entrada, SAIDA_CONFIG

router = APIRouter()

# telas conhecidas do sistema — usadas só pra validar o parâmetro de rota;
# a permissão real de "widget X pode estar na tela Y" vem de screens_for().
# 'carreira' entra aqui na parte 1 do módulo (fundação da tela) — sem
# isso, GET/PUT /api/dashboard/carreira (chamado por createDashboardPage,
# ver pages/carreira.js) sempre devolveria 422 e a tela nunca carregaria.
KNOWN_SCREENS = {"perfil", "nucleo", "financas", "carreira"}


class DashboardWidgetIn(Entrada):
    widget_type: str
    width: int = Field(..., ge=1, le=6)
    height: Optional[int] = None
    config_json: Optional[str] = None


class DashboardWidgetOut(DashboardWidgetIn):
    model_config = SAIDA_CONFIG  # resposta: sem os limites de entrada (app/limites.py)
    sem_limites_de_entrada: ClassVar[bool] = True
    id: str
    screen: str
    position: int


class DashboardLayoutIn(Entrada):
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


# ── layout padrão e aviso de layout novo (LAY-02/05, P-23) ──────────────

class NovidadeIn(Entrada):
    aplicar: bool


def _versao_vista(db) -> int:
    row = db.execute("SELECT valor FROM sistema_info WHERE chave = 'layout_padrao_versao'").fetchone()
    try:
        return int(row["valor"]) if row else 1  # sem registro = de antes da 1.12
    except (TypeError, ValueError):
        return 1


def _marcar_vista(db) -> None:
    db.execute(
        "INSERT INTO sistema_info (chave, valor) VALUES ('layout_padrao_versao', ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (str(LAYOUT_PADRAO_VERSAO),),
    )


def _layout_atual(db, screen: str) -> list[dict]:
    rows = db.execute(
        "SELECT widget_type, width, height, config_json FROM dashboard_widgets WHERE screen = ? ORDER BY position",
        (screen,),
    ).fetchall()
    return [dict(r) for r in rows]


def _gravar(db, screen: str, widgets: list[dict]) -> None:
    db.execute("DELETE FROM dashboard_widgets WHERE screen = ?", (screen,))
    for position, w in enumerate(widgets):
        db.execute(
            "INSERT INTO dashboard_widgets (id, screen, widget_type, position, width, height, config_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (new_id(), screen, w["widget_type"], position, w["width"], w.get("height"), w.get("config_json")),
        )


def _telas_diferentes(db) -> list[str]:
    def chave(ws):
        return [(w["widget_type"], w["width"], w["height"]) for w in ws]

    return sorted(s for s in KNOWN_SCREENS if chave(_layout_atual(db, s)) != chave(layout_padrao(s)))


@router.get("/novidade")
def get_novidade(db=Depends(get_db)):
    if _versao_vista(db) >= LAYOUT_PADRAO_VERSAO:
        return {"versao": LAYOUT_PADRAO_VERSAO, "telas": []}
    return {"versao": LAYOUT_PADRAO_VERSAO, "telas": _telas_diferentes(db)}


@router.post("/novidade")
def post_novidade(payload: NovidadeIn, db=Depends(get_db)):
    """
    aplicar=True: troca as telas diferentes pelo padrão novo e devolve os
    layouts de antes em `anteriores` — o frontend guarda e, no "desfazer",
    manda cada um de volta pelo PUT de sempre. aplicar=False: só não
    pergunta mais. Nos dois casos o aviso não volta pra esta versão.
    """
    anteriores = {}
    if payload.aplicar:
        for screen in _telas_diferentes(db):
            anteriores[screen] = _layout_atual(db, screen)
            _gravar(db, screen, layout_padrao(screen))
    _marcar_vista(db)
    db.commit()
    return {"aplicadas": sorted(anteriores), "anteriores": anteriores}


@router.get("/{screen}/padrao")
def get_layout_padrao(screen: str):
    _validate_screen(screen)
    return layout_padrao(screen)


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