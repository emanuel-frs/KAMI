"""
Módulo partes 1-3 (fundação da tela, posições e formação
acadêmica).

Cobre os dois blocos "campo simples" do documento de regras de negócio
(carreira-regras-de-negocio.md, seções 1 e 2):

  - área atual / área-meta: linha única em career_profile, sem
    histórico próprio (só o valor atual importa) — mesmo padrão de
    user_profile (app/routers/perfil.py). Editar NÃO credita XP: é
    identidade, não conquista.
  - interesses profissionais: lista livre de tags em career_interests,
    sem limite fixo e sem XP por adicionar/remover — metadado, não
    ação registrada.

Parte 2 (linha do tempo de posições, seção 3) já entra neste módulo
também — ver bloco "posições" mais abaixo.

Parte 3 (formação acadêmica, seção 4) entra no bloco "formação
acadêmica" — diferente de posições, aqui o evento que credita XP é a
CONCLUSÃO (status -> 'concluido'), não o registro do início: criar uma
formação "em andamento" não credita nada, mesmo espírito de milestones
em Aprendizado (não de career_positions, onde criar já é o evento).
Também ativa o tipo 'academica' em app/routers/metas.py
(sync_academic_goals), seguindo o mesmo padrão de vínculo trilha↔meta
que já existe pra 'aprendizado'.

Parte 4 (evolução salarial, seção 5) entra no bloco "evolução salarial"
no fim do arquivo: CRUD completo em career_salary_records + endpoint de
estatísticas (crescimento desde o início, desde a posição atual, maior
salto). XP diferenciado por lançamento em tempo real (proporcional ao
salto) vs. retroativo (fixo, simbólico) — mesmo critério data=hoje que
career_positions já usa.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.actions import register_action
from app.database import get_db, new_id, now_iso
from app.xp import level_from_xp
from app.routers.metas import sync_academic_goals

router = APIRouter()


# ---------------- perfil (área atual / área-meta) ----------------

class CareerProfileOut(BaseModel):
    id: str
    area_atual: Optional[str] = None
    area_meta: Optional[str] = None
    updated_at: str


class CareerProfileUpdate(BaseModel):
    area_atual: Optional[str] = None
    area_meta: Optional[str] = None


def _get_career_profile_row(db):
    row = db.execute("SELECT * FROM career_profile LIMIT 1").fetchone()
    if not row:
        # não deveria acontecer — init_db sempre semeia a linha única
        raise HTTPException(status_code=404, detail="perfil de carreira não encontrado")
    return row


@router.get("/perfil", response_model=CareerProfileOut)
def get_career_profile(db=Depends(get_db)):
    return dict(_get_career_profile_row(db))


@router.put("/perfil", response_model=CareerProfileOut)
def update_career_profile(payload: CareerProfileUpdate, db=Depends(get_db)):
    """
    Sempre sobrescreve os dois campos juntos (o formulário do widget
    manda os dois de uma vez — não existe update parcial de só um
    campo aqui, diferente de perfil.py). String vazia vira NULL (limpa
    o campo) em vez de "sem mudança". Sem XP — seção 1 do documento de
    regras é explícita: "editar não credita XP — é identidade, não
    conquista".
    """
    row = _get_career_profile_row(db)
    area_atual = payload.area_atual.strip() if payload.area_atual and payload.area_atual.strip() else None
    area_meta = payload.area_meta.strip() if payload.area_meta and payload.area_meta.strip() else None
    db.execute(
        "UPDATE career_profile SET area_atual = ?, area_meta = ?, updated_at = ? WHERE id = ?",
        (area_atual, area_meta, now_iso(), row["id"]),
    )
    db.commit()
    return dict(_get_career_profile_row(db))


# ---------------- interesses profissionais ----------------

class InterestIn(BaseModel):
    tag: str


class InterestOut(InterestIn):
    id: str
    created_at: str


@router.get("/interesses", response_model=list[InterestOut])
def list_interests(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM career_interests ORDER BY created_at").fetchall()
    return [dict(r) for r in rows]


@router.post("/interesses", response_model=InterestOut, status_code=201)
def create_interest(payload: InterestIn, db=Depends(get_db)):
    tag = payload.tag.strip()
    if not tag:
        raise HTTPException(status_code=422, detail="tag não pode ser vazia")

    interest_id = new_id()
    created_at = now_iso()
    db.execute(
        "INSERT INTO career_interests (id, tag, created_at) VALUES (?, ?, ?)",
        (interest_id, tag, created_at),
    )
    db.commit()
    # sem register_action aqui de propósito — seção 2 do documento de
    # regras: "sem XP por adicionar ou remover"
    return {"id": interest_id, "tag": tag, "created_at": created_at}


@router.delete("/interesses/{interest_id}", status_code=204)
def delete_interest(interest_id: str, db=Depends(get_db)):
    row = db.execute("SELECT id FROM career_interests WHERE id = ?", (interest_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="interesse não encontrado")
    db.execute("DELETE FROM career_interests WHERE id = ?", (interest_id,))
    db.commit()


# ---------------- linha do tempo de posições ----------------

# Regra de XP (seção 3 do documento de regras de negócio): a PRIMEIRA
# posição já registrada é o marco inicial da linha do tempo — vale um
# XP fixo bem maior, independente de quando ela começou (pode ser a
# primeira posição da carreira toda, registrada anos depois). As
# demais entradas variam conforme são um lançamento em tempo real
# (start_date = hoje, uma mudança de emprego acontecendo agora — vale
# mais) ou um preenchimento retroativo de histórico (start_date no
# passado — valor menor, simbólico), mesmo critério que a Parte 4
# (evolução salarial) vai usar pra distinguir lançamento real de
# backfill. Editar NUNCA credita XP (só a criação é o "evento real");
# remover também não estorna — mesmo tratamento de organizacao.py
# (delete_link): o XP creditado na criação fica como histórico.
XP_CAREER_FIRST_POSITION = 150
XP_CAREER_POSITION_REALTIME = 80
XP_CAREER_POSITION_RETROACTIVE = 20


class PositionIn(BaseModel):
    company: str
    role: str
    area: Optional[str] = None
    employment_type: Optional[str] = None
    start_date: str
    end_date: Optional[str] = None
    expected_contract_end: Optional[str] = None
    expected_salary_review: Optional[str] = None


class PositionOut(PositionIn):
    id: str
    created_at: str
    updated_at: str


@router.get("/posicoes", response_model=list[PositionOut])
def list_positions(db=Depends(get_db)):
    # mais recente primeiro (estilo linha do tempo/LinkedIn) — ordenação
    # fina (posições "atuais" sempre no topo etc.) é polish da Parte 5
    rows = db.execute(
        "SELECT * FROM career_positions ORDER BY start_date DESC, created_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/posicoes", response_model=PositionOut, status_code=201)
def create_position(payload: PositionIn, db=Depends(get_db)):
    company = payload.company.strip()
    role = payload.role.strip()
    if not company or not role:
        raise HTTPException(status_code=422, detail="empresa e cargo são obrigatórios")

    is_first = db.execute("SELECT COUNT(*) AS c FROM career_positions").fetchone()["c"] == 0

    position_id = new_id()
    created_at = now_iso()
    db.execute(
        "INSERT INTO career_positions "
        "(id, company, role, area, employment_type, start_date, end_date, "
        " expected_contract_end, expected_salary_review, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            position_id, company, role, payload.area, payload.employment_type,
            payload.start_date, payload.end_date, payload.expected_contract_end,
            payload.expected_salary_review, created_at, created_at,
        ),
    )
    db.commit()

    if is_first:
        xp = XP_CAREER_FIRST_POSITION
        description = f"primeira posição registrada: {role} na {company}"
    elif payload.start_date == date.today().isoformat():
        xp = XP_CAREER_POSITION_REALTIME
        description = f"novo cargo: {role} na {company}"
    else:
        xp = XP_CAREER_POSITION_RETROACTIVE
        description = f"registrou posição retroativa: {role} na {company}"

    register_action(db, description=description, categories=["carreira"], xp=xp, impact=2, source="carreira")

    return dict(db.execute("SELECT * FROM career_positions WHERE id = ?", (position_id,)).fetchone())


@router.put("/posicoes/{position_id}", response_model=PositionOut)
def update_position(position_id: str, payload: PositionIn, db=Depends(get_db)):
    row = db.execute("SELECT id FROM career_positions WHERE id = ?", (position_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="posição não encontrada")

    company = payload.company.strip()
    role = payload.role.strip()
    if not company or not role:
        raise HTTPException(status_code=422, detail="empresa e cargo são obrigatórios")

    db.execute(
        "UPDATE career_positions SET company=?, role=?, area=?, employment_type=?, "
        "start_date=?, end_date=?, expected_contract_end=?, expected_salary_review=?, updated_at=? "
        "WHERE id=?",
        (
            company, role, payload.area, payload.employment_type, payload.start_date,
            payload.end_date, payload.expected_contract_end, payload.expected_salary_review,
            now_iso(), position_id,
        ),
    )
    db.commit()
    # sem register_action aqui de propósito — ver comentário da regra de XP acima
    return dict(db.execute("SELECT * FROM career_positions WHERE id = ?", (position_id,)).fetchone())


@router.delete("/posicoes/{position_id}", status_code=204)
def delete_position(position_id: str, db=Depends(get_db)):
    row = db.execute("SELECT id FROM career_positions WHERE id = ?", (position_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="posição não encontrada")
    db.execute("DELETE FROM career_positions WHERE id = ?", (position_id,))
    db.commit()


# ---------------- formação acadêmica ----------------

# Regra de XP (seção 4 do documento de regras de negócio): escalonado por
# `nivel`, seguindo a hierarquia acadêmica usual (certificação < técnico <
# pós-graduação lato sensu < graduação < mestrado < doutorado — pós-grad
# lato sensu tipicamente exige menos tempo que uma graduação completa,
# mesmo vindo "depois" dela no requisito de pré-requisito). Só credita na
# transição PRA 'concluido' (criar ou editar mantendo outro status não
# credita nada — "em andamento" não é conquista, é registro de processo).
NIVEL_XP = {
    "certificacao": 25,
    "tecnico": 60,
    "pos_graduacao": 90,
    "graduacao": 220,
    "mestrado": 280,
    "doutorado": 450,
}
EDUCATION_STATUSES = {"em_andamento", "concluido", "trancado"}


class EducationIn(BaseModel):
    curso: str
    instituicao: str
    nivel: str
    status: str = "em_andamento"
    previsao_conclusao: Optional[str] = None


class EducationUpdate(BaseModel):
    curso: Optional[str] = None
    instituicao: Optional[str] = None
    nivel: Optional[str] = None
    status: Optional[str] = None
    previsao_conclusao: Optional[str] = None
    clear_previsao_conclusao: bool = False


class EducationOut(BaseModel):
    id: str
    curso: str
    instituicao: str
    nivel: str
    status: str
    previsao_conclusao: Optional[str] = None
    created_at: str
    updated_at: str


def _get_education_or_404(db, education_id: str):
    row = db.execute("SELECT * FROM career_educations WHERE id = ?", (education_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="formação não encontrada")
    return row


def _debit_xp(db, attribute_name: str, amount: int) -> None:
    """
    Estorna XP de um atributo ao reabrir uma formação já concluída —
    mesmo padrão de app/routers/aprendizado.py (_debit_xp): sem criar um
    novo action_log (a conclusão original continua no histórico, só o
    xp/nível atual do atributo é corrigido). Nunca deixa current_xp
    negativo.
    """
    row = db.execute("SELECT * FROM attributes WHERE name = ?", (attribute_name,)).fetchone()
    if not row:
        return
    new_xp = max(0, row["current_xp"] - amount)
    new_level = level_from_xp(new_xp)["level"]
    db.execute(
        "UPDATE attributes SET current_xp = ?, current_level = ? WHERE id = ?",
        (new_xp, new_level, row["id"]),
    )
    db.commit()


@router.get("/formacoes", response_model=list[EducationOut])
def list_educations(db=Depends(get_db)):
    # em andamento primeiro (mais relevante pro dia a dia), depois
    # concluídas/trancadas, por previsão de conclusão mais próxima
    rows = db.execute(
        """
        SELECT * FROM career_educations
        ORDER BY
            CASE WHEN status = 'em_andamento' THEN 0 ELSE 1 END,
            CASE WHEN previsao_conclusao IS NULL THEN 1 ELSE 0 END,
            previsao_conclusao DESC,
            created_at DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/formacoes", response_model=EducationOut, status_code=201)
