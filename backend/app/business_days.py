"""
Cálculo de dia útil real usando calendário nacional brasileiro
(decisão 06) — via `workalendar`, sem depender de nenhum serviço
externo (feriados vêm embutidos na própria lib, offline).
"""
import datetime

from workalendar.america import Brazil

_calendar = Brazil()


def nth_business_day_of_month(year: int, month: int, n: int) -> datetime.date:
    """Devolve o n-ésimo dia útil do mês (ex: n=5 -> 5º dia útil)."""
    d = datetime.date(year, month, 1)
    count = 0
    while True:
        if _calendar.is_working_day(d):
            count += 1
            if count == n:
                return d
        d += datetime.timedelta(days=1)


def add_business_days(start: datetime.date, n: int) -> datetime.date:
    """Soma N dias úteis a partir de uma data (não conta a própria data de início)."""
    return _calendar.add_working_days(start, n)


def months_between(mes_inicio: str, mes_atual: str) -> int:
    """Quantidade de meses entre dois 'YYYY-MM' (pode ser negativo se
    mes_inicio for no futuro em relação a mes_atual)."""
    y1, m1 = (int(x) for x in mes_inicio.split("-"))
    y2, m2 = (int(x) for x in mes_atual.split("-"))
    return (y2 - y1) * 12 + (m2 - m1)
