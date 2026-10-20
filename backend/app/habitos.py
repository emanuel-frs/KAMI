"""
Regras dos hábitos (ORG-04) — calculadas na leitura, sem estado guardado.

Combinado com o Emanuel em 2026-10-20 (P-42..P-45, P-55..P-60):

  - Frequência: 'diario' (todo dia), 'dias' (dias fixos da semana) ou
    'semana' (X vezes por semana, em qualquer dia).
  - Sequência dos hábitos de dia (diario/dias): dias seguidos cumpridos,
    contando só os dias em que o hábito "valia" — dia fora da programação,
    dia pausado e dia antes de criar o hábito não contam nem quebram. Hoje
    ainda não acabou: hoje sem marca não quebra.
  - Sequência dos hábitos 'semana' (P-57): em SEMANAS cumpridas (pelo
    menos X marcas de segunda a domingo). A semana atual sem as X ainda
    não quebra; semana com pausa que não chegou às X fica neutra.
  - Recorde: a maior sequência da história, pelas mesmas regras.
  - "30 dias": quanto do que valia nos últimos 30 dias foi feito.

Uma marca por hábito por dia (UNIQUE no banco); marcar dá xp no atributo
do hábito (routers/habitos.py) e pode ser feita até DIAS_PARA_TRAS dias
atrás (P-43).
"""
import datetime
from typing import Dict, Iterable, List, Optional, Set

DIAS_PARA_TRAS = 2
SEMANAS_NA_GRADE = 12

FREQUENCIAS = ("diario", "dias", "semana")
STATUS = ("ativo", "pausado", "arquivado")


def semana_inicio(dia: datetime.date) -> datetime.date:
    return dia - datetime.timedelta(days=dia.weekday())


def dias_da_semana(texto: str) -> Set[int]:
    """"0,2,4" -> {0, 2, 4} (0 = segunda). Ignora o que não for 0..6."""
    out = set()
    for p in (texto or "").split(","):
        p = p.strip()
        if p.isdigit() and 0 <= int(p) <= 6:
            out.add(int(p))
    return out


