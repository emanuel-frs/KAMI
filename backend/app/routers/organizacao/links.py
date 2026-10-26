"""
Links: cadastro simples agrupado por categoria (CRUD puro, sem API externa).

Parte do módulo Organização (routers/organizacao/__init__.py junta as
partes num router só, montado em /api/organizacao). MAN-02.
"""
from typing import ClassVar, List, Optional

from fastapi import APIRouter, Depends

from app.database import get_db, new_id
from app.actions import register_action, revert_actions
from app.limites import Entrada, SAIDA_CONFIG
from app.mensagens import ErroKami, Texto

router = APIRouter()

XP_LINK_ADD    = 2


class LinkIn(Entrada):
    title: str
    url: str
    category: str


class LinkOut(LinkIn):
    model_config = SAIDA_CONFIG  # resposta: sem os limites de entrada (app/limites.py)
    sem_limites_de_entrada: ClassVar[bool] = True
    id: str


class LinkUpdate(Entrada):
    """Todos os campos opcionais — mesmo padrão de EmailAccountUpdate acima:
    só reescreve o que vier no payload, sem obrigar o cliente a reenviar
    tudo pra editar só um campo."""
    title: Optional[str] = None
    url: Optional[str] = None
    category: Optional[str] = None


# ==================== links ====================

@router.get("/links", response_model=List[LinkOut])
def list_links(category: Optional[str] = None, db=Depends(get_db)):
    if category:
        rows = db.execute(
            "SELECT * FROM links WHERE category = ? ORDER BY title", (category,)
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM links ORDER BY category, title").fetchall()
    return [dict(r) for r in rows]


@router.post("/links", response_model=LinkOut, status_code=201)
def create_link(payload: LinkIn, db=Depends(get_db)):
    link_id = new_id()
    db.execute(
        "INSERT INTO links (id, title, url, category) VALUES (?, ?, ?, ?)",
        (link_id, payload.title, payload.url, payload.category),
    )
    db.commit()

    register_action(
        db,
        description=Texto("log.link.adicionou", "adicionou link: {titulo}", titulo=payload.title),
        categories=["organizacao"],
        xp=XP_LINK_ADD,
        impact=1,
        source="organizacao",
        referencia_tipo="link",
        referencia_id=link_id,
    )

    return {"id": link_id, **payload.model_dump()}


@router.put("/links/{link_id}", response_model=LinkOut)
def update_link(link_id: str, payload: LinkUpdate, db=Depends(get_db)):
    row = db.execute("SELECT * FROM links WHERE id = ?", (link_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.links.link_nao_encontrado", "link não encontrado")

    title = payload.title if payload.title is not None else row["title"]
    url = payload.url if payload.url is not None else row["url"]
    category = payload.category if payload.category is not None else row["category"]

    db.execute(
        "UPDATE links SET title = ?, url = ?, category = ? WHERE id = ?",
        (title, url, category, link_id),
    )
    db.commit()

    return dict(db.execute("SELECT * FROM links WHERE id = ?", (link_id,)).fetchone())


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: str, db=Depends(get_db)):
    row = db.execute("SELECT id FROM links WHERE id = ?", (link_id,)).fetchone()
    if not row:
        raise ErroKami(404, "erro.links.link_nao_encontrado", "link não encontrado")
    db.execute("DELETE FROM links WHERE id = ?", (link_id,))
    db.commit()
    # adicionar e apagar o mesmo link repetidamente não rende xp
    revert_actions(db, "link", link_id)
