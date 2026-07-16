"""
Módulo Organização (v1).

Três fontes, conforme decisão de arquitetura:
  - links:  cadastro simples, agrupado por categoria (CRUD puro, sem API externa)
  - github: 1+ repositórios, status sincronizado via API pública do GitHub
            (sem autenticação — só repositórios públicos, rate limit de 60 req/h
            por IP no v1; se isso for um problema, decisão futura é adicionar
            um token pessoal via header Authorization)
  - email:  1+ contas IMAP reais, sem resumo por IA no v1 (campo summary_text
            fica reservado pro pós-mvp); senha de app guardada criptografada
            (ver app/crypto.py)

A busca rápida (org-search no mockup) é resolvida 100% no frontend
(chamada direta à Instant Answer API do DuckDuckGo) — não precisa de
endpoint de backend, então não está neste router.

Endpoints:
  GET    /api/organizacao/links                    lista links (filtro opcional por categoria)
  POST   /api/organizacao/links                     cria link
  DELETE /api/organizacao/links/{id}                remove link

  GET    /api/organizacao/github-repos              lista repos cadastrados (com cache atual)
  POST   /api/organizacao/github-repos              cadastra repo + sincroniza na hora
  PUT    /api/organizacao/github-repos/{id}/sync    força resync do status
  DELETE /api/organizacao/github-repos/{id}         remove repo

  GET    /api/organizacao/email-accounts            lista contas (nunca devolve a senha)
  POST   /api/organizacao/email-accounts            cadastra conta (senha vai criptografada)
  PUT    /api/organizacao/email-accounts/{id}       edita conta (todos os campos opcionais —
                                                     só reescreve o que vier no payload; se
                                                     app_password vier, recriptografa e troca;
                                                     se não vier, mantém a senha salva)
  DELETE /api/organizacao/email-accounts/{id}       remove conta (cache junto, CASCADE)
  POST   /api/organizacao/email-accounts/{id}/sync  conecta via IMAP e atualiza o cache

  GET    /api/organizacao/email-cache               lista e-mails em cache (filtro por account_id/is_read)
  PUT    /api/organizacao/email-cache/{id}/read      marca e-mail como lido

Regras de negócio / XP (mesmo padrão do financas.py — ação automática
credita XP pequeno em 'organizacao'; ajuste os valores se não for o
comportamento esperado):
  - adicionar um link:            +2xp
  - sincronizar e-mail com sucesso: +3xp (1x por chamada de sync, não por e-mail novo)
  - sincronizar repo do github:    +2xp
  - editar uma conta de e-mail:   sem XP (não é uma "ação" nova, é manutenção)
"""
import email as email_lib
import imaplib
import json
import urllib.error
import urllib.request
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import get_db, new_id, now_iso
from app.actions import register_action
from app.crypto import encrypt_password, decrypt_password

router = APIRouter()

XP_LINK_ADD    = 2
XP_GITHUB_SYNC = 2
XP_EMAIL_SYNC  = 3

GITHUB_API_BASE = "https://api.github.com/repos/"
# GitHub exige um User-Agent em toda chamada, senão devolve 403
GITHUB_HEADERS = {"User-Agent": "kami-app-local", "Accept": "application/vnd.github+json"}

# tamanho máximo do trecho de corpo guardado por e-mail — texto puro,
# já achatado (sem quebras de linha) e truncado; nunca o corpo original.
BODY_PREVIEW_MAX_LEN = 280


# ==================== schemas ====================

class LinkIn(BaseModel):
    title: str
    url: str
    category: str


class LinkOut(LinkIn):
    id: str


class GithubRepoIn(BaseModel):
    repo_full_name: str = Field(..., description="formato 'usuario/repositorio'")


class GithubRepoOut(BaseModel):
    id: str
    repo_full_name: str
    cached_status: Optional[dict] = None
    last_synced_at: Optional[str] = None
    sync_error: Optional[str] = None  # não persistido; só informativo na resposta


