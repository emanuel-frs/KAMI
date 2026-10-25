"""
E-mail: contas IMAP, sincronização, cache dos e-mails (texto limpo,
ORG-06) e contas silenciadas.

Parte do módulo Organização (routers/organizacao/__init__.py junta as
partes num router só, montado em /api/organizacao). MAN-02.
"""
from datetime import datetime as dt
from datetime import timedelta
import email as email_lib
import imaplib
import re
import sqlite3
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app import email_texto
from app.database import get_db, new_id, now_iso
from app.actions import has_action, register_action
from app.crypto import ChaveIndisponivel, encrypt_password, decrypt_password
from app.limites import Entrada
from app.mensagens import Texto

router = APIRouter()

XP_EMAIL_SYNC  = 3

# Sync manual credita xp no máximo 1x por dia por repositório/conta —
# sem isso cada clique em "sincronizar" valia xp, e 20 cliques
# desbloqueavam "organizador". A referência do sync é o NOME do
# repositório / o usuário da conta (não o id), pra que remover e
# recadastrar o mesmo item não reabra o limite do dia.

# tamanho máximo da prévia de uma linha (a lista); o texto completo
# limpo vai em body_text, até email_texto.TEXTO_MAX (ORG-06).
BODY_PREVIEW_MAX_LEN = 280
# P-27: o texto completo é o que mais pesa no cache (até 20 mil
# caracteres por e-mail) e o cache nunca é podado — então, passado esse
# prazo, só o texto completo sai (a prévia e o resto ficam). Quem
# precisar do e-mail antigo inteiro abre no webmail.
BODY_TEXT_DIAS = 90


class EmailAccountIn(Entrada):
    label: str
    imap_host: str
    imap_port: int = 993
    username: str
    app_password: str  # texto puro só no payload de entrada; nunca guardado assim
    sync_by_default: bool = True  # redesign da aba e-mail (secao 3.1) — controla se a conta
                                    # já nasce selecionada na visualização combinada


class EmailAccountUpdate(Entrada):
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
    # ORG-06: a sincronização automática (a cada 5 min) falhava em
    # silêncio — com as senhas apagadas (chave redefinida) o Emanuel
    # ficou horas sem e-mail novo sem saber. Agora a falha que só ELE
    # resolve fica gravada na conta e a tela avisa:
    #   "senha" = senha salva vazia/ilegível; "login" = servidor recusou.
    # Queda de rede não entra (passa sozinha, avisar só incomodaria).
    sync_erro: Optional[str] = None
    sync_erro_desde: Optional[str] = None
    ultimo_sync_ok: Optional[str] = None


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
    # ORG-06: `sender` cru vem como '"Fulano - Loja" <fulano@x.com>'; a
    # tela mostra o nome em destaque e o endereço menor. Calculado na
    # leitura (email_texto.separar_remetente), não guardado.
    sender_name: str = ""
    sender_email: str = ""


class EmailDetailOut(EmailCacheOut):
    """Um e-mail com o texto completo (só no GET por id — a lista não
    carrega até 20 mil caracteres por e-mail à toa)."""
    body_text: str = ""
    # cortado no limite de tamanho, ou e-mail antigo que só tem a prévia
    # guardada — a tela avisa e oferece o webmail
    body_cortado: bool = False
    webmail_url: Optional[str] = None


class MutedAccountIn(Entrada):
    account_id: str


class MutedAccountOut(BaseModel):
    id: str
    account_id: str
    muted_at: str


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


def _parte_texto(part) -> Optional[str]:
    try:
        payload = part.get_payload(decode=True)
        if payload is None:
            return None
        charset = part.get_content_charset() or "utf-8"
        try:
            return payload.decode(charset, errors="replace")
        except LookupError:  # charset inventado/desconhecido (mesmo caso de _decode_mime_words)
            return payload.decode("latin-1", errors="replace")
    except Exception:
        return None


def _extract_body(msg) -> tuple[str, bool, Optional[str]]:
    """
    Corpo do e-mail em TEXTO PURO (ORG-06): (texto completo limpo,
    foi_cortado, prévia de uma linha). Formato e regras em
    app/email_texto.py.

    Lê o primeiro text/plain e o primeiro text/html que não sejam anexo.
    O HTML só é convertido em texto ali (html.parser da biblioteca
    padrão: não executa nada, não baixa imagem) — nunca é guardado nem
    vai pro frontend. Antes, e-mail só em HTML ficava sem prévia.
    """
    plano = html = None
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if "attachment" in str(part.get("Content-Disposition", "")).lower():
            continue
        tipo = part.get_content_type()
        if tipo == "text/plain" and plano is None:
            plano = _parte_texto(part)
        elif tipo == "text/html" and html is None:
            html = _parte_texto(part)

    texto = email_texto.escolher_texto(plano, html)
    texto, cortado = email_texto.cortar_texto(texto)
    return texto, cortado, email_texto.previa(texto, BODY_PREVIEW_MAX_LEN)


