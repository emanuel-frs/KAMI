"""
Lógica central de "registrar ação" (decisão 13 — formulário genérico
do Núcleo: descrição, categoria(s), XP, impacto). Fica num módulo
próprio, fora do router do Núcleo, pra outros módulos poderem
creditar XP automaticamente sem depender do router (ex: Finanças
credita XP em 'financas' ao lançar uma transação, do jeito que já
acontecia no protótipo de telas).
"""
from typing import List, Optional

from fastapi import HTTPException

from app.database import new_id, now_iso
from app.xp import level_from_xp
from app.achievements import check_achievements


def register_action(
    db,
    description: str,
    categories: List[str],
    xp: int,
    impact: Optional[int] = None,
    source: str = "form",
) -> dict:
    """
    Grava um action_log + action_log_attributes, credita XP em cada
    atributo afetado, recalcula o nível de cada um, e roda a checagem
    de conquistas na mesma transação lógica.

    `source` distingue de onde a ação veio ('form' = formulário do
    Núcleo, 'financas' = lançamento automático de transação, etc) —
    já é o campo que existia no schema pra não precisar migração
    quando a Kami (pós-mvp) passar a registrar ações via chat.
    """
    attr_rows = {}
    for cat in categories:
        row = db.execute("SELECT * FROM attributes WHERE name = ?", (cat,)).fetchone()
        if not row:
            raise HTTPException(status_code=422, detail=f"categoria desconhecida: '{cat}'")
        attr_rows[cat] = row

    log_id = new_id()
    created_at = now_iso()
    db.execute(
        "INSERT INTO action_logs (id, description, xp_gained, impact_note, source, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (log_id, description, xp, impact, source, created_at),
    )

    for cat, row in attr_rows.items():
        db.execute(
            "INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)",
            (log_id, row["id"]),
        )
        new_xp = row["current_xp"] + xp
        new_level = level_from_xp(new_xp)["level"]
        db.execute(
            "UPDATE attributes SET current_xp = ?, current_level = ? WHERE id = ?",
            (new_xp, new_level, row["id"]),
        )

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
