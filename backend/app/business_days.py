"""
Cálculo de dia útil real com o calendário de feriados do país da pessoa
(decisão 06; país desde o I18N-06, P-95) — via `workalendar`, sem
depender de nenhum serviço externo (feriados vêm embutidos na própria
lib, offline).

País sem calendário na workalendar (Índia, por exemplo) ou ano que o
calendário dele não cobre: dia útil = segunda a sexta.
"""
import datetime
import functools
from typing import Optional

from workalendar.america import Brazil
from workalendar.core import Calendar
from workalendar.registry import registry

PAIS_PADRAO = "BR"


class _BrasilAtual(Brazil):
    """A workalendar (sem versão nova desde 2022) não tem o Dia da
    Consciência Negra, feriado nacional desde 2024 (Lei 14.759/2023)."""

    def get_variable_days(self, year):
        dias = super().get_variable_days(year)
        if year >= 2024:
            dias.append((datetime.date(year, 11, 20), "Consciência Negra"))
        return dias


@functools.lru_cache(maxsize=None)
def _calendario(pais: Optional[str]) -> Optional[Calendar]:
    codigo = (pais or "").upper()
    if codigo == "BR":
        return _BrasilAtual()
    classe = registry.get(codigo) if codigo else None
    return classe() if classe else None


def paises_com_feriados() -> list[str]:
    """Códigos ISO (2 letras) com calendário nacional na workalendar."""
    return sorted(c for c in registry.get_calendars() if len(c) == 2)


def eh_dia_util(d: datetime.date, pais: Optional[str] = PAIS_PADRAO) -> bool:
    cal = _calendario(pais)
    if cal is not None:
        try:
            return cal.is_working_day(d)
        except Exception:  # noqa: BLE001 — ano fora do que o calendário cobre
            pass
    return d.weekday() < 5


def nth_business_day_of_month(year: int, month: int, n: int, pais: Optional[str] = PAIS_PADRAO) -> datetime.date:
    """Devolve o n-ésimo dia útil do mês (ex: n=5 -> 5º dia útil)."""
    d = datetime.date(year, month, 1)
    count = 0
    while True:
        if eh_dia_util(d, pais):
            count += 1
            if count == n:
                return d
        d += datetime.timedelta(days=1)


def add_business_days(start: datetime.date, n: int, pais: Optional[str] = PAIS_PADRAO) -> datetime.date:
    """Soma N dias úteis a partir de uma data (não conta a própria data de início)."""
    d = start
    passo = 1 if n >= 0 else -1
    restantes = abs(n)
    while restantes:
        d += datetime.timedelta(days=passo)
        if eh_dia_util(d, pais):
            restantes -= 1
    return d


def months_between(mes_inicio: str, mes_atual: str) -> int:
    """Quantidade de meses entre dois 'YYYY-MM' (pode ser negativo se
    mes_inicio for no futuro em relação a mes_atual)."""
    y1, m1 = (int(x) for x in mes_inicio.split("-"))
    y2, m2 = (int(x) for x in mes_atual.split("-"))
    return (y2 - y1) * 12 + (m2 - m1)