def create_education(payload: EducationIn, db=Depends(get_db)):
    curso = payload.curso.strip()
    instituicao = payload.instituicao.strip()
    if not curso or not instituicao:
        raise HTTPException(status_code=422, detail="curso e instituição são obrigatórios")
    if payload.nivel not in NIVEL_XP:
        raise HTTPException(status_code=422, detail=f"nível inválido; valores aceitos: {sorted(NIVEL_XP)}")
    if payload.status not in EDUCATION_STATUSES:
        raise HTTPException(status_code=422, detail=f"status inválido; valores aceitos: {sorted(EDUCATION_STATUSES)}")

    education_id = new_id()
    created_at = now_iso()
    xp_awarded = NIVEL_XP[payload.nivel] if payload.status == "concluido" else None
    db.execute(
        "INSERT INTO career_educations "
        "(id, curso, instituicao, nivel, status, previsao_conclusao, xp_awarded, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            education_id, curso, instituicao, payload.nivel, payload.status,
            payload.previsao_conclusao, xp_awarded, created_at, created_at,
        ),
    )
    db.commit()

    if payload.status == "concluido":
        # cadastro retroativo já nascendo concluído (ex: usuário registra
        # uma graduação antiga) — credita normalmente, mesmo critério de
        # "a conclusão é o evento que importa", não quando ela foi
        # cursada
        register_action(
            db,
            description=f"concluiu formação: {curso} ({instituicao})",
            categories=["carreira"],
            xp=xp_awarded,
            impact=3,
            source="carreira",
        )

    sync_academic_goals(db, education_id)

    return dict(db.execute("SELECT * FROM career_educations WHERE id = ?", (education_id,)).fetchone())


