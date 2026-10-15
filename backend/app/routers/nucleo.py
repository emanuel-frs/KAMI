"""
Módulo Núcleo (v1) — motor de gamificação central.

Endpoints:
  GET  /api/nucleo/attributes           lista os 5 atributos com nível/pct calculados
  POST /api/nucleo/actions              registra uma ação (form genérico, decisão 13)
  GET  /api/nucleo/log                  log cronológico, filtrável por atributo/período
  GET  /api/nucleo/achievements         galeria de conquistas (desbloqueadas + bloqueadas), com progresso
  GET  /api/nucleo/player               resumo do jogador: nível geral, sequência de dias (+ proteções), conquistas
  GET  /api/nucleo/missoes              missões do dia e da semana, com progresso (GAM-07)
  GET  /api/nucleo/recompensas          títulos e temas liberados por nível (GAM-10)
  GET  /api/nucleo/retrospectivas       retrospectivas mensais guardadas (GAM-12); gera a do mês anterior
  GET  /api/nucleo/retrospectivas/{mes} resumo de um mês
  POST /api/nucleo/retrospectivas/{mes}/vista  marca como vista
  POST /api/nucleo/streak-saved/seen    marca como visto o aviso "sequência salva" (GAM-06)
  GET  /api/nucleo/xp-review            prévia da revisão de xp (simulação, não grava nada)
  POST /api/nucleo/xp-review            aplica a revisão de xp (guarda uma cópia do banco antes)
"""
import datetime
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import backup_database, get_db, local_now, now_iso
from app.xp import level_from_xp
from app.actions import register_action as register_action_core
from app.achievements import REFS_BONUS, achievement_progress, streak_info
from app.revisao_xp import review_xp
from app.sequencia import MAX_PROTECOES
from app.missoes import avaliar_missoes, garantir_missoes, listar_missoes
from app.bonus import atributo_atrasado
from app.retrospectiva import garantir_retrospectiva
from app.recompensas import catalogo as recompensas_catalogo, titulo_atual

router = APIRouter()

# teto de xp de uma ação manual — sem ele um único "fiz algo" com xp
# arbitrário valia mais que meses de ações reais nos módulos. O valor
# padrão do formulário (10) e o seed demo (até 30) ficam abaixo dele.
MAX_MANUAL_XP = 50

# GAM-09: dias sem ação até o vértice do atributo apagar no radar
FORGOTTEN_DAYS = 14

SECRET_TITLE = "???"
SECRET_DESCRIPTION = "conquista secreta"


# ---------------- schemas ----------------

class AttributeOut(BaseModel):
    id: str
    name: str
    current_xp: int
    current_level: int
    is_active: bool
    pct: int
    xp_for_next_level: int
    bonus_atrasado: bool = False  # GAM-08: ações neste atributo rendem 2× (app/bonus.py)
    # GAM-09: atividade do atributo (ver _atividade_por_atributo)
    last_activity_at: Optional[str] = None
    days_inactive: Optional[int] = None
    forgotten: bool = False


class ActionCreate(BaseModel):
    description: str
    categories: List[str] = Field(..., min_length=1, description="nomes dos atributos afetados, ex: ['aprendizado']")
    xp: int = Field(..., gt=0, le=MAX_MANUAL_XP)
    impact: Optional[int] = Field(None, ge=1, le=5)


class AchievementUnlockedOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    unlocked_at: str


class ActionOut(BaseModel):
    id: str
    description: str
    xp_gained: int
    impact_note: Optional[int] = None
    categories: List[str]
    created_at: str
    newly_unlocked_achievements: List[AchievementUnlockedOut] = []


class LogEntryOut(BaseModel):
    id: str
    description: str
    xp_gained: int
    impact_note: Optional[int] = None
    categories: List[str]
    source: str
    created_at: str


class AchievementOut(BaseModel):
    id: str
    key: Optional[str] = None
    category: Optional[str] = None
    tier: Optional[str] = None
    secret: bool = False
    title: str
    description: Optional[str] = None
    rule_type: str
    unlocked: bool
    unlocked_at: Optional[str] = None
    progress_current: int
    progress_target: int


