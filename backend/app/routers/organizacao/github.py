"""
GitHub: repositórios sincronizados pela API, token pessoal opcional e
importação automática dos repositórios da conta (ver _auto_import_repos).

Parte do módulo Organização (routers/organizacao/__init__.py junta as
partes num router só, montado em /api/organizacao). MAN-02.
"""
from datetime import datetime as dt
import json
import urllib.error
import urllib.request
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id, now_iso
from app.actions import has_action, register_action, revert_actions
from app.crypto import ChaveIndisponivel, encrypt_password, decrypt_password
from app.limites import Entrada

router = APIRouter()

XP_GITHUB_SYNC = 3

# Sync manual credita xp no máximo 1x por dia por repositório/conta —
# sem isso cada clique em "sincronizar" valia xp, e 20 cliques
# desbloqueavam "organizador". A referência do sync é o NOME do
# repositório / o usuário da conta (não o id), pra que remover e
# recadastrar o mesmo item não reabra o limite do dia.

GITHUB_API_BASE = "https://api.github.com/repos/"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_USER_REPOS_URL = "https://api.github.com/user/repos"
# GitHub exige um User-Agent em toda chamada, senão devolve 403
GITHUB_HEADERS = {"User-Agent": "kami-app-local", "Accept": "application/vnd.github+json"}
# paginação da importação automática (GET /user/repos) — 100 é o máximo
# aceito pela api por página; o teto de páginas é só uma trava de
# segurança (2000 repos) contra um loop infinito em caso de resposta
# inesperada, não um limite que se espera bater na prática
GITHUB_REPOS_PER_PAGE = 100
GITHUB_REPOS_MAX_PAGES = 20


class GithubRepoIn(Entrada):
    repo_full_name: str = Field(..., description="formato 'usuario/repositorio'")


class GithubRepoOut(BaseModel):
    id: str
    repo_full_name: str
    cached_status: Optional[dict] = None
    last_synced_at: Optional[str] = None
    sync_error: Optional[str] = None  # não persistido; só informativo na resposta
    source: str = "manual"            # 'manual' (cadastrado à mão) ou 'auto' (importado do token)
    owner_login: Optional[str] = None # login da conta dona do token, só preenchido pra source='auto'

class GithubTokenIn(Entrada):
    token: str


class GithubTokenStatus(BaseModel):
    configured: bool
    # info da importação automática disparada ao salvar o token — todos
    # opcionais porque a validação/salvamento do token em si nunca falha
    # por causa disso (import é best-effort, ver _auto_import_repos)
    imported_count: Optional[int] = None
    removed_count: Optional[int] = None
    owner_login: Optional[str] = None
    import_error: Optional[str] = None


class CommitActivityWeek(BaseModel):
    week_start: str   # ISO date do início da semana (segunda-feira)
    total: int


class CommitActivityOut(BaseModel):
    repo_full_name: str
    weeks: List[CommitActivityWeek]
    error: Optional[str] = None
    computing: bool = False  # True quando o erro é o 202 "github ainda calculando
                              # estatísticas" — sinaliza pro frontend que vale a
                              # pena tentar de novo em instantes, ao contrário de
                              # um erro definitivo (rate limit, sem acesso, etc.)


def _get_github_headers(db) -> dict:
    """
    Monta os headers da chamada à API do GitHub. Se houver um token
    salvo em github_settings, adiciona Authorization e sobe o rate
    limit de 60/h (sem auth) pra 5000/h — e passa a enxergar
    repositórios privados aos quais o token tenha acesso.
    Se não houver token, ou se a decriptação falhar (chave rotacionada,
    dado corrompido), cai de volta pro comportamento público sem auth
    — nunca quebra o fluxo existente por causa disso.
    """
    headers = dict(GITHUB_HEADERS)
    row = db.execute("SELECT token_enc FROM github_settings LIMIT 1").fetchone()
    if row and row["token_enc"]:
        try:
            token = decrypt_password(row["token_enc"])
            headers["Authorization"] = f"Bearer {token}"
        except (ValueError, ChaveIndisponivel):
            pass
    return headers

# ==================== github ====================