class EmailAccountIn(BaseModel):
    label: str
    imap_host: str
    imap_port: int = 993
    username: str
    app_password: str  # texto puro só no payload de entrada; nunca guardado assim


class EmailAccountUpdate(BaseModel):
    """
    Todos os campos opcionais — é um PATCH-like via PUT (só reescreve o
    que vier no payload). app_password só é recriptografado/trocado se
    vier preenchido; se vier None/omitido, a senha salva permanece a
    mesma (não obriga o usuário a redigitar a senha só pra trocar o
    apelido, por exemplo).
    """
    label: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    username: Optional[str] = None
    app_password: Optional[str] = None


class EmailAccountOut(BaseModel):
    id: str
    label: str
    imap_host: str
    imap_port: int
    username: str
    # app_password_enc propositalmente omitido — nunca sai da API


class EmailSyncResult(BaseModel):
    account_id: str
    new_messages: int
    synced_at: str


class EmailCacheOut(BaseModel):
    id: str
    account_id: str
    subject: str
    sender: str
    received_at: str
    is_read: bool
    summary_text: Optional[str] = None
    body_preview: Optional[str] = None


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
        description=f"adicionou link: {payload.title}",
        categories=["organizacao"],
        xp=XP_LINK_ADD,
        impact=1,
        source="organizacao",
    )

    return {"id": link_id, **payload.model_dump()}


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: str, db=Depends(get_db)):
    row = db.execute("SELECT id FROM links WHERE id = ?", (link_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="link não encontrado")
    db.execute("DELETE FROM links WHERE id = ?", (link_id,))
    db.commit()


# ==================== github ====================

def _fetch_github_status(repo_full_name: str) -> tuple:
    """
    Chama a API pública do GitHub. Retorna (status_dict, error_str).
    Nunca levanta exceção — falha de rede/rate-limit/repo inexistente
    vira um sync_error informativo, e o cache antigo (se houver) é preservado.
    """
    req = urllib.request.Request(GITHUB_API_BASE + repo_full_name, headers=GITHUB_HEADERS)
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
            }
            return status, None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, "repositório não encontrado (verifique se é público e o nome está correto)"
        if e.code == 403:
            return None, "rate limit da api pública do github atingido (60 req/h sem token) — tente de novo mais tarde"
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

    status, error = _fetch_github_status(payload.repo_full_name)
    repo_id = new_id()
    synced_at = now_iso() if status else None
    db.execute(
        "INSERT INTO github_repos (id, repo_full_name, cached_status, last_synced_at) VALUES (?, ?, ?, ?)",
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
        )

    row = db.execute("SELECT * FROM github_repos WHERE id = ?", (repo_id,)).fetchone()
    return _repo_row_to_out(row, sync_error=error)


