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

A busca rápida (org-search no mockup, ver ALINHAMENTO.md 4.1) usa a
API da Tavily (https://tavily.com) — free tier real (1000
créditos/mês, sem cartão), e já devolve um "answer" resumido pronto
além dos links, o que evita ter que montar esse resumo aqui a partir
de snippets crus. A chave é pessoal (cadastro gratuito do usuário) e
fica guardada criptografada em search_settings (mesmo esquema do
token do github/senha de app do IMAP — ver app/crypto.py); sem chave
configurada, o endpoint devolve 422 e o frontend cai pro link "abrir
no duckduckgo" como antes.

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

  GET    /api/organizacao/email-cache               lista e-mails em cache (filtro por account_id/is_read/
                                                     exclude_muted)
  PUT    /api/organizacao/email-cache/{id}/read      marca e-mail como lido

  GET    /api/organizacao/muted-accounts            lista contas de e-mail silenciadas
  POST   /api/organizacao/muted-accounts             silencia uma conta inteira (idempotente)
  DELETE /api/organizacao/muted-accounts/{id}        dessilencia (remove da lista)

  GET    /api/organizacao/search-key                status da chave da tavily (nunca devolve a chave)
  PUT    /api/organizacao/search-key                 cadastra/troca a chave (valida contra a api antes de salvar)
  DELETE /api/organizacao/search-key                 remove a chave
  GET    /api/organizacao/search?q=...               busca via tavily — resumo + lista de resultados

Regras de negócio / XP (mesmo padrão do financas.py — ação automática
credita XP pequeno em 'organizacao'; ajuste os valores se não for o
comportamento esperado):
  - adicionar um link:            +2xp
  - sincronizar e-mail com sucesso: +3xp (1x por chamada de sync, não por e-mail novo)
  - sincronizar repo do github:    +2xp
  - editar uma conta de e-mail:   sem XP (não é uma "ação" nova, é manutenção)
