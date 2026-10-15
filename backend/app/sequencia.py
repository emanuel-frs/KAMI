"""
Proteção de sequência (GAM-06).

A cada 7 dias COM AÇÃO dentro de uma sequência, o jogador ganha uma
proteção (no máximo 2 guardadas). Um dia que passou em branco consome
uma proteção sozinho e a sequência continua; sem proteção guardada, a
sequência quebra como antes. Regras combinadas com o Emanuel em
2026-10-09:

  - Só dia com ação real conta pros 7 dias que rendem uma proteção —
    dia protegido mantém a sequência viva, mas não "se paga" sozinho.
  - O consumo é dia a dia (como no Duolingo): um buraco de 3 dias com 2
    proteções gasta as duas e quebra no terceiro; as gastas não voltam.
  - O dia de HOJE nunca consome proteção — ele ainda não acabou. Só dias
    que já passaram são avaliados.
  - Nada retroativo: a regra só vale a partir de
    `user_profile.sequencia_protecao_desde`, gravado (preguiçosamente) no
    primeiro cálculo depois da atualização. Antes disso, buraco quebra a
    sequência e nenhuma proteção é ganha — senão a atualização tapava
    buracos antigos e liberava conquistas de sequência de uma vez. Uma
    sequência que já estava em andamento continua contando: quem estava
    com 20 dias ganha a primeira proteção no 21º.

Consumo preguiçoso, na leitura (mesmo padrão de `_apply_staleness` em
routers/aprendizado.py): não existe job em background. Toda vez que a
sequência é calculada (`achievements.streak_info`, usado pelo /player e
pelo critério `streak_days`), a história é repassada dia a dia desde a
primeira ação, e os dias em branco que essa passada protege são gravados
em `dias_protegidos`. O dia gravado vira fato: continua protegido mesmo
que depois um estorno mude a conta das proteções ganhas — a passada só
ACRESCENTA dias, nunca tira. NÃO comita: quem chama decide (o /player
comita; dentro de register_action a transação da ação comita junto; na
simulação da revisão de xp tudo é desfeito).
"""
import datetime

from app.database import now_iso

DIAS_PARA_GANHAR = 7
MAX_PROTECOES = 2


def _desde(conn, today: datetime.date) -> datetime.date:
    """Dia a partir do qual a proteção vale — gravado no primeiro cálculo."""
    row = conn.execute("SELECT id, sequencia_protecao_desde FROM user_profile LIMIT 1").fetchone()
    if row is None:
        return today
    if row["sequencia_protecao_desde"]:
        return datetime.date.fromisoformat(row["sequencia_protecao_desde"])
    conn.execute(
        "UPDATE user_profile SET sequencia_protecao_desde = ? WHERE id = ?",
        (today.isoformat(), row["id"]),
    )
    return today


def aplicar_protecoes(conn, action_dates, today: datetime.date) -> dict:
    """
    Repassa a história dia a dia (ver docstring do módulo), grava os dias
    em branco que acabaram de ser protegidos e devolve:
      - protegidos: set de datas protegidas (gravadas antes + agora)
      - guardadas:  proteções guardadas agora (0..MAX_PROTECOES)
      - proxima_em: dias com ação que faltam pra ganhar a próxima
    """
    gravados = {
        datetime.date.fromisoformat(r["dia"])
        for r in conn.execute("SELECT dia FROM dias_protegidos").fetchall()
    }
    acoes = set(action_dates)
    if not acoes:
        return {"protegidos": gravados, "guardadas": 0, "proxima_em": DIAS_PARA_GANHAR}

    desde = _desde(conn, today)
    protegidos = set(gravados)
    guardadas = 0
    seguidos = 0  # dias COM AÇÃO na sequência atual (dia protegido não conta)
    dia = min(acoes)
    while dia <= today:
        if dia in acoes:
            seguidos += 1
            if dia >= desde and seguidos % DIAS_PARA_GANHAR == 0:
                guardadas = min(MAX_PROTECOES, guardadas + 1)
        elif dia == today:
            pass  # hoje ainda não acabou: nem consome nem quebra
        elif dia in protegidos:
            # pode ficar negativo: um estorno apagou um dos dias que
            # renderam essa proteção. O dia continua protegido (é fato),
            # mas a dívida é paga pelo próximo ganho — senão desfazer
            # uma ação antiga devolvia uma proteção "de graça".
            guardadas -= 1
        elif dia >= desde and guardadas > 0:
            guardadas -= 1
            protegidos.add(dia)
            conn.execute(
                "INSERT OR IGNORE INTO dias_protegidos (dia, created_at) VALUES (?, ?)",
                (dia.isoformat(), now_iso()),
            )
        else:
            seguidos = 0  # buraco sem proteção: a sequência quebrou
        dia += datetime.timedelta(days=1)

    return {
        "protegidos": protegidos,
        "guardadas": max(0, guardadas),
        "proxima_em": DIAS_PARA_GANHAR - seguidos % DIAS_PARA_GANHAR,
    }
