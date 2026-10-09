"""
Lógica central de "registrar ação" (decisão 13 — formulário genérico
do Núcleo: descrição, categoria(s), XP, impacto). Fica num módulo
próprio, fora do router do Núcleo, pra outros módulos poderem
creditar XP automaticamente sem depender do router (ex: Finanças
credita XP em 'financas' ao lançar uma transação, do jeito que já
acontecia no protótipo de telas).

Integridade do XP: toda ação gerada por um módulo carrega uma
referência (`referencia_tipo` + `referencia_id`) à entidade que a
gerou. Desfazer essa entidade (desmarcar um pagamento, reabrir um
marco, apagar uma posição...) chama `revert_actions`, que apaga o
log e debita exatamente o xp que ele creditou. Assim o XP do atributo,
a soma do log e as contagens das conquistas continuam batendo, e
"fazer e desfazer" deixa de render XP.
"""
from typing import Iterable, List, Optional, Union

from fastapi import HTTPException

from app.database import new_id, now_iso
from app.xp import level_from_xp
from app.achievements import check_achievements, relock_unmet_achievements


def _set_attribute_xp(db, row, new_xp: int) -> None:
    new_xp = max(0, new_xp)
    db.execute(
        "UPDATE attributes SET current_xp = ?, current_level = ? WHERE id = ?",
        (new_xp, level_from_xp(new_xp)["level"], row["id"]),
    )


def register_action(
    db,
    description: str,
    categories: List[str],
    xp: int,
    impact: Optional[int] = None,
    source: str = "form",
    referencia_tipo: Optional[str] = None,
    referencia_id: Optional[str] = None,
) -> dict:
    """
    Grava um action_log + action_log_attributes, credita XP em cada
    atributo afetado, recalcula o nível de cada um, e roda a checagem
    de conquistas na mesma transação lógica.

    `source` distingue de onde a ação veio ('form' = formulário do
    Núcleo, 'financas' = lançamento automático de transação, etc) —
    já é o campo que existia no schema pra não precisar migração
    quando a Kami (pós-mvp) passar a registrar ações via chat.

    `referencia_tipo`/`referencia_id` apontam pra entidade que gerou a
    ação, pra que ela possa ser estornada depois (ver revert_actions).
    Categorias repetidas contam uma vez só.
    """
    categories = list(dict.fromkeys(categories))
    attr_rows = {}
    for cat in categories:
        row = db.execute("SELECT * FROM attributes WHERE name = ?", (cat,)).fetchone()
        if not row:
            raise HTTPException(status_code=422, detail=f"categoria desconhecida: '{cat}'")
        attr_rows[cat] = row

    log_id = new_id()
    created_at = now_iso()
    db.execute(
        "INSERT INTO action_logs "
        "(id, description, xp_gained, impact_note, source, created_at, referencia_tipo, referencia_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (log_id, description, xp, impact, source, created_at, referencia_tipo, referencia_id),
    )

    for cat, row in attr_rows.items():
        db.execute(
            "INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)",
            (log_id, row["id"]),
        )
        _set_attribute_xp(db, row, row["current_xp"] + xp)

    db.commit()
    newly_unlocked = check_achievements(db)

    return {
        "id": log_id,
        "description": description,
        "xp_gained": xp,
        "impact_note": impact,
        "categories": categories,
        "created_at": created_at,
        "newly_unlocked_achievements": newly_unlocked,
    }


def _tipos(referencia_tipo: Union[str, Iterable[str]]) -> List[str]:
    return [referencia_tipo] if isinstance(referencia_tipo, str) else list(referencia_tipo)


def revert_actions(db, referencia_tipo: Union[str, Iterable[str]], referencia_id: str) -> int:
    """
    Estorna todas as ações ligadas a uma entidade: debita de cada
    atributo o xp que o log creditou (nunca abaixo de 0) e apaga o log,
    pra que contagens de conquistas e sequências deixem de considerá-lo.
    Conquistas cujo critério deixou de valer voltam a ficar bloqueadas
    (ver achievements.relock_unmet_achievements).

    Devolve quantos logs foram estornados — 0 significa que a entidade
    não tinha ação referenciada (ex: concluída antes da migração), e o
    chamador pode cair no estorno legado (`debit_xp`).
    """
    tipos = _tipos(referencia_tipo)
    placeholders = ", ".join("?" for _ in tipos)
    logs = db.execute(
        f"SELECT id, xp_gained FROM action_logs "
        f"WHERE referencia_tipo IN ({placeholders}) AND referencia_id = ?",
        (*tipos, referencia_id),
    ).fetchall()
    for log in logs:
        attrs = db.execute(
            "SELECT a.* FROM action_log_attributes ala "
            "JOIN attributes a ON a.id = ala.attribute_id "
            "WHERE ala.action_log_id = ?",
            (log["id"],),
        ).fetchall()
        for row in attrs:
            _set_attribute_xp(db, row, row["current_xp"] - log["xp_gained"])
        db.execute("DELETE FROM action_logs WHERE id = ?", (log["id"],))
    if logs:
        relock_unmet_achievements(db)
        db.commit()
    return len(logs)


def debit_xp(db, attribute_name: str, amount: int) -> None:
    """
    Estorno legado: debita xp de um atributo sem tocar no log. Só usado
    pra entidades concluídas antes de action_logs ter referência (não há
    log identificável pra apagar). Nunca deixa current_xp negativo.
    """
    row = db.execute("SELECT * FROM attributes WHERE name = ?", (attribute_name,)).fetchone()
    if not row:
        return
    _set_attribute_xp(db, row, row["current_xp"] - amount)
    db.commit()


def today_prefix() -> str:
    """Prefixo YYYY-MM-DD do "hoje" usado em created_at de action_logs."""
    return now_iso()[:10]


def has_action(
    db,
    referencia_tipo: Union[str, Iterable[str]],
    referencia_id: str,
    only_today: bool = False,
) -> bool:
    """Diz se já existe ação ligada à entidade (opcionalmente, só hoje)."""
    tipos = _tipos(referencia_tipo)
    placeholders = ", ".join("?" for _ in tipos)
    query = (
        f"SELECT 1 FROM action_logs "
        f"WHERE referencia_tipo IN ({placeholders}) AND referencia_id = ?"
    )
    args = [*tipos, referencia_id]
    if only_today:
        query += " AND substr(created_at, 1, 10) = ?"
        args.append(today_prefix())
    return db.execute(query + " LIMIT 1", args).fetchone() is not None