@router.put("/github-repos/{repo_id}/sync", response_model=GithubRepoOut)
def sync_github_repo(repo_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM github_repos WHERE id = ?", (repo_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="repositório não encontrado")

    status, error = _fetch_github_status(row["repo_full_name"])
    if status:
        db.execute(
            "UPDATE github_repos SET cached_status = ?, last_synced_at = ? WHERE id = ?",
            (json.dumps(status), now_iso(), repo_id),
        )
        db.commit()
        register_action(
            db,
            description=f"sincronizou repositório: {row['repo_full_name']}",
            categories=["organizacao"],
            xp=XP_GITHUB_SYNC,
            impact=1,
            source="organizacao",
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


# ==================== e-mail (imap) ====================

def _decode_mime_words(s: str) -> str:
    if not s:
        return ""
    parts = decode_header(s)
    decoded = ""
    for text, charset in parts:
        if isinstance(text, bytes):
            decoded += text.decode(charset or "utf-8", errors="replace")
        else:
            decoded += text
    return decoded


def _extract_body_preview(msg, max_len: int = BODY_PREVIEW_MAX_LEN) -> Optional[str]:
    """
    Extrai um trecho em TEXTO PURO do corpo do e-mail — nunca HTML.

    Só lê a parte text/plain (ignora text/html de propósito, e não faz
    nenhum parsing/strip de HTML aqui): não queremos guardar nem
    renderizar HTML de e-mails de terceiros — a maioria dos e-mails de
    marketing/spam abusa de HTML com tracking, e o frontend NUNCA deve
    fazer innerHTML direto do corpo de um e-mail recebido. Se só existir
    text/html (sem alternativa em texto puro), devolve None — sem prévia
    é mais seguro do que arriscar mostrar/guardar HTML bruto.
    """
    body = None
    if msg.is_multipart():
        for part in msg.walk():
            content_disposition = str(part.get("Content-Disposition", ""))
            if part.get_content_type() == "text/plain" and "attachment" not in content_disposition:
                try:
                    payload = part.get_payload(decode=True)
                    if payload is None:
                        continue
                    charset = part.get_content_charset() or "utf-8"
                    body = payload.decode(charset, errors="replace")
                except Exception:
                    continue
                break
    else:
        if msg.get_content_type() == "text/plain":
            try:
                payload = msg.get_payload(decode=True)
                if payload is not None:
                    charset = msg.get_content_charset() or "utf-8"
                    body = payload.decode(charset, errors="replace")
            except Exception:
                body = None

    if not body:
        return None

    flat = " ".join(body.split())  # achata quebras de linha/espaços repetidos
    if not flat:
        return None
    return flat[:max_len] + ("…" if len(flat) > max_len else "")


@router.get("/email-accounts", response_model=List[EmailAccountOut])
def list_email_accounts(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM email_accounts ORDER BY label").fetchall()
    return [
        {
            "id": r["id"], "label": r["label"], "imap_host": r["imap_host"],
            "imap_port": r["imap_port"], "username": r["username"],
        }
        for r in rows
    ]


@router.post("/email-accounts", response_model=EmailAccountOut, status_code=201)
def create_email_account(payload: EmailAccountIn, db=Depends(get_db)):
    account_id = new_id()
    enc_password = encrypt_password(payload.app_password)
    db.execute(
        "INSERT INTO email_accounts (id, label, imap_host, imap_port, username, app_password_enc) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (account_id, payload.label, payload.imap_host, payload.imap_port, payload.username, enc_password),
    )
    db.commit()
    return {
        "id": account_id, "label": payload.label, "imap_host": payload.imap_host,
        "imap_port": payload.imap_port, "username": payload.username,
    }


@router.put("/email-accounts/{account_id}", response_model=EmailAccountOut)
def update_email_account(account_id: str, payload: EmailAccountUpdate, db=Depends(get_db)):
    row = db.execute("SELECT * FROM email_accounts WHERE id = ?", (account_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="conta de e-mail não encontrada")

    label = payload.label if payload.label is not None else row["label"]
    imap_host = payload.imap_host if payload.imap_host is not None else row["imap_host"]
    imap_port = payload.imap_port if payload.imap_port is not None else row["imap_port"]
    username = payload.username if payload.username is not None else row["username"]
    app_password_enc = (
        encrypt_password(payload.app_password) if payload.app_password else row["app_password_enc"]
    )

    db.execute(
        "UPDATE email_accounts SET label = ?, imap_host = ?, imap_port = ?, username = ?, "
        "app_password_enc = ? WHERE id = ?",
        (label, imap_host, imap_port, username, app_password_enc, account_id),
    )
    db.commit()

    return {
        "id": account_id, "label": label, "imap_host": imap_host,
        "imap_port": imap_port, "username": username,
    }


@router.delete("/email-accounts/{account_id}", status_code=204)
def delete_email_account(account_id: str, db=Depends(get_db)):
    row = db.execute("SELECT id FROM email_accounts WHERE id = ?", (account_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="conta de e-mail não encontrada")
    db.execute("DELETE FROM email_accounts WHERE id = ?", (account_id,))
    db.commit()


@router.post("/email-accounts/{account_id}/sync", response_model=EmailSyncResult)
def sync_email_account(account_id: str, db=Depends(get_db), limit: int = 20):
    account = db.execute("SELECT * FROM email_accounts WHERE id = ?", (account_id,)).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="conta de e-mail não encontrada")

    try:
        plain_password = decrypt_password(account["app_password_enc"])
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="não foi possível decriptar a senha salva; remova e recadastre a conta",
        )

    try:
        imap = imaplib.IMAP4_SSL(account["imap_host"], account["imap_port"])
        imap.login(account["username"], plain_password)
        imap.select("INBOX")
    except imaplib.IMAP4.error:
        raise HTTPException(
            status_code=422,
            detail="falha ao autenticar no imap; verifique host/porta/usuário/senha de app",
        )
    except OSError:
        raise HTTPException(status_code=422, detail="não foi possível conectar ao servidor imap")

    try:
        status, msg_ids = imap.search(None, "ALL")
        ids = msg_ids[0].split()[-limit:] if msg_ids and msg_ids[0] else []

        new_count = 0
        for mid in reversed(ids):
            status, msg_data = imap.fetch(mid, "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            msg = email_lib.message_from_bytes(msg_data[0][1])

            subject = _decode_mime_words(msg.get("Subject", ""))
            sender = _decode_mime_words(msg.get("From", ""))
            date_hdr = msg.get("Date")
            try:
                received_at = parsedate_to_datetime(date_hdr).isoformat() if date_hdr else now_iso()
            except (TypeError, ValueError):
                received_at = now_iso()

            # dedupe simples (sem message_id no schema v1): mesmo assunto +
            # remetente + data já em cache pra essa conta = já sincronizado
            dup = db.execute(
                "SELECT id FROM email_cache WHERE account_id = ? AND subject = ? "
                "AND sender = ? AND received_at = ?",
                (account_id, subject, sender, received_at),
            ).fetchone()
            if dup:
                continue

            body_preview = _extract_body_preview(msg)

            db.execute(
                "INSERT INTO email_cache "
                "(id, account_id, subject, sender, received_at, is_read, summary_text, body_preview) "
                "VALUES (?, ?, ?, ?, ?, 0, NULL, ?)",
                (new_id(), account_id, subject, sender, received_at, body_preview),
            )
            new_count += 1
        db.commit()
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    register_action(
        db,
        description=f"sincronizou e-mail: {account['label']}",
        categories=["organizacao"],
        xp=XP_EMAIL_SYNC,
        impact=1,
        source="organizacao",
    )

    return {"account_id": account_id, "new_messages": new_count, "synced_at": now_iso()}


@router.get("/email-cache", response_model=List[EmailCacheOut])
def list_email_cache(
    account_id: Optional[str] = None,
    is_read: Optional[bool] = None,
    db=Depends(get_db),
):
    query = "SELECT * FROM email_cache"
    conditions, args = [], []
    if account_id:
        conditions.append("account_id = ?")
        args.append(account_id)
    if is_read is not None:
        conditions.append("is_read = ?")
        args.append(int(is_read))
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY received_at DESC"

    rows = db.execute(query, args).fetchall()
    return [dict(r) | {"is_read": bool(r["is_read"])} for r in rows]


@router.put("/email-cache/{cache_id}/read", response_model=EmailCacheOut)
def mark_email_read(cache_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM email_cache WHERE id = ?", (cache_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="e-mail não encontrado no cache")
    db.execute("UPDATE email_cache SET is_read = 1 WHERE id = ?", (cache_id,))
    db.commit()
    updated = db.execute("SELECT * FROM email_cache WHERE id = ?", (cache_id,)).fetchone()
    return dict(updated) | {"is_read": bool(updated["is_read"])}