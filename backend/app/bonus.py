"""
Bônus de xp (GAM-08). Cada ação feita num módulo pode render, além do xp
dela, até três bônus — cada um um action_log próprio (aparece separado no
log e no "+xp" da tela), com `source`/`referencia_tipo` 'bonus' e
`referencia_id` = id do log da ação que o gerou:

  - primeira ação do dia: +5 fixo
  - sequência: multiplicador em degraus, os mesmos da chama (GAM-06) —
    3 dias 1,1× · 7 dias 1,2× · 14 dias 1,3× · 30+ dias 1,5×; o bônus é a
    parte que passa de 1× (ação de 20 xp com 1,3× → +6)
  - atributo atrasado: 2× (bônus = xp da ação) quando a ação cai no
    atributo de menor nível (empate: menos xp), medido ANTES da ação. Se
    os dois mais baixos estão empatados em nível e xp (ex: conta nova),
    ninguém está atrasado.

Regras combinadas com o Emanuel em 2026-10-09:
  - Os bônus somam entre si; cada um tem teto de +20 xp (posição nova vale
    150 e salário até 220 — sem teto, um 2× sozinho renderia +150).
  - Ação manual do Núcleo (source 'form') não ganha bônus — ela já aceita
    até 50 xp livres (mesma regra das missões, GAM-07). O teto de 50 do
    xp manual é da ação, não do bônus.
  - Bônus não gera bônus, e bônus de missão também não ganha bônus.
  - O log de bônus não conta como ação nas conquistas de contagem
    (achievements.REFS_BONUS) nem nas missões (missoes._LOG_VALIDO).
  - Desfazer a ação estorna os bônus dela junto (actions.revert_actions
    acha os bônus pelo `referencia_id`). Se a ação desfeita era a primeira
    do dia, a próxima ação do dia volta a ganhar o +5 — "primeira" é
    "não existe bônus de primeira ação hoje".
"""
import datetime

from app.database import now_iso

REF_BONUS = "bonus"
PRIMEIRA_ACAO = 5
TETO = 20
# (dias mínimos de sequência, multiplicador) — do maior pro menor
DEGRAUS_SEQUENCIA = ((30, 1.5), (14, 1.3), (7, 1.2), (3, 1.1))

DESC_PRIMEIRA = "bônus · primeira ação do dia"
DESC_SEQUENCIA = "bônus · sequência de {dias} dias {mult}×"
DESC_ATRASADO = "bônus · atributo atrasado 2×"

# desligado só pela suíte de testes (conftest.py), pelo mesmo motivo das
# missões: com bônus ligados, todo teste antigo que confere o xp de uma
# ação mudaria. Os testes de bônus religam.
BONUS_ATIVO = True


def multiplicador(dias: int) -> float:
    for minimo, mult in DEGRAUS_SEQUENCIA:
        if dias >= minimo:
            return mult
    return 1.0


def _mult_label(mult: float) -> str:
    return f"{mult:.1f}".replace(".", ",")


def atributo_atrasado(db):
    """Nome do atributo de menor nível (empate: menos xp), ou None se empatado."""
    rows = db.execute(
        "SELECT name, current_level, current_xp FROM attributes WHERE is_active = 1 "
        "ORDER BY current_level, current_xp, name LIMIT 2"
    ).fetchall()
    if not rows:
        return None
    if len(rows) > 1 and (rows[0]["current_level"], rows[0]["current_xp"]) == (rows[1]["current_level"], rows[1]["current_xp"]):
        return None
    return rows[0]["name"]


def elegivel(source: str, referencia_tipo) -> bool:
    from app.missoes import REF_MISSAO
    return BONUS_ATIVO and source != "form" and referencia_tipo not in (REF_BONUS, REF_MISSAO)


def _tem_primeira_hoje(db) -> bool:
    return db.execute(
        "SELECT 1 FROM action_logs WHERE referencia_tipo = ? AND description = ? "
        "AND substr(created_at, 1, 10) = ? LIMIT 1",
        (REF_BONUS, DESC_PRIMEIRA, now_iso()[:10]),
    ).fetchone() is not None


def aplicar_bonus(db, log_id: str, categories, xp: int, atrasado) -> list:
    """
    Grava os bônus da ação `log_id` (já gravada). `atrasado` é o atributo
    atrasado medido antes da ação. Devolve [(descrição, xp)] dos bônus.
    """
    from app.achievements import streak_info  # a sequência já conta o dia desta ação
    from app.actions import register_action  # import local: actions importa este módulo

    bonus = []
    if not _tem_primeira_hoje(db):
        bonus.append((DESC_PRIMEIRA, PRIMEIRA_ACAO))

    dias = streak_info(db, today=datetime.date.today())["current"]
    mult = multiplicador(dias)
    extra = min(TETO, int(xp * (mult - 1) + 0.5))
    if extra > 0:
        bonus.append((DESC_SEQUENCIA.format(dias=dias, mult=_mult_label(mult)), extra))

    if atrasado and atrasado in categories:
        bonus.append((DESC_ATRASADO, min(TETO, xp)))

    for description, value in bonus:
        register_action(
            db,
            description=description,
            categories=categories,
            xp=value,
            source=REF_BONUS,
            referencia_tipo=REF_BONUS,
            referencia_id=log_id,
        )
    return bonus
