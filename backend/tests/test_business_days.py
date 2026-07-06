"""
Testes de app/business_days.py.

Em vez de hardcodar datas específicas de feriado (frágil e fácil de errar
o cálculo manualmente), os testes validam a *propriedade* esperada do
resultado cruzando com o próprio `workalendar.america.Brazil` — a mesma
lib usada pela implementação, mas usada aqui de forma independente pra
contar dias úteis "na mão" e comparar.
"""
import datetime

from workalendar.america import Brazil

from app.business_days import add_business_days, nth_business_day_of_month

_cal = Brazil()


def _count_working_days_up_to(year: int, month: int, day: int) -> int:
    """Conta quantos dias úteis existem de dia 1 até `day` (inclusive) no mês."""
    count = 0
    d = datetime.date(year, month, 1)
    while d.day <= day:
        if _cal.is_working_day(d):
            count += 1
        d += datetime.timedelta(days=1)
    return count


def test_nth_business_day_is_actually_a_working_day():
    result = nth_business_day_of_month(2026, 3, 5)
    assert _cal.is_working_day(result)
    assert result.month == 3
    assert result.year == 2026


def test_nth_business_day_is_the_correct_ordinal():
    for n in (1, 3, 5, 10):
        result = nth_business_day_of_month(2026, 7, n)
        assert _count_working_days_up_to(2026, 7, result.day) == n


def test_nth_business_day_across_multiple_months_is_consistent():
    # roda pra alguns meses distintos garantindo que sempre bate com a
    # contagem independente, incluindo meses com feriados variados
    for month in (1, 2, 4, 6, 9, 12):
        result = nth_business_day_of_month(2026, month, 5)
        assert _count_working_days_up_to(2026, month, result.day) == 5


def test_add_business_days_lands_on_working_day():
    start = datetime.date(2026, 3, 2)  # segunda-feira
    result = add_business_days(start, 15)
    assert _cal.is_working_day(result)
    assert result > start


def test_add_business_days_matches_independent_count():
    start = datetime.date(2026, 5, 4)
    n = 15
    result = add_business_days(start, n)

    # conta manualmente n dias úteis a partir do dia seguinte a start
    d = start
    counted = 0
    while counted < n:
        d += datetime.timedelta(days=1)
        if _cal.is_working_day(d):
            counted += 1
    assert result == d


def test_add_business_days_zero_returns_same_or_next_logic():
    start = datetime.date(2026, 3, 2)
    result = add_business_days(start, 0)
    # comportamento definido pela lib; só garantimos que não quebra e
    # não retrocede antes da data de início
    assert result >= start
