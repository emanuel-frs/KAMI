"""
Busca rápida pela API da Tavily (chave pessoal opcional, guardada
cifrada; sem chave, 422 e o frontend abre o DuckDuckGo).

Parte do módulo Organização (routers/organizacao/__init__.py junta as
partes num router só, montado em /api/organizacao). MAN-02.
"""
import json
import urllib.error
import urllib.request
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db, new_id, now_iso
from app.crypto import encrypt_password, decrypt_password
from app.limites import Entrada

router = APIRouter()

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
# quantos resultados a tavily devolve por busca — painel mostra resumo
# em destaque + uma lista curta (ajustado após
# feedback: resumo sozinho já respondia buscas simples e a lista de 6
# ficava repetitiva)
SEARCH_RESULT_MAX = 3


class SearchApiKeyIn(Entrada):
    api_key: str


class SearchApiKeyStatus(BaseModel):
    configured: bool


class SearchResultItem(BaseModel):
    title: str
    url: str
    snippet: Optional[str] = None


class SearchOut(BaseModel):
    query: str
    answer: Optional[str] = None   # resumo pronto que a tavily já devolve (include_answer)
    results: List[SearchResultItem]


# ==================== busca (tavily) ====================
# resumo inline da busca no lugar de só abrir
# o duckduckgo em nova aba. Mesmo padrão de config opcional-mas-
# obrigatória-pra-funcionar do token do github: sem chave salva, o
# endpoint /search devolve 422 e o frontend cai pro link externo.

def _tavily_request(body: dict, timeout: int = 8):
    """POST cru pra api da tavily. Nunca decide o que fazer com o erro
    aqui — cada chamador trata HTTPError/URLError do jeito que fizer
    sentido pro contexto (validar chave vs. rodar busca de verdade)."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        TAVILY_SEARCH_URL, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


@router.get("/search-key", response_model=SearchApiKeyStatus)
def get_search_key_status(db=Depends(get_db)):
    row = db.execute("SELECT api_key_enc FROM search_settings LIMIT 1").fetchone()
    return {"configured": bool(row and row["api_key_enc"])}


@router.put("/search-key", response_model=SearchApiKeyStatus)
def save_search_key(payload: SearchApiKeyIn, db=Depends(get_db)):
    api_key = payload.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=422, detail="chave vazia")

    # valida a chave com uma busca mínima antes de salvar — evita salvar
    # lixo e só descobrir na próxima vez que a pessoa tentar buscar algo
    try:
        _tavily_request({"api_key": api_key, "query": "teste", "max_results": 1})
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise HTTPException(status_code=422, detail="chave inválida ou sem permissão")
        raise HTTPException(status_code=422, detail=f"erro ao validar chave (http {e.code})")
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(status_code=422, detail="sem conexão com a api da tavily pra validar a chave")

    enc = encrypt_password(api_key)
    existing = db.execute("SELECT id FROM search_settings LIMIT 1").fetchone()
    if existing:
        db.execute(
            "UPDATE search_settings SET api_key_enc = ?, updated_at = ? WHERE id = ?",
            (enc, now_iso(), existing["id"]),
        )
    else:
        db.execute(
            "INSERT INTO search_settings (id, api_key_enc, updated_at) VALUES (?, ?, ?)",
            (new_id(), enc, now_iso()),
        )
    db.commit()
    return {"configured": True}


@router.delete("/search-key", status_code=204)
def delete_search_key(db=Depends(get_db)):
    db.execute("DELETE FROM search_settings")
    db.commit()


@router.get("/search", response_model=SearchOut)
def search_web(q: str, db=Depends(get_db)):
    q = q.strip()
    if not q:
        raise HTTPException(status_code=422, detail="busca vazia")

    row = db.execute("SELECT api_key_enc FROM search_settings LIMIT 1").fetchone()
    if not row or not row["api_key_enc"]:
        raise HTTPException(status_code=422, detail="nenhuma chave de busca configurada — cadastre uma chave da tavily em organização")
    try:
        api_key = decrypt_password(row["api_key_enc"])
    except ValueError:
        raise HTTPException(status_code=422, detail="chave de busca corrompida — reconfigure a chave")

    try:
        data = _tavily_request(
            {"api_key": api_key, "query": q, "include_answer": True, "max_results": SEARCH_RESULT_MAX},
            timeout=10,
        )
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise HTTPException(status_code=422, detail="chave de busca inválida — reconfigure a chave")
        if e.code in (429, 432):
            raise HTTPException(status_code=422, detail="limite mensal de buscas gratuitas atingido")
        raise HTTPException(status_code=502, detail=f"erro http {e.code} na api de busca")
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(status_code=502, detail="sem conexão com a api de busca no momento")

    results = []
    for item in (data.get("results") or [])[:SEARCH_RESULT_MAX]:
        if not item.get("url"):
            continue
        results.append({
            "title": item.get("title") or item["url"],
            "url": item["url"],
            "snippet": item.get("content"),
        })

    return {"query": q, "answer": data.get("answer") or None, "results": results}