@router.get("/email-accounts", response_model=List[EmailAccountOut])
def list_email_accounts(db=Depends(get_db)):
    rows = db.execute("SELECT * FROM email_accounts ORDER BY label").fetchall()
    return [
        _account_out(r) for r in rows
    ]


def _account_out(r) -> dict:
    return {
        "id": r["id"], "label": r["label"], "imap_host": r["imap_host"],
        "imap_port": r["imap_port"], "username": r["username"],
        "sync_by_default": bool(r["sync_by_default"]),
        "sync_erro": r["sync_erro"], "sync_erro_desde": r["sync_erro_desde"],
        "ultimo_sync_ok": r["ultimo_sync_ok"],
    }


def _marcar_erro_de_sync(db, account_id: str, erro: str) -> None:
    """Grava a falha (mantendo o "desde" da primeira vez) e confirma já —
    quem chama levanta HTTPException em seguida, e get_db() fecha a
    conexão sem commit."""
    db.execute(
        "UPDATE email_accounts SET sync_erro = ?, "
        "sync_erro_desde = CASE WHEN sync_erro = ? THEN sync_erro_desde ELSE ? END WHERE id = ?",
        (erro, erro, now_iso(), account_id),
    )
    db.commit()


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
    return _account_out(db.execute("SELECT * FROM email_accounts WHERE id = ?", (account_id,)).fetchone())


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

    # mudou o que entra no login (senha, usuário, servidor): o aviso de
    # erro sai na hora — a próxima sincronização diz se resolveu
    mexeu_no_login = bool(payload.app_password) or (username, imap_host, imap_port) != (
        row["username"], row["imap_host"], row["imap_port"]
    )
    db.execute(
        "UPDATE email_accounts SET label = ?, imap_host = ?, imap_port = ?, username = ?, "
        "app_password_enc = ?, sync_by_default = ? WHERE id = ?",
        (label, imap_host, imap_port, username, app_password_enc, int(sync_by_default), account_id),
    )
    if mexeu_no_login:
        db.execute("UPDATE email_accounts SET sync_erro = NULL, sync_erro_desde = NULL WHERE id = ?", (account_id,))
    db.commit()

    return _account_out(db.execute("SELECT * FROM email_accounts WHERE id = ?", (account_id,)).fetchone())


