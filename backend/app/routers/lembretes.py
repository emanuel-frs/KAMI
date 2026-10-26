"""
Lembretes (ORG-05).

Rotas (prefixo /api/lembretes):
  GET    /                 todos, com a próxima ocorrência e o vínculo
  GET    /pendentes        os que dispararam e ainda estão no sino
  POST   /                 cria
  PUT    /{id}             edita (recalcula a próxima a partir de agora)
  DELETE /{id}             apaga
  POST   /disparar         o agendador do frontend chama a cada 30 s: dispara
                           os vencidos (viram pendentes) e devolve quais
  POST   /{id}/adiar       {minutos} ou {amanha: true} — sai do sino e volta depois
  POST   /{id}/dispensar   sai do sino (o que não repete e já avisou é apagado)

Disparo (P-63..P-65): um lembrete vencido vira pendente (aparece no sino
até ser dispensado ou adiado) e a próxima ocorrência é recalculada a partir
de AGORA — app fechado por 3 dias = um aviso "que passou", não três.
`atrasado` = disparou mais de TOLERANCIA_MIN depois da hora (app fechado):
o frontend não faz barulho com esses, só lista no sino. Lembrete ligado a
um hábito não dispara se o hábito já foi marcado no dia (P-63).

Sem xp: lembrete é ferramenta, não ação.
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.database import get_db, new_id, now_iso
from app.lembretes import REPETICOES, de_iso, dias_da_semana, iso_minuto, mais_cedo, proxima_desde
from app.limites import Entrada
from app.mensagens import ErroKami

router = APIRouter()

TOLERANCIA_MIN = 3
DATA_RE = r"^\d{4}-\d{2}-\d{2}$"
HORA_RE = r"^([01]\d|2[0-3]):[0-5]\d$"

# vínculo opcional: tipo -> (tabela, expressão do nome)
VINCULOS = {
    "nota": ("notas", "CASE WHEN titulo = '' THEN '(sem título)' ELSE titulo END"),
    "conta_fixa": ("fixed_bills", "name"),
    "meta": ("goals", "title"),
    "habito": ("habitos", "nome"),
    "evento": ("calendar_events", "title"),
}


# ==================== schemas ====================

class LembreteIn(Entrada):
    titulo: str = Field(..., min_length=1, max_length=200)
    data: str = Field(..., pattern=DATA_RE)
    hora: str = Field("09:00", pattern=HORA_RE)
    repeticao: str = Field("nao", max_length=10)
    dias_semana: List[int] = Field(default_factory=list, max_length=7)
    vinculo_tipo: Optional[str] = Field(None, max_length=20)
    vinculo_id: Optional[str] = Field(None, max_length=64)


class AdiarIn(Entrada):
    minutos: Optional[int] = Field(None, ge=1, le=24 * 60)
    amanha: bool = False


class VinculoOut(BaseModel):
    tipo: str
    id: str
    nome: str


class LembreteOut(BaseModel):
    id: str
    titulo: str
    data: str
    hora: str
    repeticao: str
    dias_semana: List[int]
    vinculo: Optional[VinculoOut] = None
    proxima: Optional[str] = None
    adiado_para: Optional[str] = None
    pendente: bool = False
    pendente_quando: Optional[str] = None
    atrasado: bool = False


# ==================== helpers ====================

def _agora() -> datetime.datetime:
    return datetime.datetime.fromisoformat(now_iso()[:16])


def _regra(row_or_payload) -> dict:
    get = (lambda k: row_or_payload[k]) if not isinstance(row_or_payload, BaseModel) else (lambda k: getattr(row_or_payload, k))
    dias = get("dias_semana")
    return {
        "data": get("data"),
        "hora": get("hora"),
        "repeticao": get("repeticao"),
        "dias_semana": dias if isinstance(dias, str) else ",".join(map(str, sorted(set(dias)))),
    }


def _validar(db, p: LembreteIn) -> None:
    if not p.titulo.strip():
        raise ErroKami(422, "erro.lembretes.lembrete_precisa_texto", "o lembrete precisa de um texto")
    if p.repeticao not in REPETICOES:
        raise ErroKami(422, "erro.lembretes.repeticao_invalida", "repetição inválida")
    try:
        datetime.date.fromisoformat(p.data)
    except ValueError:
        raise ErroKami(422, "erro.lembretes.data_invalida", "data inválida")
    if p.repeticao == "dias" and not dias_da_semana(",".join(map(str, p.dias_semana))):
        raise ErroKami(422, "erro.comum.escolha_pelo_menos_dia_semana", "escolha pelo menos um dia da semana")
    if p.vinculo_tipo is None and p.vinculo_id is None:
        return
    if p.vinculo_tipo not in VINCULOS or not p.vinculo_id:
        raise ErroKami(422, "erro.comum.vinculo_invalido", "vínculo inválido")
    tabela, _ = VINCULOS[p.vinculo_tipo]
    if not db.execute(f"SELECT 1 FROM {tabela} WHERE id = ?", (p.vinculo_id,)).fetchone():
        raise ErroKami(422, "erro.lembretes.item_vinculado_nao_existe_mais", "o item vinculado não existe mais")


def _proxima(regra: dict) -> Optional[str]:
    quando = proxima_desde(regra, _agora())
    return iso_minuto(quando) if quando else None


def _row(db, lembrete_id: str):
    row = db.execute("SELECT * FROM lembretes WHERE id = ?", (lembrete_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.lembretes.lembrete_nao_encontrado", "lembrete não encontrado")
    return row


def _vinculo(db, row) -> Optional[dict]:
    if not row["vinculo_tipo"] or row["vinculo_tipo"] not in VINCULOS:
        return None
    tabela, nome = VINCULOS[row["vinculo_tipo"]]
    alvo = db.execute(f"SELECT {nome} AS nome FROM {tabela} WHERE id = ?", (row["vinculo_id"],)).fetchone()
    # item apagado depois: o lembrete continua, só sem o vínculo
    return {"tipo": row["vinculo_tipo"], "id": row["vinculo_id"], "nome": alvo["nome"]} if alvo else None


def _saida(db, row) -> dict:
    return {
        "id": row["id"],
        "titulo": row["titulo"],
        "data": row["data"],
        "hora": row["hora"],
        "repeticao": row["repeticao"],
        "dias_semana": sorted(dias_da_semana(row["dias_semana"])),
        "vinculo": _vinculo(db, row),
        "proxima": row["proxima"],
        "adiado_para": row["adiado_para"],
        "pendente": row["pendente_desde"] is not None,
        "pendente_quando": row["pendente_quando"],
        "atrasado": bool(row["pendente_atrasado"]),
    }


def _habito_feito(db, habito_id: str, dia: datetime.date) -> bool:
    return db.execute(
        "SELECT 1 FROM habitos_marcas WHERE habito_id = ? AND dia = ?", (habito_id, dia.isoformat())
    ).fetchone() is not None


# ==================== rotas ====================

@router.get("", response_model=List[LembreteOut])
def listar(db=Depends(get_db)):
    rows = db.execute(
        "SELECT * FROM lembretes ORDER BY proxima IS NULL, COALESCE(adiado_para, proxima), criado_em"
    ).fetchall()
    return [_saida(db, r) for r in rows]


@router.get("/pendentes", response_model=List[LembreteOut])
def pendentes(db=Depends(get_db)):
    rows = db.execute(
        "SELECT * FROM lembretes WHERE pendente_desde IS NOT NULL ORDER BY pendente_quando DESC"
    ).fetchall()
    return [_saida(db, r) for r in rows]


@router.post("", response_model=LembreteOut, status_code=201)
def criar(payload: LembreteIn, db=Depends(get_db)):
    _validar(db, payload)
    regra = _regra(payload)
    proxima = _proxima(regra)
    if proxima is None:
        raise ErroKami(422, "erro.lembretes.esse_horario_ja_passou", "esse horário já passou")
    lembrete_id, agora = new_id(), now_iso()
    db.execute(
        "INSERT INTO lembretes (id, titulo, data, hora, repeticao, dias_semana, vinculo_tipo, vinculo_id, "
        "proxima, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (lembrete_id, payload.titulo.strip(), regra["data"], regra["hora"], regra["repeticao"],
         regra["dias_semana"], payload.vinculo_tipo, payload.vinculo_id, proxima, agora, agora),
    )
    db.commit()
    return _saida(db, _row(db, lembrete_id))


@router.put("/{lembrete_id}", response_model=LembreteOut)
def editar(lembrete_id: str, payload: LembreteIn, db=Depends(get_db)):
    _row(db, lembrete_id)
    _validar(db, payload)
    regra = _regra(payload)
    proxima = _proxima(regra)
    if proxima is None:
        raise ErroKami(422, "erro.lembretes.esse_horario_ja_passou", "esse horário já passou")
    db.execute(
        "UPDATE lembretes SET titulo = ?, data = ?, hora = ?, repeticao = ?, dias_semana = ?, vinculo_tipo = ?, "
        "vinculo_id = ?, proxima = ?, adiado_para = NULL, atualizado_em = ? WHERE id = ?",
        (payload.titulo.strip(), regra["data"], regra["hora"], regra["repeticao"], regra["dias_semana"],
         payload.vinculo_tipo, payload.vinculo_id, proxima, now_iso(), lembrete_id),
    )
    db.commit()
    return _saida(db, _row(db, lembrete_id))


@router.delete("/{lembrete_id}", status_code=204)
def apagar(lembrete_id: str, db=Depends(get_db)):
    _row(db, lembrete_id)
    db.execute("DELETE FROM lembretes WHERE id = ?", (lembrete_id,))
    db.commit()


@router.post("/disparar", response_model=List[LembreteOut])
def disparar(db=Depends(get_db)):
    agora = _agora()
    disparados = []
    for row in db.execute("SELECT * FROM lembretes WHERE proxima IS NOT NULL OR adiado_para IS NOT NULL").fetchall():
        adiado, proxima = de_iso(row["adiado_para"]), de_iso(row["proxima"])
        devido = mais_cedo([adiado, proxima])
        if devido is None or devido > agora:
            continue
        if adiado is not None and adiado <= agora:
            nova_proxima = row["proxima"]  # o adiamento não mexe na regra
            if proxima is not None and proxima <= agora:
                quando = proxima_desde(_regra(row), agora + datetime.timedelta(minutes=1))
                nova_proxima = iso_minuto(quando) if quando else None
        else:
            quando = proxima_desde(_regra(row), agora + datetime.timedelta(minutes=1))
            nova_proxima = iso_minuto(quando) if quando else None

        pular = row["vinculo_tipo"] == "habito" and _habito_feito(db, row["vinculo_id"], devido.date())
        if pular:
            db.execute(
                "UPDATE lembretes SET proxima = ?, adiado_para = NULL WHERE id = ?", (nova_proxima, row["id"])
            )
            continue
        atrasado = (agora - devido) > datetime.timedelta(minutes=TOLERANCIA_MIN)
        db.execute(
            "UPDATE lembretes SET proxima = ?, adiado_para = NULL, pendente_desde = ?, pendente_quando = ?, "
            "pendente_atrasado = ? WHERE id = ?",
            (nova_proxima, now_iso(), iso_minuto(devido), int(atrasado), row["id"]),
        )
        disparados.append(row["id"])
    db.commit()
    return [_saida(db, _row(db, i)) for i in disparados]


@router.post("/{lembrete_id}/adiar", response_model=LembreteOut)
def adiar(lembrete_id: str, payload: AdiarIn, db=Depends(get_db)):
    row = _row(db, lembrete_id)
    agora = _agora()
    if payload.amanha:
        h, m = (int(x) for x in row["hora"].split(":"))
        amanha = agora.date() + datetime.timedelta(days=1)
        quando = datetime.datetime(amanha.year, amanha.month, amanha.day, h, m)
    elif payload.minutos:
        quando = agora + datetime.timedelta(minutes=payload.minutos)
    else:
        raise ErroKami(422, "erro.lembretes.diga_por_quanto_tempo_adiar", "diga por quanto tempo adiar")
    db.execute(
        "UPDATE lembretes SET adiado_para = ?, pendente_desde = NULL, pendente_quando = NULL, "
        "pendente_atrasado = 0 WHERE id = ?",
        (iso_minuto(quando), lembrete_id),
    )
    db.commit()
    return _saida(db, _row(db, lembrete_id))


@router.post("/{lembrete_id}/dispensar", response_model=LembreteOut)
def dispensar(lembrete_id: str, db=Depends(get_db)):
    row = _row(db, lembrete_id)
    if row["proxima"] is None and row["adiado_para"] is None:
        # não repete e já avisou: "ok" encerra de vez (não fica um
        # "encerrado" sobrando na lista do calendário)
        saida = {**_saida(db, row), "pendente": False, "pendente_quando": None, "atrasado": False}
        db.execute("DELETE FROM lembretes WHERE id = ?", (lembrete_id,))
        db.commit()
        return saida
    db.execute(
        "UPDATE lembretes SET pendente_desde = NULL, pendente_quando = NULL, pendente_atrasado = 0 WHERE id = ?",
        (lembrete_id,),
    )
    db.commit()
    return _saida(db, _row(db, lembrete_id))
