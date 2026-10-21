"""
Caixa de entrada da captura rápida (ORG-02).

  GET    /api/organizacao/entrada              itens, mais recentes primeiro
  POST   /api/organizacao/entrada              guarda um texto
  DELETE /api/organizacao/entrada/{id}         descarta (ou: já virou outra coisa)
  POST   /api/organizacao/entrada/{id}/tarefa  vira item "- [ ] texto" na nota
                                               "tarefas" (criada e fixada se não
                                               existir) e sai da entrada

Gasto, nota, meta e evento são criados pelos formulários de sempre (o
frontend abre já preenchido — components/captura.js) e o item é
apagado depois que o formulário salva. Capturar não rende xp: o xp vem
do que o item virar.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id, now_iso
from app.limites import Entrada

router = APIRouter()

NOTA_TAREFAS = "tarefas"


class EntradaIn(Entrada):
    texto: str = Field(..., min_length=1, max_length=2000)


class EntradaOut(BaseModel):
    id: str
    texto: str
    criado_em: str


class TarefaOut(BaseModel):
    nota_id: str


def _item(db, item_id: str):
    row = db.execute("SELECT * FROM caixa_entrada WHERE id = ?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="item não encontrado na caixa de entrada")
    return row


@router.get("", response_model=List[EntradaOut])
def listar(db=Depends(get_db)):
    return [dict(r) for r in db.execute("SELECT * FROM caixa_entrada ORDER BY criado_em DESC, rowid DESC")]


@router.post("", response_model=EntradaOut, status_code=201)
def guardar(payload: EntradaIn, db=Depends(get_db)):
    texto = payload.texto.strip()
    if not texto:
        raise HTTPException(status_code=422, detail="texto vazio")
    item = {"id": new_id(), "texto": texto, "criado_em": now_iso()}
    db.execute("INSERT INTO caixa_entrada (id, texto, criado_em) VALUES (:id, :texto, :criado_em)", item)
    db.commit()
    return item


@router.delete("/{item_id}", status_code=204)
def descartar(item_id: str, db=Depends(get_db)):
    _item(db, item_id)
    db.execute("DELETE FROM caixa_entrada WHERE id = ?", (item_id,))
    db.commit()


@router.post("/{item_id}/tarefa", response_model=TarefaOut)
def virar_tarefa(item_id: str, db=Depends(get_db)):
    item = _item(db, item_id)
    linha = "- [ ] " + " ".join(item["texto"].split())
    nota = db.execute(
        "SELECT id, conteudo FROM notas WHERE lower(titulo) = ? AND trancada = 0 AND arquivada = 0 "
        "ORDER BY criada_em LIMIT 1",
        (NOTA_TAREFAS,),
    ).fetchone()
    agora = now_iso()
    if nota:
        conteudo = nota["conteudo"].rstrip()
        # junta na lista que já existe (sem linha em branco no meio)
        conteudo = f"{conteudo}\n{linha}" if conteudo else linha
        db.execute("UPDATE notas SET conteudo = ?, atualizada_em = ? WHERE id = ?", (conteudo, agora, nota["id"]))
        nota_id = nota["id"]
    else:
        nota_id = new_id()
        db.execute(
            "INSERT INTO notas (id, titulo, conteudo, fixada, criada_em, atualizada_em) VALUES (?, ?, ?, 1, ?, ?)",
            (nota_id, NOTA_TAREFAS, linha, agora, agora),
        )
    db.execute("DELETE FROM caixa_entrada WHERE id = ?", (item_id,))
    db.commit()
    return {"nota_id": nota_id}