@router.delete("/email-accounts/{account_id}", status_code=204)
def delete_email_account(account_id: str, db=Depends(get_db)):
    row = db.execute("SELECT id FROM email_accounts WHERE id = ?", (account_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="conta de e-mail não encontrada")
    db.execute("DELETE FROM email_accounts WHERE id = ?", (account_id,))
    db.commit()


@router.post("/email-accounts/{account_id}/sync", response_model=EmailSyncResult)
def sync_email_account(
    account_id: str, db=Depends(get_db), limit: int = Query(20, ge=1, le=500), automatic: bool = False
):
    account = db.execute("SELECT * FROM email_accounts WHERE id = ?", (account_id,)).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="conta de e-mail não encontrada")

    try:
        plain_password = decrypt_password(account["app_password_enc"])
    except ChaveIndisponivel:
        # chave das senhas fora do cofre (SEG-01): o 409 global explica;
        # pra conta, é o mesmo "a senha não dá pra usar"
        _marcar_erro_de_sync(db, account_id, "senha")
        raise
    except ValueError:
        _marcar_erro_de_sync(db, account_id, "senha")
        raise HTTPException(
            status_code=422,
            detail="não foi possível ler a senha salva; edite a conta e informe a senha de app de novo",
        )

    try:
        imap = imaplib.IMAP4_SSL(account["imap_host"], account["imap_port"])
        imap.login(account["username"], plain_password)
        imap.select("INBOX")
    except imaplib.IMAP4.error:
        _marcar_erro_de_sync(db, account_id, "login")
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

        # Gmail tem um id interno por mensagem (X-GM-MSGID, extensão IMAP
        # do Google) — é o que abre o e-mail certo no webmail (ORG-06,
        # email_texto.url_webmail). Outros servidores não conhecem o item,
        # então só é pedido pro Gmail.
        is_gmail = email_texto.eh_gmail(account["imap_host"])
        fetch_spec = "(X-GM-MSGID RFC822)" if is_gmail else "(RFC822)"

        parsed_messages = []
        for mid in reversed(ids):
            status, msg_data = imap.fetch(mid, fetch_spec)
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            msg = email_lib.message_from_bytes(msg_data[0][1])
            gmail_id = None
            if is_gmail and isinstance(msg_data[0][0], (bytes, str)):
                cabecalho = msg_data[0][0].decode("ascii", "replace") if isinstance(msg_data[0][0], bytes) else msg_data[0][0]
                achado = re.search(r"X-GM-MSGID (\d+)", cabecalho)
                gmail_id = achado.group(1) if achado else None

            subject = _decode_mime_words(msg.get("Subject", ""))
            sender = _decode_mime_words(msg.get("From", ""))
            date_hdr = msg.get("Date")
            try:
                received_at = parsedate_to_datetime(date_hdr).isoformat() if date_hdr else now_iso()
            except (TypeError, ValueError):
                received_at = now_iso()

            message_id = (msg.get("Message-ID") or "").strip()[:500] or None
            body_text, body_cortado, body_preview = _extract_body(msg)
            parsed_messages.append(
                (subject, sender, received_at, message_id, gmail_id, body_text or None, body_cortado, body_preview)
            )
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    # Só agora abre a transação de escrita — dedupe + insert de tudo que
    # veio do IMAP, sem nenhuma chamada de rede no meio.
    new_count = 0
    try:
        for subject, sender, received_at, message_id, gmail_id, body_text, body_cortado, body_preview in parsed_messages:
            # dedupe simples (o message_id só existe a partir do ORG-06, os
            # e-mails antigos não têm): mesmo assunto + remetente + data já
            # em cache pra essa conta = já sincronizado
            dup = db.execute(
                "SELECT id, body_text FROM email_cache WHERE account_id = ? AND subject = ? "
                "AND sender = ? AND received_at = ?",
                (account_id, subject, sender, received_at),
            ).fetchone()
            if dup:
                # já em cache: reprocessa o texto com a limpeza atual (e-mail de
                # antes do ORG-06 só tinha a prévia crua; e uma melhoria em
                # email_texto.py vale pros que voltam do servidor) e completa
                # os ids que faltarem. Só os ~20 mais recentes voltam por
                # sincronização, então é barato.
                if body_text:
                    db.execute(
                        "UPDATE email_cache SET body_text = ?, body_cortado = ?, body_preview = ?, "
                        "message_id = COALESCE(message_id, ?), gmail_id = COALESCE(gmail_id, ?) WHERE id = ?",
                        (body_text, int(body_cortado), body_preview, message_id, gmail_id, dup["id"]),
                    )
                continue

            db.execute(
                "INSERT INTO email_cache "
                "(id, account_id, subject, sender, received_at, is_read, summary_text, body_preview, "
                "body_text, body_cortado, message_id, gmail_id) "
                "VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)",
                (new_id(), account_id, subject, sender, received_at, body_preview,
                 body_text, int(body_cortado), message_id, gmail_id),
            )
            new_count += 1
        _podar_textos_antigos(db, account_id)
        db.execute(
            "UPDATE email_accounts SET sync_erro = NULL, sync_erro_desde = NULL, ultimo_sync_ok = ? WHERE id = ?",
            (now_iso(), account_id),
        )
        db.commit()
    except sqlite3.OperationalError as exc:
        db.rollback()
        if "locked" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="banco de dados ocupado por outra sincronização; tente novamente em alguns segundos",
            )
        raise

    # `automatic=True` (scheduler global, email-sync-scheduler.js —
    # roda a cada 5min pra TODAS as contas, ver docstring do módulo)
    # não credita XP nem grava action_log: sync automático não é uma
    # ação do usuário, e um scheduler de 5 em 5 minutos rodando o dia
    # inteiro inflava tanto o XP quanto o log recente (nucleo.js) com
    # dezenas de entradas "sincronizou e-mail" sem nenhum esforço real
    # por trás. Sync MANUAL (clique em organização ou na aba chaves de
    # configurações, `automatic` fica no default False) continua
    # contando normalmente — esse sim é uma ação deliberada.
    if not automatic and not has_action(db, "email_sync", account["username"], only_today=True):
        register_action(
            db,
            description=Texto("log.email.sincronizou", "sincronizou e-mail: {conta}", conta=account["label"]),
            categories=["organizacao"],
            xp=XP_EMAIL_SYNC,
            impact=1,
            source="organizacao",
            referencia_tipo="email_sync",
            referencia_id=account["username"],
        )

    return {"account_id": account_id, "new_messages": new_count, "synced_at": now_iso()}


def _muted_account_set(db) -> set:
    rows = db.execute("SELECT account_id FROM muted_accounts").fetchall()
    return {r["account_id"] for r in rows}


