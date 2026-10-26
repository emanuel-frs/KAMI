"""
Constantes, validação de mês, schemas e helpers usados por mais de uma
parte de Finanças.

Parte do módulo Finanças (routers/financas/__init__.py junta as partes
num router só, montado em /api/financas). MAN-02.
"""
import re

from pydantic import BaseModel

from app.actions import revert_actions
from app.mensagens import ErroKami


# XP de Finanças (balanceamento da etapa 2 da gamificação): lançar uma
# transação é rápido e acontece várias vezes por semana; pagar uma conta
# fixa/receber uma renda acontece no máximo 1x por período e é o hábito
# de "manter em dia", por isso vale um pouco mais.
XP_TRANSACAO = 3
XP_PAGAMENTO_RECORRENTE = 4

MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _validate_month(month: str) -> tuple:
    if not MONTH_RE.match(month):
        raise ErroKami(422, "erro.comum.parametro_month_deve_ser_yyyy", "parâmetro 'month' deve ser 'YYYY-MM'")
    year, mo = month.split("-")
    return int(year), int(mo)


def _prev_month(year: int, month: int) -> tuple:
    if month == 1:
        return year - 1, 12
    return year, month - 1


class CategoryTotal(BaseModel):
    category: str
    total: float


def _revert_period_xp(db, referencia_tipo: str, table: str, parent_col: str, parent_id: str) -> None:
    """Estorna o xp de cada período/ocorrência de um cadastro recorrente que vai ser apagado."""
    for row in db.execute(f"SELECT id FROM {table} WHERE {parent_col} = ?", (parent_id,)).fetchall():
        revert_actions(db, referencia_tipo, row["id"])