class Habito:
    """Um hábito com as marcas e pausas carregadas — tudo o que as regras
    precisam, sem voltar ao banco."""

    def __init__(self, row, marcas: Iterable[str], pausas: Iterable[tuple]):
        self.row = row
        self.frequencia = row["frequencia"]
        self.dias = dias_da_semana(row["dias_semana"])
        self.vezes = max(1, int(row["vezes_semana"] or 1))
        self.criado = datetime.date.fromisoformat(row["criado_em"][:10])
        self.marcas: Set[datetime.date] = {datetime.date.fromisoformat(d) for d in marcas}
        self.pausas = [
            (datetime.date.fromisoformat(i), datetime.date.fromisoformat(f) if f else None)
            for i, f in pausas
        ]
        # marca anterior à criação (ex.: hábito criado hoje e marcado ontem)
        # puxa o começo pra trás — senão ela não apareceria em lugar nenhum
        if self.marcas:
            self.criado = min(self.criado, min(self.marcas))

    def pausado(self, dia: datetime.date) -> bool:
        return any(i <= dia and (f is None or dia <= f) for i, f in self.pausas)

    def vale(self, dia: datetime.date) -> bool:
        """O hábito "valia" neste dia (dava pra cumprir)? Pros hábitos
        'semana', todo dia vale (a cobrança é por semana)."""
        if dia < self.criado or self.pausado(dia):
            return False
        if self.frequencia == "dias":
            return dia.weekday() in self.dias
        return True

    # ---------------- sequência ----------------

    def _semana_cumprida(self, inicio: datetime.date) -> bool:
        fim = inicio + datetime.timedelta(days=6)
        return sum(1 for d in self.marcas if inicio <= d <= fim) >= self.vezes

    def _semana_neutra(self, inicio: datetime.date, hoje: datetime.date) -> bool:
        """Semana que não conta nem quebra: a atual, a da criação e as que
        tiveram pausa (quando não chegaram às X marcas)."""
        if inicio == semana_inicio(hoje) or inicio == semana_inicio(self.criado):
            return True
        return any(self.pausado(inicio + datetime.timedelta(days=i)) for i in range(7))

    def _passos(self, hoje: datetime.date) -> List[Optional[bool]]:
        """A história em ordem, como True (cumpriu), False (quebrou) ou
        None (neutro) — por dia, ou por semana nos hábitos 'semana'."""
        if self.frequencia == "semana":
            out = []
            s = semana_inicio(self.criado)
            while s <= hoje:
                if self._semana_cumprida(s):
                    out.append(True)
                else:
                    out.append(None if self._semana_neutra(s, hoje) else False)
                s += datetime.timedelta(days=7)
            return out
        out = []
        d = self.criado
        while d <= hoje:
            if d in self.marcas:
                out.append(True)
            elif not self.vale(d) or d == hoje:
                out.append(None)
            else:
                out.append(False)
            d += datetime.timedelta(days=1)
        return out

    def sequencias(self, hoje: datetime.date) -> Dict[str, int]:
        atual = recorde = corrida = 0
        for passo in self._passos(hoje):
            if passo is True:
                corrida += 1
                recorde = max(recorde, corrida)
            elif passo is False:
                corrida = 0
        atual = corrida
        return {"sequencia": atual, "recorde": recorde}

    # ---------------- números da tela ----------------

    def feitas_na_semana(self, hoje: datetime.date) -> int:
        inicio = semana_inicio(hoje)
        return sum(1 for d in self.marcas if inicio <= d <= hoje)

    def aproveitamento_30d(self, hoje: datetime.date) -> Optional[int]:
        """% do que valia nos últimos 30 dias (None se nada valia)."""
        dias = [hoje - datetime.timedelta(days=i) for i in range(30)]
        if self.frequencia == "semana":
            validos = sum(1 for d in dias if self.vale(d))
            if not validos:
                return None
            esperado = self.vezes * validos / 7
            feitos = sum(1 for d in dias if d in self.marcas)
            return min(100, round(100 * feitos / esperado))
        # hoje ainda sem marca não pesa contra
        validos = [d for d in dias if self.vale(d) and not (d == hoje and d not in self.marcas)]
        if not validos:
            return None
        return round(100 * sum(1 for d in validos if d in self.marcas) / len(validos))

    def grade(self, hoje: datetime.date) -> Dict[str, object]:
        """SEMANAS_NA_GRADE semanas de segunda a domingo, um estado por dia:
        feito | faltou | livre (hábito 'semana' sem marca) | fora (não valia)
        | hoje (pendente) | futuro."""
        inicio = semana_inicio(hoje) - datetime.timedelta(weeks=SEMANAS_NA_GRADE - 1)
        estados = []
        for i in range(SEMANAS_NA_GRADE * 7):
            d = inicio + datetime.timedelta(days=i)
            if d > hoje:
                estados.append("futuro")
            elif d in self.marcas:
                estados.append("feito")
            elif not self.vale(d):
                estados.append("fora")
            elif d == hoje:
                estados.append("hoje")
            elif self.frequencia == "semana":
                estados.append("livre")
            else:
                estados.append("faltou")
        return {"inicio": inicio.isoformat(), "estados": estados}


def carregar(db, where: str = "1", args: tuple = ()) -> List[Habito]:
    """Hábitos (com marcas e pausas) que batem com o filtro, na ordem da tela."""
    rows = db.execute(
        f"SELECT * FROM habitos WHERE {where} ORDER BY posicao, criado_em", args
    ).fetchall()
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    ph = ", ".join("?" for _ in ids)
    marcas: Dict[str, List[str]] = {i: [] for i in ids}
    for m in db.execute(f"SELECT habito_id, dia FROM habitos_marcas WHERE habito_id IN ({ph})", ids):
        marcas[m["habito_id"]].append(m["dia"])
    pausas: Dict[str, List[tuple]] = {i: [] for i in ids}
    for p in db.execute(f"SELECT habito_id, inicio, fim FROM habitos_pausas WHERE habito_id IN ({ph})", ids):
        pausas[p["habito_id"]].append((p["inicio"], p["fim"]))
    return [Habito(r, marcas[r["id"]], pausas[r["id"]]) for r in rows]


def dias_com_tudo_feito(db, inicio: datetime.date, fim: datetime.date) -> int:
    """Missão semanal (P-58): dias entre inicio e fim em que TODOS os
    hábitos de dia (diario/dias) que valiam foram feitos — e pelo menos um
    valia. Hábito arquivado sai da conta."""
    habitos = [h for h in carregar(db, "status != 'arquivado' AND frequencia != 'semana'")]
    total = 0
    d = inicio
    while d <= fim:
        valendo = [h for h in habitos if h.vale(d)]
        if valendo and all(d in h.marcas for h in valendo):
            total += 1
        d += datetime.timedelta(days=1)
    return total
