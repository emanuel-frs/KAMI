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
import datetime
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, new_id, now_iso
from app.routers.wallet import _months_between

router = APIRouter()

MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")
RECURRENCES = {"none", "daily", "weekly", "monthly", "yearly"}


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
    time: Optional[str] = None
    notes: Optional[str] = None
    recurrence: Optional[str] = None
    recurrence_end: Optional[str] = None
    reminder_minutes_before: Optional[int] = None
    color: Optional[str] = None


class EventoIn(BaseModel):
    title: str
    date: str
    time: Optional[str] = None
    notes: Optional[str] = None
    recurrence: str = "none"
    recurrence_end: Optional[str] = None
    reminder_minutes_before: Optional[int] = None
    color: Optional[str] = None


def _validate_evento(payload: EventoIn) -> None:
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="título é obrigatório")
    if not DATE_RE.match(payload.date):
        raise HTTPException(status_code=422, detail="'date' deve ser 'YYYY-MM-DD'")
    if payload.time and not TIME_RE.match(payload.time):
        raise HTTPException(status_code=422, detail="'time' deve ser 'HH:MM'")
    if payload.recurrence not in RECURRENCES:
        raise HTTPException(status_code=422, detail=f"'recurrence' deve ser um de {sorted(RECURRENCES)}")
    if payload.recurrence_end and not DATE_RE.match(payload.recurrence_end):
        raise HTTPException(status_code=422, detail="'recurrence_end' deve ser 'YYYY-MM-DD'")
    if payload.reminder_minutes_before is not None and payload.reminder_minutes_before < 0:
        raise HTTPException(status_code=422, detail="'reminder_minutes_before' não pode ser negativo")


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


def _evento_events(db, year: int, month: int, month_str: str) -> List[dict]:
    """
    Único tipo com tabela própria (calendar_events) — expande recorrência
    ('daily'|'weekly'|'monthly'|'yearly') em ocorrências dentro do mês
    pedido. Cada ocorrência recebe um id `evento:{id}:{data}` (o mês
    sozinho não basta pra ser único aqui, já que 'daily'/'weekly' podem
    gerar várias ocorrências no mesmo mês) — o id real do registro
    continua sendo o 2º pedaço, igual conta_fixa/assinatura já fazem.
    """
    first_day = datetime.date(year, month, 1)
    last_day = datetime.date(year, month, calendar.monthrange(year, month)[1])

    rows = db.execute(
        "SELECT * FROM calendar_events WHERE date <= ? "
        "AND (recurrence_end IS NULL OR recurrence_end >= ?)",
        (last_day.isoformat(), first_day.isoformat()),
    ).fetchall()

    events: List[dict] = []
    for r in rows:
        start = datetime.date.fromisoformat(r["date"])
        end_cap = datetime.date.fromisoformat(r["recurrence_end"]) if r["recurrence_end"] else None
        occurrences: List[datetime.date] = []

        if r["recurrence"] == "none":
            if first_day <= start <= last_day:
                occurrences.append(start)
        elif r["recurrence"] == "daily":
            d = max(start, first_day)
            while d <= last_day and (end_cap is None or d <= end_cap):
                occurrences.append(d)
                d += datetime.timedelta(days=1)
        elif r["recurrence"] == "weekly":
            d = start
            while d < first_day:
                d += datetime.timedelta(days=7)
            while d <= last_day and (end_cap is None or d <= end_cap):
                occurrences.append(d)
                d += datetime.timedelta(days=7)
        elif r["recurrence"] == "monthly":
            months_in = (year - start.year) * 12 + (month - start.month)
            if months_in >= 0:
                day = min(start.day, calendar.monthrange(year, month)[1])
                candidate = datetime.date(year, month, day)
                if end_cap is None or candidate <= end_cap:
                    occurrences.append(candidate)
        elif r["recurrence"] == "yearly":
            if month == start.month and year >= start.year:
                day = min(start.day, calendar.monthrange(year, month)[1])
                candidate = datetime.date(year, month, day)
                if end_cap is None or candidate <= end_cap:
                    occurrences.append(candidate)

        for occ in occurrences:
            events.append({
                "id": f"evento:{r['id']}:{occ.isoformat()}",
                "date": occ.isoformat(),
                "type": "evento",
                "title": r["title"],
                "module": "calendario",
                "amount": None,
                "status": None,
                "time": r["time"],
                "notes": r["notes"],
                "recurrence": r["recurrence"],
                "recurrence_end": r["recurrence_end"],
                "reminder_minutes_before": r["reminder_minutes_before"],
                "color": r["color"],
            })
    return events


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
    events += _evento_events(db, year, mo, month)

    events.sort(key=lambda e: (e["date"], e.get("time") or ""))
    return events


# ==================== CRUD de eventos manuais ====================
# Único tipo do calendário com tabela própria — os demais são só leitura
# (pertencem a outros módulos, ver comentário do topo do arquivo).

@router.post("/events/evento", response_model=dict, status_code=201)
def create_evento(payload: EventoIn, db=Depends(get_db)):
    _validate_evento(payload)
    eid = new_id()
    ts = now_iso()
    db.execute(
        "INSERT INTO calendar_events "
        "(id, title, date, time, notes, recurrence, recurrence_end, reminder_minutes_before, color, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (eid, payload.title.strip(), payload.date, payload.time, payload.notes,
         payload.recurrence, payload.recurrence_end, payload.reminder_minutes_before,
         payload.color, ts, ts),
    )
    db.commit()
    return {"id": eid}


@router.put("/events/evento/{event_id}", response_model=dict)
def update_evento(event_id: str, payload: EventoIn, db=Depends(get_db)):
    _validate_evento(payload)
    existing = db.execute("SELECT id FROM calendar_events WHERE id = ?", (event_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="evento não encontrado")
    db.execute(
        "UPDATE calendar_events SET title=?, date=?, time=?, notes=?, recurrence=?, "
        "recurrence_end=?, reminder_minutes_before=?, color=?, updated_at=? WHERE id=?",
        (payload.title.strip(), payload.date, payload.time, payload.notes, payload.recurrence,
         payload.recurrence_end, payload.reminder_minutes_before, payload.color, now_iso(), event_id),
    )
    db.commit()
    return {"id": event_id}


class EventoDateIn(BaseModel):
    date: str


@router.patch("/events/evento/{event_id}/date", response_model=dict)
def reschedule_evento(event_id: str, payload: EventoDateIn, db=Depends(get_db)):
    """Só a data (drag-and-drop na grade) — sem tocar no resto do evento."""
    if not DATE_RE.match(payload.date):
        raise HTTPException(status_code=422, detail="'date' deve ser 'YYYY-MM-DD'")
    existing = db.execute("SELECT id FROM calendar_events WHERE id = ?", (event_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="evento não encontrado")
    db.execute(
        "UPDATE calendar_events SET date=?, updated_at=? WHERE id=?",
        (payload.date, now_iso(), event_id),
    )
    db.commit()
    return {"id": event_id}


@router.delete("/events/evento/{event_id}", status_code=204)
def delete_evento(event_id: str, db=Depends(get_db)):
    existing = db.execute("SELECT id FROM calendar_events WHERE id = ?", (event_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="evento não encontrado")
    db.execute("DELETE FROM calendar_events WHERE id = ?", (event_id,))
    db.commit()