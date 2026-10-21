"""
Regra de repetição dos lembretes (ORG-05) — funções puras, sem banco.

Um lembrete tem um dia de início (`data`), uma hora (`hora`) e uma
repetição (P-62): 'nao' | 'diario' | 'dias' (dias fixos da semana,
0 = segunda) | 'mensal' (todo mês no dia de `data`; em mês mais curto,
no último dia) | 'anual' (todo ano no dia/mês de `data`; 29/02 vira 28/02
nos anos comuns).

O agendador (routers/lembretes.py) guarda só a PRÓXIMA ocorrência; depois
de disparar, pula pra seguinte a partir de agora — se o app ficou fechado
3 dias, um lembrete diário vira UM aviso "que passou", não três.
"""
import calendar
import datetime
from typing import Iterable, List, Optional, Set

REPETICOES = ("nao", "diario", "dias", "mensal", "anual")
# horizonte da busca da próxima ocorrência (anual cabe com folga)
_HORIZONTE_DIAS = 800


def dias_da_semana(texto: str) -> Set[int]:
    return {int(p) for p in (texto or "").split(",") if p.strip().isdigit() and 0 <= int(p) <= 6}


def _dia_no_mes(ano: int, mes: int, dia: int) -> int:
    return min(dia, calendar.monthrange(ano, mes)[1])


def vale(regra: dict, dia: datetime.date) -> bool:
    """O lembrete tem ocorrência neste dia?"""
    inicio = datetime.date.fromisoformat(regra["data"])
    if dia < inicio:
        return False
    rep = regra["repeticao"]
    if rep == "nao":
        return dia == inicio
    if rep == "diario":
        return True
    if rep == "dias":
        return dia.weekday() in dias_da_semana(regra.get("dias_semana") or "")
    if rep == "mensal":
        return dia.day == _dia_no_mes(dia.year, dia.month, inicio.day)
    if rep == "anual":
        return dia.month == inicio.month and dia.day == _dia_no_mes(dia.year, dia.month, inicio.day)
    return False


def _momento(dia: datetime.date, hora: str) -> datetime.datetime:
    h, m = (int(x) for x in hora.split(":"))
    return datetime.datetime(dia.year, dia.month, dia.day, h, m)


def proxima_desde(regra: dict, momento: datetime.datetime) -> Optional[datetime.datetime]:
    """Primeira ocorrência em `momento` ou depois (None = não há mais)."""
    dia = max(momento.date(), datetime.date.fromisoformat(regra["data"]))
    for _ in range(_HORIZONTE_DIAS):
        if vale(regra, dia):
            quando = _momento(dia, regra["hora"])
            if quando >= momento:
                return quando
        if regra["repeticao"] == "nao" and dia >= datetime.date.fromisoformat(regra["data"]):
            return None
        dia += datetime.timedelta(days=1)
    return None


def ocorrencias(regra: dict, inicio: datetime.date, fim: datetime.date) -> List[datetime.date]:
    """Dias com ocorrência entre inicio e fim (inclusive) — pro calendário."""
    out = []
    dia = max(inicio, datetime.date.fromisoformat(regra["data"]))
    while dia <= fim:
        if vale(regra, dia):
            out.append(dia)
        dia += datetime.timedelta(days=1)
    return out


def iso_minuto(momento: datetime.datetime) -> str:
    return momento.strftime("%Y-%m-%dT%H:%M")


def de_iso(texto: Optional[str]) -> Optional[datetime.datetime]:
    return datetime.datetime.fromisoformat(texto[:16]) if texto else None


def mais_cedo(valores: Iterable[Optional[datetime.datetime]]) -> Optional[datetime.datetime]:
    vs = [v for v in valores if v is not None]
    return min(vs) if vs else None
