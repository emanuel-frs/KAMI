"""
Hábitos (ORG-04) — tela própria (P-55), Alt+9.

Rotas (prefixo /api/habitos):
  GET    /                 lista com o que a tela precisa (hoje, sequência,
                           recorde, 30 dias, grade de 12 semanas). Arquivados
                           só com ?arquivados=true
  POST   /                 cria
  PUT    /{id}             edita (parcial). status 'pausado'/'ativo' abre e
                           fecha a pausa; 'arquivado' tira da lista
  DELETE /{id}             apaga com o histórico e estorna o xp das marcas
  POST   /{id}/marcar      marca um dia (hoje ou até DIAS_PARA_TRAS atrás)
  DELETE /{id}/marcar?dia= desmarca (estorna o xp)

xp (P-56): XP_HABITO por marca no atributo do hábito, no máximo uma vez
por dia por hábito (UNIQUE no banco). A marca é uma ação de verdade:
conta na sequência geral (P-44) e nas missões (P-45/P-58). Desmarcar
estorna (P-43). Apagar o hábito estorna tudo (mesma coerência de apagar
uma meta); arquivar guarda o histórico e o xp.

Regras de sequência/recorde/grade em app/habitos.py.
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.actions import register_action, revert_actions
from app.database import get_db, new_id, now_iso
from app.habitos import DIAS_PARA_TRAS, FREQUENCIAS, STATUS, Habito, carregar, dias_da_semana
from app.limites import Entrada
from app.mensagens import ErroKami, Texto

router = APIRouter()

XP_HABITO = 5
REF_MARCA = "habito_marca"


# ==================== schemas ====================

class HabitoIn(Entrada):
    nome: str = Field(..., min_length=1, max_length=120)
    frequencia: str = Field("diario", max_length=10)
    dias_semana: List[int] = Field(default_factory=list, max_length=7)
    vezes_semana: int = Field(3, ge=1, le=7)
    atributo: str = Field("organizacao", max_length=30)


class HabitoUpdate(Entrada):
    nome: Optional[str] = Field(None, min_length=1, max_length=120)
    frequencia: Optional[str] = Field(None, max_length=10)
    dias_semana: Optional[List[int]] = Field(None, max_length=7)
    vezes_semana: Optional[int] = Field(None, ge=1, le=7)
    atributo: Optional[str] = Field(None, max_length=30)
    status: Optional[str] = Field(None, max_length=10)
    posicao: Optional[int] = Field(None, ge=0, le=10_000)


class MarcarIn(Entrada):
    dia: Optional[str] = Field(None, max_length=10)  # sem dia = hoje


class GradeOut(BaseModel):
    inicio: str
    estados: List[str]


class HabitoOut(BaseModel):
    id: str
    nome: str
    frequencia: str
    dias_semana: List[int]
    vezes_semana: int
    atributo: str
    status: str
    posicao: int
    criado_em: str
    vale_hoje: bool
    feito_hoje: bool
    feitas_na_semana: int
    sequencia: int
    recorde: int
    aproveitamento_30d: Optional[int] = None
    grade: GradeOut
    total_marcas: int = 0
    xp_por_marca: int = XP_HABITO


# ==================== helpers ====================

def _hoje() -> datetime.date:
    return datetime.date.fromisoformat(now_iso()[:10])


def _validar(db, frequencia, dias, atributo, status=None):
    if frequencia is not None and frequencia not in FREQUENCIAS:
        raise ErroKami(422, "erro.habitos.frequencia_invalida", "frequência inválida")
    if frequencia == "dias" and dias is not None and not dias_da_semana(",".join(map(str, dias))):
        raise ErroKami(422, "erro.comum.escolha_pelo_menos_dia_semana", "escolha pelo menos um dia da semana")
    if dias is not None and any(not 0 <= d <= 6 for d in dias):
        raise ErroKami(422, "erro.habitos.dia_semana_invalido", "dia da semana inválido")
    if atributo is not None and not db.execute("SELECT 1 FROM attributes WHERE name = ?", (atributo,)).fetchone():
        raise ErroKami(
            422,
            "erro.habitos.atributo_desconhecido_atributo",
            "atributo desconhecido: '{atributo}'",
            atributo=atributo,
        )
    if status is not None and status not in STATUS:
        raise ErroKami(422, "erro.habitos.status_invalido", "status inválido")


def _um(db, habito_id: str) -> Habito:
    hs = carregar(db, "id = ?", (habito_id,))
    if not hs:
        raise ErroKami(404, "erro.habitos.habito_nao_encontrado", "hábito não encontrado")
    return hs[0]


def _saida(h: Habito, hoje: datetime.date) -> dict:
    r = h.row
    seq = h.sequencias(hoje)
    return {
        "id": r["id"],
        "nome": r["nome"],
        "frequencia": r["frequencia"],
        "dias_semana": sorted(h.dias),
        "vezes_semana": r["vezes_semana"],
        "atributo": r["atributo"],
        "status": r["status"],
        "posicao": r["posicao"],
        "criado_em": r["criado_em"],
        "vale_hoje": r["status"] == "ativo" and h.vale(hoje),
        "feito_hoje": hoje in h.marcas,
        "feitas_na_semana": h.feitas_na_semana(hoje),
        "sequencia": seq["sequencia"],
        "recorde": seq["recorde"],
        "aproveitamento_30d": h.aproveitamento_30d(hoje),
        "grade": h.grade(hoje),
        "total_marcas": len(h.marcas),
    }


def _dia_marcavel(h: Habito, dia_txt: Optional[str], hoje: datetime.date) -> datetime.date:
    try:
        dia = datetime.date.fromisoformat(dia_txt) if dia_txt else hoje
    except ValueError:
        raise ErroKami(422, "erro.habitos.dia_invalido", "dia inválido")
    if dia > hoje:
        raise ErroKami(422, "erro.habitos.nao_marcar_dia_ainda_nao", "não dá pra marcar um dia que ainda não chegou")
    if (hoje - dia).days > DIAS_PARA_TRAS:
        raise ErroKami(
            422,
            "erro.habitos.so_mexer_ate_dias_para",
            "só dá pra mexer até {dias_para_tras} dias atrás",
            dias_para_tras=DIAS_PARA_TRAS,
        )
    return dia


# ==================== rotas ====================

@router.get("", response_model=List[HabitoOut])
def listar(arquivados: bool = False, db=Depends(get_db)):
    hoje = _hoje()
    where = "1" if arquivados else "status != 'arquivado'"
    return [_saida(h, hoje) for h in carregar(db, where)]


@router.post("", response_model=HabitoOut, status_code=201)
def criar(payload: HabitoIn, db=Depends(get_db)):
    _validar(db, payload.frequencia, payload.dias_semana, payload.atributo)
    habito_id, agora = new_id(), now_iso()
    posicao = db.execute("SELECT COALESCE(MAX(posicao), -1) + 1 FROM habitos").fetchone()[0]
    db.execute(
        "INSERT INTO habitos (id, nome, frequencia, dias_semana, vezes_semana, atributo, posicao, criado_em, atualizado_em) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (habito_id, payload.nome.strip(), payload.frequencia, ",".join(map(str, sorted(set(payload.dias_semana)))),
         payload.vezes_semana, payload.atributo, posicao, agora, agora),
    )
    db.commit()
    return _saida(_um(db, habito_id), _hoje())


@router.put("/{habito_id}", response_model=HabitoOut)
def editar(habito_id: str, payload: HabitoUpdate, db=Depends(get_db)):
    h = _um(db, habito_id)
    _validar(db, payload.frequencia, None, payload.atributo, payload.status)
    _validar(db, None, payload.dias_semana, None)
    freq = payload.frequencia if payload.frequencia is not None else h.frequencia
    dias = set(payload.dias_semana) if payload.dias_semana is not None else h.dias
    if freq == "dias" and not dias:
        raise ErroKami(422, "erro.comum.escolha_pelo_menos_dia_semana", "escolha pelo menos um dia da semana")
    if payload.nome is not None and not payload.nome.strip():
        raise ErroKami(422, "erro.habitos.habito_precisa_nome", "o hábito precisa de um nome")

    campos, args = [], []

    def muda(coluna, valor):
        campos.append(f"{coluna} = ?")
        args.append(valor)

    if payload.nome is not None:
        muda("nome", payload.nome.strip())
    if payload.frequencia is not None:
        muda("frequencia", payload.frequencia)
    if payload.dias_semana is not None:
        muda("dias_semana", ",".join(map(str, sorted(set(payload.dias_semana)))))
    if payload.vezes_semana is not None:
        muda("vezes_semana", payload.vezes_semana)
    if payload.atributo is not None:
        muda("atributo", payload.atributo)
    if payload.posicao is not None:
        muda("posicao", payload.posicao)

    hoje = _hoje()
    if payload.status is not None and payload.status != h.row["status"]:
        muda("status", payload.status)
        aberta = db.execute(
            "SELECT id, inicio FROM habitos_pausas WHERE habito_id = ? AND fim IS NULL", (habito_id,)
        ).fetchone()
        if payload.status == "pausado" and not aberta:
            db.execute(
                "INSERT INTO habitos_pausas (id, habito_id, inicio) VALUES (?, ?, ?)",
                (new_id(), habito_id, hoje.isoformat()),
            )
        elif payload.status != "pausado" and aberta:
            # retomar: hoje já volta a valer. Pausa e retomada no mesmo dia
            # não deixa rastro.
            fim = hoje - datetime.timedelta(days=1)
            if fim < datetime.date.fromisoformat(aberta["inicio"]):
                db.execute("DELETE FROM habitos_pausas WHERE id = ?", (aberta["id"],))
            else:
                db.execute("UPDATE habitos_pausas SET fim = ? WHERE id = ?", (fim.isoformat(), aberta["id"]))

    if campos:
        muda("atualizado_em", now_iso())
        db.execute(f"UPDATE habitos SET {', '.join(campos)} WHERE id = ?", (*args, habito_id))
    db.commit()
    return _saida(_um(db, habito_id), hoje)


@router.delete("/{habito_id}", status_code=204)
def apagar(habito_id: str, db=Depends(get_db)):
    _um(db, habito_id)
    marcas = [r["id"] for r in db.execute("SELECT id FROM habitos_marcas WHERE habito_id = ?", (habito_id,))]
    db.execute("DELETE FROM habitos_marcas WHERE habito_id = ?", (habito_id,))
    db.execute("DELETE FROM habitos_pausas WHERE habito_id = ?", (habito_id,))
    db.execute("DELETE FROM habitos WHERE id = ?", (habito_id,))
    db.commit()
    for marca_id in marcas:
        revert_actions(db, REF_MARCA, marca_id)


@router.post("/{habito_id}/marcar", response_model=HabitoOut)
def marcar(habito_id: str, payload: MarcarIn, db=Depends(get_db)):
    h = _um(db, habito_id)
    hoje = _hoje()
    dia = _dia_marcavel(h, payload.dia, hoje)
    if h.row["status"] != "ativo":
        raise ErroKami(
            409,
            "erro.habitos.habito_pausado_ou_arquivado_retome",
            "hábito pausado ou arquivado — retome pra marcar",
        )
    if h.frequencia == "dias" and dia.weekday() not in h.dias:
        raise ErroKami(422, "erro.habitos.esse_dia_nao_esta_na", "esse dia não está na programação do hábito")
    if dia in h.marcas:
        return _saida(h, hoje)  # já marcado: idempotente, sem xp de novo
    marca_id = new_id()
    db.execute(
        "INSERT OR IGNORE INTO habitos_marcas (id, habito_id, dia, criada_em) VALUES (?, ?, ?, ?)",
        (marca_id, habito_id, dia.isoformat(), now_iso()),
    )
    db.commit()
    if db.execute("SELECT 1 FROM habitos_marcas WHERE id = ?", (marca_id,)).fetchone():
        register_action(
            db,
            description=(
                Texto("log.habito", "hábito: {nome}", nome=h.row["nome"]) if dia == hoje
                else Texto("log.habito.outro_dia", "hábito: {nome} ({dia})", nome=h.row["nome"], dia=dia.strftime("%d/%m"))
            ),
            categories=[h.row["atributo"]],
            xp=XP_HABITO,
            source="habitos",
            referencia_tipo=REF_MARCA,
            referencia_id=marca_id,
        )
    return _saida(_um(db, habito_id), hoje)


@router.delete("/{habito_id}/marcar", response_model=HabitoOut)
def desmarcar(habito_id: str, dia: Optional[str] = Query(None, max_length=10), db=Depends(get_db)):
    h = _um(db, habito_id)
    hoje = _hoje()
    d = _dia_marcavel(h, dia, hoje)
    row = db.execute(
        "SELECT id FROM habitos_marcas WHERE habito_id = ? AND dia = ?", (habito_id, d.isoformat())
    ).fetchone()
    if row:
        db.execute("DELETE FROM habitos_marcas WHERE id = ?", (row["id"],))
        db.commit()
        revert_actions(db, REF_MARCA, row["id"])
    return _saida(_um(db, habito_id), hoje)