@router.put("/formacoes/{education_id}", response_model=EducationOut)
def update_education(education_id: str, payload: EducationUpdate, db=Depends(get_db)):
    row = _get_education_or_404(db, education_id)

    curso = payload.curso.strip() if payload.curso is not None else row["curso"]
    instituicao = payload.instituicao.strip() if payload.instituicao is not None else row["instituicao"]
    if not curso or not instituicao:
        raise HTTPException(status_code=422, detail="curso e instituição são obrigatórios")

    nivel = payload.nivel if payload.nivel is not None else row["nivel"]
    if nivel not in NIVEL_XP:
        raise HTTPException(status_code=422, detail=f"nível inválido; valores aceitos: {sorted(NIVEL_XP)}")

    new_status = payload.status if payload.status is not None else row["status"]
    if new_status not in EDUCATION_STATUSES:
        raise HTTPException(status_code=422, detail=f"status inválido; valores aceitos: {sorted(EDUCATION_STATUSES)}")

    if payload.clear_previsao_conclusao:
        previsao_conclusao = None
    elif payload.previsao_conclusao is not None:
        previsao_conclusao = payload.previsao_conclusao
    else:
        previsao_conclusao = row["previsao_conclusao"]

    is_completing = new_status == "concluido" and row["status"] != "concluido"
    is_reopening = new_status != "concluido" and row["status"] == "concluido"

    xp_awarded = row["xp_awarded"]
    if is_completing:
        xp_awarded = NIVEL_XP[nivel]
    elif is_reopening:
        # reabre uma formação já concluída (ex: usuário marcou por engano,
        # ou "trancou" de novo) — estorna exatamente o xp que foi
        # creditado nessa conclusão (não um valor recalculado agora: se
        # NIVEL_XP mudar depois, formações antigas continuam revertendo
        # certo), mesmo padrão de milestones/_debit_xp em Aprendizado
        if xp_awarded:
            _debit_xp(db, "carreira", xp_awarded)
        xp_awarded = None

    db.execute(
        "UPDATE career_educations SET curso=?, instituicao=?, nivel=?, status=?, "
        "previsao_conclusao=?, xp_awarded=?, updated_at=? WHERE id=?",
        (curso, instituicao, nivel, new_status, previsao_conclusao, xp_awarded, now_iso(), education_id),
    )
    db.commit()

    if is_completing:
        # feito DEPOIS do UPDATE acima (mesmo motivo de aprendizado.py):
        # register_action dispara check_achievements na mesma chamada, e
        # um achievement futuro que leia career_educations direto da
        # tabela precisa já ver status='concluido' nesse momento
        register_action(
            db,
            description=f"concluiu formação: {curso} ({instituicao})",
            categories=["carreira"],
            xp=xp_awarded,
            impact=3,
            source="carreira",
        )

    # meta tipo 'academica' vinculada a essa formação progride sozinha
    # (binário: 0% em andamento/trancada, 100% quando concluída) — ver
    # docstring de sync_academic_goals em metas.py
    sync_academic_goals(db, education_id)

    return dict(db.execute("SELECT * FROM career_educations WHERE id = ?", (education_id,)).fetchone())