class PlayerOut(BaseModel):
    level: int
    total_xp: int
    current_level_xp: int
    xp_for_next_level: int
    pct: int
    streak_current: int
    streak_best: int
    active_today: bool
    streak_protections: int
    streak_protections_max: int
    streak_protected_yesterday: bool
    streak_next_protection_in: int
    streak_saved_days: List[str]
    player_class: Optional[str] = None  # GAM-11: ver _player_class
    player_title: str = "iniciante"     # GAM-10: título exibido (app/recompensas.py)
    achievements_unlocked: int
    achievements_total: int


# ---------------- helpers ----------------

def _attribute_row_to_out(row) -> dict:
    lv = level_from_xp(row["current_xp"])
    return {
        "id": row["id"],
        "name": row["name"],
        "current_xp": row["current_xp"],
        "current_level": lv["level"],
        "is_active": bool(row["is_active"]),
        "pct": lv["pct"],
        "xp_for_next_level": lv["xp_for_next_level"],
    }


def _categories_for_log(db, action_log_id: str) -> List[str]:
    rows = db.execute(
        "SELECT a.name FROM action_log_attributes ala "
        "JOIN attributes a ON a.id = ala.attribute_id "
        "WHERE ala.action_log_id = ?",
        (action_log_id,),
    ).fetchall()
    return [r["name"] for r in rows]


# ---------------- endpoints ----------------

def _atividade_por_atributo(db, today: datetime.date = None) -> dict:
    """
    GAM-09 — atributo esquecido: {attribute_id: {last_activity_at,
    days_inactive, forgotten}}. Última atividade = dia da última ação no
    atributo (MAX de action_logs.created_at via action_log_attributes, a
    consulta que o comentário de extensão de xp.py já descrevia — sem
    coluna nova). Bônus (missão, GAM-07; xp, GAM-08) não contam: não são
    ações. Atributo que nunca teve ação conta desde a primeira ação do app
    (sem ação nenhuma, ninguém está esquecido — conta nova não nasce com o
    radar todo apagado). Esquecido = FORGOTTEN_DAYS ou mais sem atividade.
    Só sinaliza: nenhum xp é perdido.
    """
    today = today or datetime.date.today()
    not_bonus = f"(l.referencia_tipo IS NULL OR l.referencia_tipo NOT IN ({', '.join(repr(r) for r in REFS_BONUS)}))"
    last = {
        r["attribute_id"]: r["d"]
        for r in db.execute(
            "SELECT ala.attribute_id, MAX(substr(l.created_at, 1, 10)) AS d "
            "FROM action_log_attributes ala JOIN action_logs l ON l.id = ala.action_log_id "
            f"WHERE {not_bonus} GROUP BY ala.attribute_id"
        ).fetchall()
    }
    first = db.execute(f"SELECT MIN(substr(l.created_at, 1, 10)) AS d FROM action_logs l WHERE {not_bonus}").fetchone()["d"]
    out = {}
    for row in db.execute("SELECT id FROM attributes").fetchall():
        since = last.get(row["id"]) or first
        days = (today - datetime.date.fromisoformat(since)).days if since else None
        out[row["id"]] = {
            "last_activity_at": last.get(row["id"]),
            "days_inactive": days,
            "forgotten": days is not None and days >= FORGOTTEN_DAYS,
        }
    return out