def _podar_textos_antigos(db, account_id: str) -> None:
    """Tira só o texto completo dos e-mails com mais de BODY_TEXT_DIAS
    (ver a constante). A data é comparada como texto ISO, igual ao resto
    do app; received_at vem com fuso, e um dia de folga não importa aqui."""
    limite = (dt.now() - timedelta(days=BODY_TEXT_DIAS)).isoformat()
    db.execute(
        "UPDATE email_cache SET body_text = NULL, body_cortado = 1 "
        "WHERE account_id = ? AND body_text IS NOT NULL AND received_at < ?",
        (account_id, limite),
    )


# colunas da lista — tudo menos o texto completo (até 20 mil caracteres
# por e-mail, só o GET por id carrega)
_EMAIL_LIST_COLS = (
    "id, account_id, subject, sender, received_at, is_read, summary_text, body_preview, "
    "body_text IS NULL AS sem_texto"
)


def _email_out(row, muted: set) -> dict:
    out = {k: row[k] for k in row.keys() if k not in ("sem_texto", "body_text", "body_cortado", "message_id", "gmail_id")}
    nome, endereco = email_texto.separar_remetente(row["sender"])
    out |= {
        "is_read": bool(row["is_read"]),
        "is_muted": row["account_id"] in muted,
        "sender_name": nome,
        "sender_email": endereco,
    }
    # e-mail de antes do ORG-06: a prévia guardada é o text/plain cru
    # (com URL longa e token). Limpa na leitura — barato (280 caracteres)
    # e não depende de sincronizar de novo.
    legado = row["sem_texto"] if "sem_texto" in row.keys() else row["body_text"] is None
    if legado and row["body_preview"]:
        out["body_preview"] = email_texto.previa(email_texto.limpar_texto_plano(row["body_preview"]))
    return out


@router.get("/email-cache", response_model=List[EmailCacheOut])
def list_email_cache(
    account_id: Optional[str] = None,
    is_read: Optional[bool] = None,
    exclude_muted: bool = False,
    db=Depends(get_db),
):
    query = f"SELECT {_EMAIL_LIST_COLS} FROM email_cache"
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
    out = [_email_out(r, muted) for r in rows]
    if exclude_muted:
        out = [e for e in out if not e["is_muted"]]
    return out


@router.get("/email-cache/{cache_id}", response_model=EmailDetailOut)
def get_email(cache_id: str, db=Depends(get_db)):
    """Texto completo pra leitura dentro do app (ORG-06). Não marca como
    lido sozinho — quem abre chama PUT /read (igual antes)."""
    row = db.execute(
        "SELECT c.*, a.imap_host, a.username FROM email_cache c "
        "JOIN email_accounts a ON a.id = c.account_id WHERE c.id = ?",
        (cache_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="e-mail não encontrado no cache")
    out = _email_out(row, _muted_account_set(db))
    if row["body_text"] is not None:
        out |= {"body_text": row["body_text"], "body_cortado": bool(row["body_cortado"])}
    else:
        # só a prévia antiga (ou o texto já podado): mostra o que tem,
        # limpo, e a tela avisa que está incompleto
        out |= {
            "body_text": email_texto.limpar_texto_plano(row["body_preview"] or ""),
            "body_cortado": True,
        }
    out["webmail_url"] = email_texto.url_webmail(row["imap_host"], row["username"], row["message_id"], row["gmail_id"])
    for k in ("imap_host", "username"):
        out.pop(k, None)
    return out


def _set_email_read(cache_id: str, lido: bool, db) -> dict:
    row = db.execute("SELECT id FROM email_cache WHERE id = ?", (cache_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="e-mail não encontrado no cache")
    db.execute("UPDATE email_cache SET is_read = ? WHERE id = ?", (int(lido), cache_id))
    db.commit()
    updated = db.execute(f"SELECT {_EMAIL_LIST_COLS} FROM email_cache WHERE id = ?", (cache_id,)).fetchone()
    return _email_out(updated, _muted_account_set(db))


@router.put("/email-cache/{cache_id}/read", response_model=EmailCacheOut)
def mark_email_read(cache_id: str, db=Depends(get_db)):
    return _set_email_read(cache_id, True, db)


@router.put("/email-cache/{cache_id}/unread", response_model=EmailCacheOut)
def mark_email_unread(cache_id: str, db=Depends(get_db)):
    """ORG-06: "marcar como não lido" no leitor — volta pro sino e pro
    filtro "não lidos" (só no Kami; o servidor IMAP não é alterado)."""
    return _set_email_read(cache_id, False, db)


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