@router.delete("/formacoes/{education_id}", status_code=204)
def delete_education(education_id: str, db=Depends(get_db)):
    row = _get_education_or_404(db, education_id)
    db.execute("DELETE FROM career_educations WHERE id = ?", (education_id,))
    db.commit()
    # sem estorno de xp na remoção — mesmo tratamento de organizacao.py
    # (delete_link) e career_positions.delete_position: o xp creditado na
    # conclusão fica como histórico, remover o registro não desfaz a
    # conquista já dada. Metas 'academica' vinculadas ficam com
    # linked_education_id = NULL (ON DELETE SET NULL, ver schema.sql),
    # mesmo comportamento de deletar uma trilha vinculada a uma meta
    # 'aprendizado'.


# ---------------- evolução salarial ----------------

# Regra de XP (seção 5 do documento de regras de negócio, critério
# adotado — mesmo data=hoje/data!=hoje que career_positions já usa pra
# distinguir lançamento real de backfill):
#
#   - PRIMEIRO registro salarial de todos: não existe salto pra medir
#     (não há registro anterior), então é tratado como estabelecer a
#     baseline — XP fixo simbólico, igual a um lançamento retroativo,
#     independente da data informada.
#   - Demais registros com date = hoje (lançamento em tempo real, o
#     reajuste está acontecendo agora): XP escala com o tamanho do
#     salto percentual sobre o registro anterior mais recente
#     (SALARY_XP_REALTIME_BASE + salto% × SALARY_XP_REALTIME_PER_PCT),
#     limitado a SALARY_XP_REALTIME_MAX. Salto negativo (redução
#     salarial) ainda credita o piso (SALARY_XP_REALTIME_BASE) — é um
#     evento real acontecendo agora, mas sem bônus por "crescimento".
#   - Demais registros com date != hoje (preenchimento retroativo de
#     histórico): XP fixo simbólico, igual ao primeiro registro —
#     backfill não é o evento em si, é só recuperar dado passado.
#
# Editar NUNCA credita XP (só a criação é o "evento real", mesmo
# tratamento de career_positions); remover também não estorna (mesmo
# tratamento de career_positions.delete_position/organizacao.delete_link
# — o xp creditado na criação fica como histórico).
SALARY_XP_BASELINE_OR_RETROACTIVE = 15
SALARY_XP_REALTIME_BASE = 40
SALARY_XP_REALTIME_PER_PCT = 3
SALARY_XP_REALTIME_MAX = 220