"""
from datetime import datetime as dt
import email as email_lib
import imaplib
import json
import sqlite3
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

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
# quantos resultados a tavily devolve por busca — painel mostra resumo
# em destaque + uma lista curta (ver ALINHAMENTO.md 4.1, ajustado após
# feedback: resumo sozinho já respondia buscas simples e a lista de 6
# ficava repetitiva)
SEARCH_RESULT_MAX = 3

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

class GithubTokenIn(BaseModel):
    token: str


class GithubTokenStatus(BaseModel):
    configured: bool


class CommitActivityWeek(BaseModel):
    week_start: str   # ISO date do início da semana (segunda-feira)
    total: int


class CommitActivityOut(BaseModel):
    repo_full_name: str
    weeks: List[CommitActivityWeek]
    error: Optional[str] = None


class SearchApiKeyIn(BaseModel):
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

class EmailAccountIn(BaseModel):
    label: str
    imap_host: str
    imap_port: int = 993
    username: str
    app_password: str  # texto puro só no payload de entrada; nunca guardado assim
    sync_by_default: bool = True  # redesign da aba e-mail (secao 3.1) — controla se a conta
                                    # já nasce selecionada na visualização combinada


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
    sync_by_default: Optional[bool] = None


class EmailAccountOut(BaseModel):
    id: str
    label: str
    imap_host: str
    imap_port: int
    username: str
    sync_by_default: bool = True
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
    is_muted: bool = False  # calculado via lookup contra muted_accounts — não persistido no cache


class MutedAccountIn(BaseModel):
    account_id: str


class MutedAccountOut(BaseModel):
    id: str
    account_id: str
    muted_at: str


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
        except ValueError:
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

    status, error = _fetch_github_status(row["repo_full_name"], db)
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
            # "unknown-8bit" (e qualquer outro nome de charset inválido/não
            # suportado) não é um codec python de verdade — é só o marcador
            # que email.header.decode_header devolve pra bytes >127 sem
            # charset declarado no header (RFC 2047 não cobre esse caso).
            # Chamar .decode("unknown-8bit") sempre estoura LookupError:
            # unknown encoding, e isso derrubava a sincronização inteira
            # por causa de UM único header malformado (visto nos logs).
            # latin-1 nunca falha — mapeia byte a byte pros primeiros 256
            # codepoints Unicode — então é o fallback mais seguro pra não
            # perder o e-mail inteiro por um charset que o Python não conhece.
            try:
                decoded += text.decode(charset or "utf-8", errors="replace")
            except LookupError:
                decoded += text.decode("latin-1", errors="replace")
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
            "sync_by_default": bool(r["sync_by_default"]),
        }
        for r in rows
    ]


@router.post("/email-accounts", response_model=EmailAccountOut, status_code=201)
def create_email_account(payload: EmailAccountIn, db=Depends(get_db)):
    account_id = new_id()
    enc_password = encrypt_password(payload.app_password)
    db.execute(
        "INSERT INTO email_accounts (id, label, imap_host, imap_port, username, app_password_enc, sync_by_default) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (account_id, payload.label, payload.imap_host, payload.imap_port, payload.username, enc_password, int(payload.sync_by_default)),
    )
    db.commit()
    return {
        "id": account_id, "label": payload.label, "imap_host": payload.imap_host,
        "imap_port": payload.imap_port, "username": payload.username,
        "sync_by_default": payload.sync_by_default,
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
    sync_by_default = (
        payload.sync_by_default if payload.sync_by_default is not None else bool(row["sync_by_default"])
    )

    db.execute(
        "UPDATE email_accounts SET label = ?, imap_host = ?, imap_port = ?, username = ?, "
        "app_password_enc = ?, sync_by_default = ? WHERE id = ?",
        (label, imap_host, imap_port, username, app_password_enc, int(sync_by_default), account_id),
    )
    db.commit()

    return {
        "id": account_id, "label": label, "imap_host": imap_host,
        "imap_port": imap_port, "username": username,
        "sync_by_default": sync_by_default,
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

    # Busca e parseia todas as mensagens ANTES de tocar no banco — isso é
    # puramente IMAP/rede (lento, cada .fetch() é um round-trip), sem
    # nenhuma escrita no sqlite intercalada. Antes o INSERT de cada
    # mensagem rolava dentro do mesmo loop dos .fetch(): como o sqlite abre
    # a transação de escrita já no primeiro INSERT e só libera no commit()
    # no final do loop inteiro, a conexão ficava seguns segundos (às vezes
    # dezenas, a depender de quantos e-mails e da latência do servidor
    # IMAP) com uma transação de escrita aberta — e com várias contas
    # sincronizando ao mesmo tempo (scheduler roda todas em paralelo, ver
    # email-sync-scheduler.js), outras conexões esbarravam nesse lock e
    # estouravam "database is locked". Juntando as mensagens aqui em
    # memória primeiro, a parte que efetivamente escreve fica pequena e
    # rápida (só sqlite local, sem I/O de rede no meio).
    try:
        status, msg_ids = imap.search(None, "ALL")
        ids = msg_ids[0].split()[-limit:] if msg_ids and msg_ids[0] else []

        parsed_messages = []
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

            parsed_messages.append((subject, sender, received_at, _extract_body_preview(msg)))
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    # Só agora abre a transação de escrita — dedupe + insert de tudo que
    # veio do IMAP, sem nenhuma chamada de rede no meio.
    new_count = 0
    try:
        for subject, sender, received_at, body_preview in parsed_messages:
            # dedupe simples (sem message_id no schema v1): mesmo assunto +
            # remetente + data já em cache pra essa conta = já sincronizado
            dup = db.execute(
                "SELECT id FROM email_cache WHERE account_id = ? AND subject = ? "
                "AND sender = ? AND received_at = ?",
                (account_id, subject, sender, received_at),
            ).fetchone()
            if dup:
                continue

            db.execute(
                "INSERT INTO email_cache "
                "(id, account_id, subject, sender, received_at, is_read, summary_text, body_preview) "
                "VALUES (?, ?, ?, ?, ?, 0, NULL, ?)",
                (new_id(), account_id, subject, sender, received_at, body_preview),
            )
            new_count += 1
        db.commit()
    except sqlite3.OperationalError as exc:
        db.rollback()
        if "locked" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="banco de dados ocupado por outra sincronização; tente novamente em alguns segundos",
            )
        raise

    register_action(
        db,
        description=f"sincronizou e-mail: {account['label']}",
        categories=["organizacao"],
        xp=XP_EMAIL_SYNC,
        impact=1,
        source="organizacao",
    )

    return {"account_id": account_id, "new_messages": new_count, "synced_at": now_iso()}


def _muted_account_set(db) -> set:
    rows = db.execute("SELECT account_id FROM muted_accounts").fetchall()
    return {r["account_id"] for r in rows}


@router.get("/email-cache", response_model=List[EmailCacheOut])
def list_email_cache(
    account_id: Optional[str] = None,
    is_read: Optional[bool] = None,
    exclude_muted: bool = False,
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
    muted = _muted_account_set(db)
    out = [dict(r) | {"is_read": bool(r["is_read"]), "is_muted": r["account_id"] in muted} for r in rows]
    if exclude_muted:
        out = [e for e in out if not e["is_muted"]]
    return out


@router.put("/email-cache/{cache_id}/read", response_model=EmailCacheOut)
def mark_email_read(cache_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM email_cache WHERE id = ?", (cache_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="e-mail não encontrado no cache")
    db.execute("UPDATE email_cache SET is_read = 1 WHERE id = ?", (cache_id,))
    db.commit()
    updated = db.execute("SELECT * FROM email_cache WHERE id = ?", (cache_id,)).fetchone()
    muted = _muted_account_set(db)
    return dict(updated) | {"is_read": bool(updated["is_read"]), "is_muted": updated["account_id"] in muted}


# ==================== contas silenciadas ====================
# conceito de "conta silenciada" (não remetente/e-mail individual) —
# ver schema.sql (muted_accounts) e o comentário de EmailCacheOut.is_muted
# acima pro porquê. E-mails da conta continuam sendo sincronizados
# e visíveis normalmente em /email-cache; só ficam de fora quando
# exclude_muted=true é passado (usado pelo modal de notificações).

@router.get("/muted-accounts", response_model=List[MutedAccountOut])
def list_muted_accounts(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM muted_accounts ORDER BY muted_at DESC").fetchall()
    return [dict(r) for r in rows]


@router.post("/muted-accounts", response_model=MutedAccountOut, status_code=201)
def mute_account(payload: MutedAccountIn, db=Depends(get_db)):
    account = db.execute("SELECT id FROM email_accounts WHERE id = ?", (payload.account_id,)).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="conta de e-mail não encontrada")

    existing = db.execute(
        "SELECT * FROM muted_accounts WHERE account_id = ?", (payload.account_id,)
    ).fetchone()
    if existing:
        # idempotente — silenciar uma conta já silenciada devolve a existente
        # em vez de estourar erro de unique constraint.
        return dict(existing)

    row_id = new_id()
    db.execute(
        "INSERT INTO muted_accounts (id, account_id, muted_at) VALUES (?, ?, ?)",
        (row_id, payload.account_id, now_iso()),
    )
    db.commit()
    row = db.execute("SELECT * FROM muted_accounts WHERE id = ?", (row_id,)).fetchone()
    return dict(row)


@router.delete("/muted-accounts/{muted_id}", status_code=204)
def unmute_account(muted_id: str, db=Depends(get_db)):
    row = db.execute("SELECT id FROM muted_accounts WHERE id = ?", (muted_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="conta silenciada não encontrada")
    db.execute("DELETE FROM muted_accounts WHERE id = ?", (muted_id,))
    db.commit()

@router.get("/github-token", response_model=GithubTokenStatus)
def get_github_token_status(db=Depends(get_db)):
    row = db.execute("SELECT token_enc FROM github_settings LIMIT 1").fetchone()
    return {"configured": bool(row and row["token_enc"])}


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
    return {"configured": True}


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
                return {"repo_full_name": row["repo_full_name"], "weeks": [], "error": "github ainda calculando estatísticas — tente de novo em instantes"}
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


# ==================== busca (tavily) ====================
# ver ALINHAMENTO.md 4.1 — resumo inline da busca no lugar de só abrir
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