def _fetch_github_status(repo_full_name: str, db) -> tuple:
    """
    Chama a API do GitHub (autenticada, se houver token salvo).
    Retorna (status_dict, error_str). Nunca levanta exceção — falha de
    rede/rate-limit/repo inexistente/sem permissão vira um sync_error
    informativo, e o cache antigo (se houver) é preservado.
    """
    headers = _get_github_headers(db)
    req = urllib.request.Request(GITHUB_API_BASE + repo_full_name, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            status = {
                "full_name": data.get("full_name"),
                "description": data.get("description"),
                "stargazers_count": data.get("stargazers_count"),
                "open_issues_count": data.get("open_issues_count"),
                "default_branch": data.get("default_branch"),
                "pushed_at": data.get("pushed_at"),
                "html_url": data.get("html_url"),
                "language": data.get("language"),
                "private": data.get("private", False),
            }
            return status, None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, "repositório não encontrado (privado sem token com acesso, ou nome incorreto)"
        if e.code == 403:
            return None, "rate limit da api do github atingido — configure um token pra 5000 req/h"
        if e.code == 401:
            return None, "token do github inválido ou expirado — reconfigure em configurações"
        return None, f"erro http {e.code} ao consultar github"
    except (urllib.error.URLError, TimeoutError):
        return None, "sem conexão com a api do github no momento"


def _repo_row_to_out(row, sync_error: Optional[str] = None) -> dict:
    return {
        "id": row["id"],
        "repo_full_name": row["repo_full_name"],
        "cached_status": json.loads(row["cached_status"]) if row["cached_status"] else None,
        "last_synced_at": row["last_synced_at"],
        "sync_error": sync_error,
        "source": row["source"] if "source" in row.keys() else "manual",
        "owner_login": row["owner_login"] if "owner_login" in row.keys() else None,
    }


@router.get("/github-repos", response_model=List[GithubRepoOut])
def list_github_repos(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM github_repos ORDER BY repo_full_name").fetchall()
    return [_repo_row_to_out(r) for r in rows]


@router.post("/github-repos", response_model=GithubRepoOut, status_code=201)
def create_github_repo(payload: GithubRepoIn, db=Depends(get_db)):
    existing = db.execute(
        "SELECT id FROM github_repos WHERE repo_full_name = ?", (payload.repo_full_name,)
    ).fetchone()
    if existing:
        raise HTTPException(status_code=422, detail="esse repositório já está cadastrado")

    status, error = _fetch_github_status(payload.repo_full_name, db)
    repo_id = new_id()
    synced_at = now_iso() if status else None
    # cadastro manual (via este endpoint) é sempre source='manual' — a
    # importação automática (ver _auto_import_repos) nunca passa por
    # aqui, insere direto via SQL com source='auto'
    db.execute(
        "INSERT INTO github_repos (id, repo_full_name, cached_status, last_synced_at, source, owner_login) "
        "VALUES (?, ?, ?, ?, 'manual', NULL)",
        (repo_id, payload.repo_full_name, json.dumps(status) if status else None, synced_at),
    )
    db.commit()

    if status:
        register_action(
            db,
            description=f"conectou repositório: {payload.repo_full_name}",
            categories=["organizacao"],
            xp=XP_GITHUB_SYNC,
            impact=1,
            source="organizacao",
            referencia_tipo="github_repo",
            referencia_id=repo_id,
        )

    row = db.execute("SELECT * FROM github_repos WHERE id = ?", (repo_id,)).fetchone()
    return _repo_row_to_out(row, sync_error=error)


@router.put("/github-repos/{repo_id}/sync", response_model=GithubRepoOut)
def sync_github_repo(repo_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM github_repos WHERE id = ?", (repo_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="repositório não encontrado")

    status, error = _fetch_github_status(row["repo_full_name"], db)
    if status:
        db.execute(
            "UPDATE github_repos SET cached_status = ?, last_synced_at = ? WHERE id = ?",
            (json.dumps(status), now_iso(), repo_id),
        )
        db.commit()
        if not has_action(db, "github_sync", row["repo_full_name"], only_today=True):
            register_action(
                db,
                description=f"sincronizou repositório: {row['repo_full_name']}",
                categories=["organizacao"],
                xp=XP_GITHUB_SYNC,
                impact=1,
                source="organizacao",
                referencia_tipo="github_sync",
                referencia_id=row["repo_full_name"],
            )
    # se deu erro, mantém o cache anterior intacto e só informa o erro na resposta

    updated = db.execute("SELECT * FROM github_repos WHERE id = ?", (repo_id,)).fetchone()
    return _repo_row_to_out(updated, sync_error=error)


@router.delete("/github-repos/{repo_id}", status_code=204)
def delete_github_repo(repo_id: str, db=Depends(get_db)):
    row = db.execute("SELECT id FROM github_repos WHERE id = ?", (repo_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="repositório não encontrado")
    db.execute("DELETE FROM github_repos WHERE id = ?", (repo_id,))
    db.commit()
    revert_actions(db, "github_repo", repo_id)


@router.get("/github-token", response_model=GithubTokenStatus)
def get_github_token_status(db=Depends(get_db)):
    row = db.execute("SELECT token_enc FROM github_settings LIMIT 1").fetchone()
    return {"configured": bool(row and row["token_enc"])}


def _fetch_authenticated_user(headers: dict) -> dict:
    """GET /user — devolve o login da conta dona do token. Levanta
    urllib.error.HTTPError/URLError na falha; quem chama decide o que
    fazer (aqui sempre tratado como erro fatal da importação, já que
    sem login não dá pra rotular os repos como 'auto')."""
    req = urllib.request.Request(GITHUB_USER_URL, headers=headers)
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_all_user_repos(headers: dict) -> list:
    """
    GET /user/repos paginado — devolve TODOS os repositórios da conta
    dona do token. type=owner restringe aos repositórios que a própria
    conta possui (exclui repos de organizações/times onde ela é só
    colaboradora), pra bater com "todos os repositórios da conta" e
    manter owner_login consistente em cada repo importado.
    """
    repos = []
    page = 1
    while page <= GITHUB_REPOS_MAX_PAGES:
        url = f"{GITHUB_USER_REPOS_URL}?type=owner&per_page={GITHUB_REPOS_PER_PAGE}&page={page}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            batch = json.loads(resp.read().decode("utf-8"))
        if not isinstance(batch, list) or not batch:
            break
        repos.extend(batch)
        if len(batch) < GITHUB_REPOS_PER_PAGE:
            break
        page += 1
    return repos


def _auto_import_repos(db, token: str) -> dict:
    """
    Importação automática disparada ao salvar o token (conectar OU
    trocar — mesmo fluxo pros dois casos, ver PUT /github-token):

      1. remove todos os repositórios com source='auto' da conta
         ANTERIOR (se houver) — repositórios source='manual' nunca são
         tocados, seja qual for a conta dona.
      2. busca todos os repositórios da conta dona do NOVO token
         (GET /user/repos) e insere cada um como source='auto' com o
         owner_login da conta.
      3. repositórios já cadastrados manualmente com o mesmo
         repo_full_name são pulados na importação (não duplica, e o
         cadastro manual continua sendo o dono daquele nome).

    Best-effort: nunca levanta exceção pra fora — falha de rede/token
    sem permissão de leitura em repos vira import_error informativo, e
    a remoção do passo 1 só é commitada se a busca do passo 2 for bem
    sucedida (senão a pessoa fica sem token novo E sem os repos antigos
    por causa de uma falha de rede passageira).
    """
    headers = {**GITHUB_HEADERS, "Authorization": f"Bearer {token}"}

    try:
        user = _fetch_authenticated_user(headers)
        owner_login = user.get("login")
        if not owner_login:
            return {"imported_count": 0, "removed_count": 0, "owner_login": None,
                     "import_error": "resposta da api do github sem login de usuário"}

        remote_repos = _fetch_all_user_repos(headers)
    except urllib.error.HTTPError as e:
        detail = "token sem permissão de leitura em repositórios" if e.code in (401, 403) else f"erro http {e.code}"
        return {"imported_count": 0, "removed_count": 0, "owner_login": None,
                 "import_error": f"não foi possível importar os repositórios automaticamente ({detail})"}
    except (urllib.error.URLError, TimeoutError):
        return {"imported_count": 0, "removed_count": 0, "owner_login": None,
                 "import_error": "sem conexão com a api do github pra importar os repositórios"}

    # passo 1 — só remove os 'auto' antigos depois que a busca dos novos
    # já deu certo (ver docstring)
    removed = db.execute("DELETE FROM github_repos WHERE source = 'auto'")
    removed_count = removed.rowcount if removed.rowcount and removed.rowcount > 0 else 0

    # nomes já ocupados por cadastro manual — nunca sobrescritos/duplicados
    manual_names = {
        r["repo_full_name"]
        for r in db.execute("SELECT repo_full_name FROM github_repos WHERE source = 'manual'").fetchall()
    }

    imported_count = 0
    now = now_iso()
    for repo in remote_repos:
        full_name = repo.get("full_name")
        if not full_name or full_name in manual_names:
            continue
        status = {
            "full_name": repo.get("full_name"),
            "description": repo.get("description"),
            "stargazers_count": repo.get("stargazers_count"),
            "open_issues_count": repo.get("open_issues_count"),
            "default_branch": repo.get("default_branch"),
            "pushed_at": repo.get("pushed_at"),
            "html_url": repo.get("html_url"),
            "language": repo.get("language"),
            "private": repo.get("private", False),
        }
        db.execute(
            "INSERT INTO github_repos (id, repo_full_name, cached_status, last_synced_at, source, owner_login) "
            "VALUES (?, ?, ?, ?, 'auto', ?)",
            (new_id(), full_name, json.dumps(status), now, owner_login),
        )
        imported_count += 1

    db.commit()

    if imported_count:
        register_action(
            db,
            description=f"importou {imported_count} repositório(s) automaticamente do github ({owner_login})",
            categories=["organizacao"],
            xp=XP_GITHUB_SYNC,
            impact=1,
            source="organizacao",
        )

    return {"imported_count": imported_count, "removed_count": removed_count,
             "owner_login": owner_login, "import_error": None}


@router.put("/github-token", response_model=GithubTokenStatus)
def save_github_token(payload: GithubTokenIn, db=Depends(get_db)):
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=422, detail="token vazio")

    # valida o token contra a api antes de salvar — evita salvar lixo
    # e só descobrir na próxima sincronização de repo
    req = urllib.request.Request(
        "https://api.github.com/rate_limit",
        headers={**GITHUB_HEADERS, "Authorization": f"Bearer {token}"},
    )
    try:
        urllib.request.urlopen(req, timeout=8)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise HTTPException(status_code=422, detail="token inválido ou sem permissão")
        raise HTTPException(status_code=422, detail=f"erro ao validar token (http {e.code})")
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(status_code=422, detail="sem conexão com a api do github pra validar o token")

    enc = encrypt_password(token)
    existing = db.execute("SELECT id FROM github_settings LIMIT 1").fetchone()
    if existing:
        db.execute(
            "UPDATE github_settings SET token_enc = ?, updated_at = ? WHERE id = ?",
            (enc, now_iso(), existing["id"]),
        )
    else:
        db.execute(
            "INSERT INTO github_settings (id, token_enc, updated_at) VALUES (?, ?, ?)",
            (new_id(), enc, now_iso()),
        )
    db.commit()

    # importação automática — tanto pra "conectar" (github_settings
    # ainda não existia) quanto pra "trocar" (já existia um token
    # configurado) o fluxo é o mesmo: limpa os 'auto' antigos e importa
    # os da conta do novo token (ver _auto_import_repos)
    import_result = _auto_import_repos(db, token)

    return {"configured": True, **import_result}


@router.delete("/github-token", status_code=204)
def delete_github_token(db=Depends(get_db)):
    db.execute("DELETE FROM github_settings")
    db.commit()


@router.get("/github-repos/{repo_id}/commit-activity", response_model=CommitActivityOut)
def get_commit_activity(repo_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM github_repos WHERE id = ?", (repo_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="repositório não encontrado")

    try:
        headers = _get_github_headers(db)
        url = f"{GITHUB_API_BASE}{row['repo_full_name']}/stats/commit_activity"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 202:
                return {"repo_full_name": row["repo_full_name"], "weeks": [], "computing": True,
                         "error": "github ainda calculando estatísticas — tente de novo em instantes"}
            data = json.loads(resp.read().decode("utf-8"))

        if not isinstance(data, list):
            return {"repo_full_name": row["repo_full_name"], "weeks": [], "error": "resposta inesperada da api do github"}

        weeks = []
        for w in data[-10:]:
            try:
                weeks.append({
                    "week_start": dt.utcfromtimestamp(w["week"]).date().isoformat(),
                    "total": w["total"],
                })
            except (KeyError, TypeError, ValueError):
                continue

        return {"repo_full_name": row["repo_full_name"], "weeks": weeks, "error": None}

    except urllib.error.HTTPError as e:
        return {"repo_full_name": row["repo_full_name"], "weeks": [], "error": f"erro http {e.code} ao buscar atividade de commits"}
    except (urllib.error.URLError, TimeoutError):
        return {"repo_full_name": row["repo_full_name"], "weeks": [], "error": "sem conexão com a api do github no momento"}
    except Exception as e:
        return {"repo_full_name": row["repo_full_name"], "weeks": [], "error": f"erro inesperado: {e}"}