def _pct_change(previous: float, current: float) -> Optional[float]:
    if not previous:
        return None
    return round((current - previous) / previous * 100, 2)


class SalaryRecordIn(BaseModel):
    amount: float
    currency: str = "BRL"
    employment_type: Optional[str] = None
    date: str
    reason: Optional[str] = None
    position_id: Optional[str] = None


class SalaryRecordOut(SalaryRecordIn):
    id: str
    created_at: str
    updated_at: str


class SalaryJump(BaseModel):
    amount: float
    pct: Optional[float] = None
    date: str


class SalaryStatsOut(BaseModel):
    total_registros: int
    crescimento_desde_inicio_pct: Optional[float] = None
    crescimento_posicao_atual_pct: Optional[float] = None
    maior_salto: Optional[SalaryJump] = None


def _get_salary_record_or_404(db, record_id: str):
    row = db.execute("SELECT * FROM career_salary_records WHERE id = ?", (record_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="registro salarial não encontrado")
    return row


def _validate_position_id(db, position_id: Optional[str]) -> None:
    if position_id is None:
        return
    row = db.execute("SELECT id FROM career_positions WHERE id = ?", (position_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=422, detail="posição vinculada não encontrada")


@router.get("/salarios", response_model=list[SalaryRecordOut])
def list_salary_records(db=Depends(get_db)):
    # mais recente primeiro (mesma leitura de linha do tempo de posições)
    rows = db.execute(
        "SELECT * FROM career_salary_records ORDER BY date DESC, created_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/salarios", response_model=SalaryRecordOut, status_code=201)
def create_salary_record(payload: SalaryRecordIn, db=Depends(get_db)):
    if payload.amount <= 0:
        raise HTTPException(status_code=422, detail="valor deve ser maior que zero")
    currency = payload.currency.strip() or "BRL"
    _validate_position_id(db, payload.position_id)

    # registro anterior mais recente (por data, depois por criação) —
    # base pro cálculo do salto% em lançamentos em tempo real
    previous = db.execute(
        "SELECT * FROM career_salary_records ORDER BY date DESC, created_at DESC LIMIT 1"
    ).fetchone()

    record_id = new_id()
    created_at = now_iso()
    db.execute(
        "INSERT INTO career_salary_records "
        "(id, amount, currency, employment_type, date, reason, position_id, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            record_id, payload.amount, currency, payload.employment_type,
            payload.date, payload.reason, payload.position_id, created_at, created_at,
        ),
    )
    db.commit()

    is_realtime = payload.date == date.today().isoformat()
    if previous is None:
        xp = SALARY_XP_BASELINE_OR_RETROACTIVE
        description = "registrou o primeiro salário (baseline da evolução salarial)"
    elif is_realtime:
        salto_pct = _pct_change(previous["amount"], payload.amount) or 0.0
        xp = min(
            SALARY_XP_REALTIME_MAX,
            round(SALARY_XP_REALTIME_BASE + max(salto_pct, 0) * SALARY_XP_REALTIME_PER_PCT),
        )
        description = f"novo reajuste salarial ({salto_pct:+.1f}%)"
    else:
        xp = SALARY_XP_BASELINE_OR_RETROACTIVE
        description = "registrou salário retroativo (histórico)"

    register_action(db, description=description, categories=["carreira"], xp=xp, impact=2, source="carreira")

    return dict(db.execute("SELECT * FROM career_salary_records WHERE id = ?", (record_id,)).fetchone())


@router.put("/salarios/{record_id}", response_model=SalaryRecordOut)
def update_salary_record(record_id: str, payload: SalaryRecordIn, db=Depends(get_db)):
    _get_salary_record_or_404(db, record_id)
    if payload.amount <= 0:
        raise HTTPException(status_code=422, detail="valor deve ser maior que zero")
    currency = payload.currency.strip() or "BRL"
    _validate_position_id(db, payload.position_id)

    db.execute(
        "UPDATE career_salary_records SET amount=?, currency=?, employment_type=?, date=?, "
        "reason=?, position_id=?, updated_at=? WHERE id=?",
        (
            payload.amount, currency, payload.employment_type, payload.date,
            payload.reason, payload.position_id, now_iso(), record_id,
        ),
    )
    db.commit()
    # sem register_action aqui de propósito — ver comentário da regra de XP acima
    return dict(db.execute("SELECT * FROM career_salary_records WHERE id = ?", (record_id,)).fetchone())


@router.delete("/salarios/{record_id}", status_code=204)
def delete_salary_record(record_id: str, db=Depends(get_db)):
    _get_salary_record_or_404(db, record_id)
    db.execute("DELETE FROM career_salary_records WHERE id = ?", (record_id,))
    db.commit()
    # sem estorno de xp — mesmo tratamento do resto do módulo (ver acima)


@router.get("/salarios/estatisticas", response_model=SalaryStatsOut)
def get_salary_stats(db=Depends(get_db)):
    rows = [
        dict(r) for r in db.execute(
            "SELECT * FROM career_salary_records ORDER BY date ASC, created_at ASC"
        ).fetchall()
    ]
    if not rows:
        return {"total_registros": 0}

    primeiro, ultimo = rows[0], rows[-1]
    crescimento_desde_inicio_pct = _pct_change(primeiro["amount"], ultimo["amount"])

    # crescimento desde a posição atual: posição sem end_date com o
    # start_date mais recente (mesma noção de "atual" de career_positions,
    # que permite múltiplas — pega a mais recentemente iniciada); usa o
    # PRIMEIRO registro salarial vinculado a ela como base de comparação
    crescimento_posicao_atual_pct = None
    posicao_atual = db.execute(
        "SELECT id FROM career_positions WHERE end_date IS NULL ORDER BY start_date DESC, created_at DESC LIMIT 1"
    ).fetchone()
    if posicao_atual:
        registros_da_posicao = [r for r in rows if r["position_id"] == posicao_atual["id"]]
        if registros_da_posicao:
            crescimento_posicao_atual_pct = _pct_change(registros_da_posicao[0]["amount"], ultimo["amount"])

    # maior salto: maior diferença COM SINAL entre registros consecutivos
    # (ordenados por data) — não é valor absoluto, então sempre prioriza o
    # maior AUMENTO salarial; um corte maior em módulo não vence um aumento
    # menor. Reporta o valor do salto, o % e quando aconteceu (data do
    # registro "depois" do salto).
    maior_salto = None
    for anterior, atual in zip(rows, rows[1:]):
        diff = atual["amount"] - anterior["amount"]
        if maior_salto is None or diff > maior_salto["amount"]:
            maior_salto = {
                "amount": diff,
                "pct": _pct_change(anterior["amount"], atual["amount"]),
                "date": atual["date"],
            }

    return {
        "total_registros": len(rows),
        "crescimento_desde_inicio_pct": crescimento_desde_inicio_pct,
        "crescimento_posicao_atual_pct": crescimento_posicao_atual_pct,
        "maior_salto": maior_salto,
    }