@router.get("/attributes", response_model=List[AttributeOut])
def list_attributes(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM attributes ORDER BY name").fetchall()
    atrasado = atributo_atrasado(db)
    atividade = _atividade_por_atributo(db)
    return [
        {**_attribute_row_to_out(r), "bonus_atrasado": r["name"] == atrasado, **atividade[r["id"]]}
        for r in rows
    ]


@router.post("/actions", response_model=ActionOut)
def register_action(payload: ActionCreate, db=Depends(get_db)):
    return register_action_core(
        db,
        description=payload.description,
        categories=payload.categories,
        xp=payload.xp,
        impact=payload.impact,
        source="form",
    )


@router.get("/log", response_model=List[LogEntryOut])
def get_log(
    attribute: Optional[str] = None,
    period_days: Optional[int] = None,
    limit: int = 100,
    db=Depends(get_db),
):
    query = "SELECT DISTINCT al.* FROM action_logs al"
    conditions = []
    args = []

    if attribute:
        query += " JOIN action_log_attributes ala ON ala.action_log_id = al.id JOIN attributes a ON a.id = ala.attribute_id"
        conditions.append("a.name = ?")
        args.append(attribute)

    if period_days:
        cutoff = (local_now() - datetime.timedelta(days=period_days)).isoformat()
        conditions.append("al.created_at >= ?")
        args.append(cutoff)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY al.created_at DESC LIMIT ?"
    args.append(limit)

    rows = db.execute(query, args).fetchall()
    return [
        {
            "id": r["id"],
            "description": r["description"],
            "xp_gained": r["xp_gained"],
            "impact_note": r["impact_note"],
            "categories": _categories_for_log(db, r["id"]),
            "source": r["source"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.get("/achievements", response_model=List[AchievementOut])
def list_achievements(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM achievements ORDER BY title").fetchall()
    out = []
    for r in rows:
        current, target = achievement_progress(db, json.loads(r["criteria_json"]))
        unlocked = r["unlocked_at"] is not None
        secret = bool(r["secreta"])
        if secret and not unlocked:
            # secreta bloqueada sai mascarada já da API — nada de spoiler
            # nem pelo devtools; o progresso também some (0/1)
            out.append(
                {
                    "id": r["id"],
                    "key": r["chave"],
                    "category": r["categoria"],
                    "tier": r["nivel"],
                    "secret": True,
                    "title": SECRET_TITLE,
                    "description": SECRET_DESCRIPTION,
                    "rule_type": r["rule_type"],
                    "unlocked": False,
                    "unlocked_at": None,
                    "progress_current": 0,
                    "progress_target": 1,
                }
            )
            continue
        out.append(
            {
                "id": r["id"],
                "key": r["chave"],
                "category": r["categoria"],
                "tier": r["nivel"],
                "secret": secret,
                "title": r["title"],
                "description": r["description"],
                "rule_type": r["rule_type"],
                "unlocked": unlocked,
                "unlocked_at": r["unlocked_at"],
                # desbloqueada aparece cheia: o estorno já rebloqueia quem
                # deixou de cumprir o critério (relock_unmet_achievements)
                "progress_current": target if unlocked else current,
                "progress_target": target,
            }
        )
    return out


# GAM-11 — classe do jogador, derivada do atributo com mais xp. Polímata
# quando o maior está a menos de POLYMATH_MARGIN do segundo (equilibrado).
# Sem xp nenhum ainda, sem classe.
CLASS_BY_ATTRIBUTE = {
    "aprendizado": "erudito",
    "financas": "mercador",
    "carreira": "artífice",
    "metas": "estrategista",
    "organizacao": "arquivista",
}
POLYMATH_CLASS = "polímata"
POLYMATH_MARGIN = 0.15


def _player_class(db) -> Optional[str]:
    rows = db.execute("SELECT name, current_xp FROM attributes ORDER BY current_xp DESC, name LIMIT 2").fetchall()
    if not rows or rows[0]["current_xp"] <= 0:
        return None
    top = rows[0]
    if len(rows) > 1 and top["current_xp"] - rows[1]["current_xp"] < POLYMATH_MARGIN * top["current_xp"]:
        return POLYMATH_CLASS
    return CLASS_BY_ATTRIBUTE.get(top["name"], POLYMATH_CLASS)


@router.get("/player", response_model=PlayerOut)
def get_player(db=Depends(get_db)):
    """
    Nível geral do jogador: soma do xp de todos os atributos passada pela
    mesma curva de level_from_xp (xp.py). Antes essa conta vivia só no
    frontend (widgets/profile.js + components/xp.js, uma cópia da fórmula);
    agora a fonte é o backend, igual ao nível de cada atributo.
    """
    total_xp = db.execute("SELECT COALESCE(SUM(current_xp), 0) AS t FROM attributes").fetchone()["t"]
    lv = level_from_xp(total_xp)
    # o cálculo da sequência grava os dias que uma proteção acabou de
    # cobrir (GAM-06, app/sequencia.py) — comita pra virar fato
    streak = streak_info(db)
    db.commit()
    ach = db.execute(
        "SELECT COUNT(*) AS total, COUNT(unlocked_at) AS unlocked FROM achievements"
    ).fetchone()
    return {
        "level": lv["level"],
        "total_xp": total_xp,
        "current_level_xp": lv["current_level_xp"],
        "xp_for_next_level": lv["xp_for_next_level"],
        "pct": lv["pct"],
        "streak_current": streak["current"],
        "streak_best": streak["best"],
        "active_today": streak["active_today"],
        "streak_protections": streak["protections"],
        "streak_protections_max": MAX_PROTECOES,
        "streak_protected_yesterday": streak["protected_yesterday"],
        "streak_next_protection_in": streak["next_protection_in"],
        "streak_saved_days": streak["saved_unseen"],
        "player_class": _player_class(db),
        "player_title": titulo_atual(
            db.execute("SELECT titulo FROM user_profile LIMIT 1").fetchone()["titulo"], lv["level"]
        ),
        "achievements_unlocked": ach["unlocked"],
        "achievements_total": ach["total"],
    }


@router.get("/missoes")
def get_missoes(db=Depends(get_db)):
    """
    GAM-07: missões do dia e da semana atuais, com progresso. Gera as que
    ainda não existem e sincroniza a conclusão com os logs (app/missoes.py)
    — preguiçoso, na leitura, como a proteção de sequência.
    """
    garantir_missoes(db)
    db.commit()
    avaliar_missoes(db)
    db.commit()
    return listar_missoes(db)


@router.get("/recompensas")
def get_recompensas(db=Depends(get_db)):
    """GAM-10: títulos e temas de terminal, com o nível que libera cada um."""
    return recompensas_catalogo(db)


@router.get("/retrospectivas")
def list_retrospectivas(db=Depends(get_db)):
    """
    GAM-12: retrospectivas guardadas, da mais nova pra mais antiga. Gera a
    do mês anterior se ainda não existe (app/retrospectiva.py).
    """
    garantir_retrospectiva(db)
    db.commit()
    rows = db.execute("SELECT mes, vista_em FROM retrospectivas ORDER BY mes DESC").fetchall()
    return [{"mes": r["mes"], "vista": r["vista_em"] is not None} for r in rows]


@router.get("/retrospectivas/{mes}")
def get_retrospectiva(mes: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM retrospectivas WHERE mes = ?", (mes,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="retrospectiva não encontrada")
    return {**json.loads(row["dados_json"]), "vista": row["vista_em"] is not None}


@router.post("/retrospectivas/{mes}/vista", status_code=204)
def mark_retrospectiva_vista(mes: str, db=Depends(get_db)):
    """Marca a retrospectiva como vista — ela não abre mais sozinha."""
    db.execute("UPDATE retrospectivas SET vista_em = ? WHERE mes = ? AND vista_em IS NULL", (now_iso(), mes))
    db.commit()


class StreakSavedSeen(BaseModel):
    days: List[str] = Field(..., description="dias (YYYY-MM-DD) de /player.streak_saved_days já avisados")


@router.post("/streak-saved/seen", status_code=204)
def mark_streak_saved_seen(payload: StreakSavedSeen, db=Depends(get_db)):
    """
    GAM-06: marca o aviso "sequência salva" desses dias protegidos como
    visto, pra o frontend (components/streak-notice.js) não repetir o
    toast. Dia desconhecido ou já avisado é ignorado.
    """
    now = now_iso()
    for day in payload.days:
        db.execute(
            "UPDATE dias_protegidos SET avisado_em = ? WHERE dia = ? AND avisado_em IS NULL",
            (now, day),
        )
    db.commit()


@router.get("/xp-review")
def preview_xp_review(db=Depends(get_db)):
    """Simula a revisão de xp (app/revisao_xp.py) e devolve o relatório, sem gravar nada."""
    return review_xp(db, apply=False)


@router.post("/xp-review")
def apply_xp_review(db=Depends(get_db)):
    """
    Aplica a revisão de xp. Antes guarda uma cópia completa do banco na
    pasta de dados (database.backup_database) — a revisão remove logs
    antigos, então quem se arrepender consegue voltar ao estado anterior.
    """
    backup_path = backup_database(db, "antes-revisao-xp")
    report = review_xp(db, apply=True)
    report["backup"] = backup_path
    return report
