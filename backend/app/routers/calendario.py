"""
Módulo Calendário (v1).

Endpoint único, read-only, agregador de eventos de outros módulos:

  GET /events?month=YYYY-MM

Cada evento vem de uma fonte diferente, sem tabela própria:
  - conta_fixa        fixed_bills/fixed_bill_periods (financas) — due_day
                       clamped ao fim do mês, status pendente/paga (mesmo
                       padrão de assinatura, ver item 1 do mapa de problemas)
  - divida            debts (financas)             — só se due_date cai no mês
  - assinatura        wallet_subscriptions/periods  — status pendente/paga
  - parcela           compras_parceladas           — só durante a janela de parcelas
  - meta              goals                         — só se tiver deadline no mês
  - acao              action_logs (núcleo)          — uma entrada por ação registrada

(renda/salário deliberadamente fora daqui — ideia melhor pra isso ainda
não implementada, ver conversa; income_entries/income_sources têm widget
próprio em Finanças (financas_renda), só não entram no calendário por
enquanto)

A ordem final é por data.
"""
import calendar
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db
from app.routers.wallet import _months_between

router = APIRouter()

MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _validate_month(month: str) -> tuple:
    if not MONTH_RE.match(month):
        raise HTTPException(status_code=422, detail="parâmetro 'month' deve ser 'YYYY-MM'")
    year, mo = month.split("-")
    return int(year), int(mo)


class CalendarEvent(BaseModel):
    id: str
    date: str
    type: str
    title: str
    module: str
    amount: Optional[float] = None
    status: Optional[str] = None
    xp: Optional[int] = None
    categories: Optional[List[str]] = None


# ==================== fontes de evento ====================

def _acao_events(db, month_str: str) -> List[dict]:
    rows = db.execute(
        "SELECT * FROM action_logs WHERE substr(created_at,1,7) = ? ORDER BY created_at",
        (month_str,),
    ).fetchall()
    events = []
    for r in rows:
        categories = [
            row["name"]
            for row in db.execute(
                "SELECT a.name FROM action_log_attributes ala "
                "JOIN attributes a ON a.id = ala.attribute_id "
                "WHERE ala.action_log_id = ?",
                (r["id"],),
            ).fetchall()
        ]
        events.append({
            "id": f"acao:{r['id']}",
            "date": r["created_at"][:10],
            "type": "acao",
            "title": r["description"],
            "module": "nucleo",
            "amount": None,
            "status": None,
            "xp": r["xp_gained"],
            "categories": categories,
        })
    return events


def _conta_fixa_events(db, year: int, month: int, month_str: str) -> List[dict]:
    rows = db.execute("SELECT * FROM fixed_bills WHERE active = 1").fetchall()
    last_day = calendar.monthrange(year, month)[1]
    events = []
    for r in rows:
        existing = db.execute(
            "SELECT * FROM fixed_bill_periods WHERE fixed_bill_id = ? AND mes_ano = ?",
            (r["id"], month_str),
        ).fetchone()
        if not existing:
            from app.database import new_id
            db.execute(
                "INSERT INTO fixed_bill_periods (id, fixed_bill_id, mes_ano, paga, valor_pago) "
                "VALUES (?, ?, ?, 0, NULL)",
                (new_id(), r["id"], month_str),
            )
            db.commit()
            existing = db.execute(
                "SELECT * FROM fixed_bill_periods WHERE fixed_bill_id = ? AND mes_ano = ?",
                (r["id"], month_str),
            ).fetchone()
        day = min(r["due_day"], last_day)
        date = f"{year:04d}-{month:02d}-{day:02d}"
        paga = bool(existing["paga"])
        amount = existing["valor_pago"] if paga and existing["valor_pago"] is not None else r["amount"]
        events.append({
            "id": f"conta_fixa:{r['id']}:{month_str}",
            "date": date,
            "type": "conta_fixa",
            "title": r["name"],
            "module": "financas",
            "amount": amount,
            "status": "paga" if paga else "pendente",
        })
    return events


def _divida_events(db, month_str: str) -> List[dict]:
    rows = db.execute(
        "SELECT * FROM debts WHERE due_date IS NOT NULL AND substr(due_date,1,7) = ?",
        (month_str,),
    ).fetchall()
    return [
        {
            "id": f"divida:{r['id']}",
            "date": r["due_date"],
            "type": "divida",
            "title": r["description"],
            "module": "financas",
            "amount": r["amount"],
            "status": r["status"],
        }
        for r in rows
    ]


def _assinatura_events(db, year: int, month: int, month_str: str) -> List[dict]:
    subs = db.execute("SELECT * FROM wallet_subscriptions WHERE active = 1").fetchall()
    last_day = calendar.monthrange(year, month)[1]
    events = []
    for s in subs:
        existing = db.execute(
            "SELECT * FROM wallet_subscription_periods WHERE subscription_id = ? AND mes_ano = ?",
            (s["id"], month_str),
        ).fetchone()
        if not existing:
            from app.database import new_id
            db.execute(
                "INSERT INTO wallet_subscription_periods (id, subscription_id, mes_ano, paga, valor_pago) "
                "VALUES (?, ?, ?, 0, NULL)",
                (new_id(), s["id"], month_str),
            )
            db.commit()
            existing = db.execute(
                "SELECT * FROM wallet_subscription_periods WHERE subscription_id = ? AND mes_ano = ?",
                (s["id"], month_str),
            ).fetchone()
        day = min(s["dia_cobranca"], last_day)
        date = f"{year:04d}-{month:02d}-{day:02d}"
        paga = bool(existing["paga"])
        amount = existing["valor_pago"] if paga and existing["valor_pago"] is not None else s["valor_esperado"]
        events.append({
            "id": f"assinatura:{s['id']}:{month_str}",
            "date": date,
            "type": "assinatura",
            "title": s["nome"],
            "module": "financas",
            "amount": amount,
            "status": "paga" if paga else "pendente",
        })
    return events


def _parcela_events(db, month_str: str) -> List[dict]:
    rows = db.execute("SELECT * FROM compras_parceladas").fetchall()
    events = []
    for r in rows:
        parcela_numero = _months_between(r["mes_primeira_parcela"], month_str) + 1
        if parcela_numero < 1 or parcela_numero > r["num_parcelas"]:
            continue
        valor_parcela = r["valor_total"] / r["num_parcelas"]
        events.append({
            "id": f"parcela:{r['id']}:{month_str}",
            "date": f"{month_str}-01",
            "type": "parcela",
            "title": f"{r['nome']} ({parcela_numero}/{r['num_parcelas']})",
            "module": "financas",
            "amount": valor_parcela,
            "status": None,
        })
    return events


def _meta_events(db, month_str: str) -> List[dict]:
    rows = db.execute(
        "SELECT * FROM goals WHERE deadline IS NOT NULL AND substr(deadline,1,7) = ?",
        (month_str,),
    ).fetchall()
    return [
        {
            "id": f"meta:{r['id']}",
            "date": r["deadline"],
            "type": "meta",
            "title": r["title"],
            "module": "metas",
            "amount": None,
            "status": r["status"],
        }
        for r in rows
    ]


# ==================== endpoint ====================

@router.get("/events", response_model=List[CalendarEvent])
def get_events(month: str, db=Depends(get_db)):
    year, mo = _validate_month(month)

    events: List[dict] = []
    events += _conta_fixa_events(db, year, mo, month)
    events += _divida_events(db, month)
    events += _assinatura_events(db, year, mo, month)
    events += _parcela_events(db, month)
    events += _meta_events(db, month)
    events += _acao_events(db, month)

    events.sort(key=lambda e: e["date"])
    return events