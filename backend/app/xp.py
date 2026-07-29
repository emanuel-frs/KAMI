"""
Fórmula de XP por nível (documentada no projeto):
    XP_necessario(nivel) = 100 * nivel^1.3

`xp_for_level(n)` retorna quanto XP é necessário pra SAIR do nível n
e ir pro n+1 (curva RPG suave — cresce, mas não pune demais em
níveis altos). `level_from_xp(total)` consome XP cumulativo nível a
nível até sobrar o resto que ainda não fechou o próximo nível.
"""
import math

# ---------------------------------------------------------------------------
# PONTO DE EXTENSÃO (pós-mvp, deliberadamente adiado): decadência de XP por
# atributo, pra atributos "esquecidos" perderem XP com o tempo em vez de só
# acumular pra sempre.
#
# Quando for implementar, a atividade por atributo já é rastreável sem
# migração: junte attributes -> action_log_attributes -> action_logs.created_at
# (ver actions.py) pra achar a última ação de cada atributo, em vez de
# adicionar uma coluna `last_activity_at` redundante em `attributes`. A
# decadência entraria como uma função pura aqui (tipo `decay_xp(current_xp,
# days_inactive) -> int`), chamada sob demanda no GET do atributo (ou num job
# de manutenção no startup) — nunca recalculando o histórico de action_logs
# já gravado.
# ---------------------------------------------------------------------------


def xp_for_level(level: int) -> int:
    return round(100 * math.pow(level, 1.3))


def level_from_xp(total_xp: int) -> dict:
    level = 1
    remaining = total_xp
    while remaining >= xp_for_level(level):
        remaining -= xp_for_level(level)
        level += 1
    need = xp_for_level(level)
    pct = min(100, round((remaining / need) * 100)) if need else 0
    return {
        "level": level,
        "current_level_xp": remaining,
        "xp_for_next_level": need,
        "pct": pct,
    }