"""
Relatar um erro ou dar uma ideia direto do Kami (EST-01, P-194).

Envia pela conta de e-mail que a pessoa já ligou em organização › e-mail
(a mesma senha de app do IMAP), por SMTP, sempre para o endereço do
projeto: o destinatário é fixo, então esta rota não serve pra mandar
e-mail a mais ninguém. Sem conta ligada, a tela avisa e leva até a
configuração.

O servidor SMTP sai do IMAP da conta: os provedores conhecidos têm o par
certo; nos outros, `imap.` vira `smtp.` e tenta a porta 465 (SSL) e
depois a 587 (STARTTLS).

  GET  /api/retorno/contas   contas que podem enviar (id, apelido, usuário)
  POST /api/retorno/enviar   {conta_id?, assunto, mensagem, diagnostico?}
"""
import smtplib
import ssl
from email.message import EmailMessage
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import Field

from app.crypto import ChaveIndisponivel, decrypt_password
from app.database import get_db
from app.limites import Entrada
from app.mensagens import ErroKami

router = APIRouter()

DESTINO = "kami.feedback@gmail.com"
TEMPO_LIMITE = 20  # segundos por tentativa de conexão

# imap → (smtp, porta). 465 = SSL direto; 587 = STARTTLS.
SMTP_CONHECIDOS = {
    "imap.gmail.com": ("smtp.gmail.com", 465),
    "imap.googlemail.com": ("smtp.gmail.com", 465),
    "outlook.office365.com": ("smtp.office365.com", 587),
    "imap-mail.outlook.com": ("smtp-mail.outlook.com", 587),
    "imap.mail.yahoo.com": ("smtp.mail.yahoo.com", 465),
    "imap.mail.me.com": ("smtp.mail.me.com", 587),
    "imap.zoho.com": ("smtp.zoho.com", 465),
    "imap.fastmail.com": ("smtp.fastmail.com", 465),
}


def servidores_smtp(imap_host: str) -> list[tuple[str, int]]:
    """Em ordem de tentativa."""
    host = (imap_host or "").strip().lower()
    if host in SMTP_CONHECIDOS:
        return [SMTP_CONHECIDOS[host]]
    base = "smtp." + host[len("imap."):] if host.startswith("imap.") else host
    return [(base, 465), (base, 587)]


def _conectar(host: str, porta: int):
    ctx = ssl.create_default_context()
    if porta == 465:
        return smtplib.SMTP_SSL(host, porta, timeout=TEMPO_LIMITE, context=ctx)
    smtp = smtplib.SMTP(host, porta, timeout=TEMPO_LIMITE)
    smtp.starttls(context=ctx)
    return smtp


class RetornoIn(Entrada):
    conta_id: Optional[str] = None
    assunto: str
    mensagem: str = Field(..., max_length=4000)
    diagnostico: str = Field("", max_length=20000)


@router.get("/contas")
def contas_para_enviar(db=Depends(get_db)):
    rows = db.execute("SELECT id, label, username FROM email_accounts ORDER BY label COLLATE NOCASE").fetchall()
    return [{"id": r["id"], "label": r["label"], "username": r["username"]} for r in rows]


@router.post("/enviar")
def enviar(payload: RetornoIn, db=Depends(get_db)):
    mensagem = payload.mensagem.strip()
    if not mensagem:
        raise ErroKami(422, "erro.retorno.mensagem_vazia", "escreva a mensagem antes de enviar")
    if payload.conta_id:
        conta = db.execute("SELECT * FROM email_accounts WHERE id = ?", (payload.conta_id,)).fetchone()
    else:
        conta = db.execute("SELECT * FROM email_accounts ORDER BY label COLLATE NOCASE LIMIT 1").fetchone()
    if not conta:
        raise ErroKami(409, "erro.retorno.sem_conta", "nenhuma conta de e-mail ligada no kami")

    try:
        senha = decrypt_password(conta["app_password_enc"])
    except ChaveIndisponivel:
        raise
    except ValueError:
        raise ErroKami(
            422,
            "erro.emails.nao_foi_possivel_ler_senha",
            "não foi possível ler a senha salva; edite a conta e informe a senha de app de novo",
        )

    msg = EmailMessage()
    msg["From"] = conta["username"]
    msg["To"] = DESTINO
    msg["Reply-To"] = conta["username"]
    # cabeçalho numa linha só: quebra de linha no assunto viraria erro 500
    # (o email do Python recusa — o que impede injetar "Bcc:")
    msg["Subject"] = " ".join(payload.assunto.split()) or "Kami"
    corpo = mensagem
    if payload.diagnostico.strip():
        corpo += "\n\n" + payload.diagnostico.strip()
    msg.set_content(corpo)

    ultimo_erro = None
    for host, porta in servidores_smtp(conta["imap_host"]):
        try:
            with _conectar(host, porta) as smtp:
                smtp.login(conta["username"], senha)
                smtp.send_message(msg)
            return {"enviado": True, "de": conta["username"], "para": DESTINO}
        except smtplib.SMTPAuthenticationError:
            raise ErroKami(
                422,
                "erro.retorno.login_recusado",
                "o servidor de e-mail recusou o login de {usuario}; confira a senha de app em organização › e-mail",
                usuario=conta["username"],
            )
        except (OSError, smtplib.SMTPException) as e:  # sem conexão, porta fechada, recusa no envio
            ultimo_erro = e
            continue
    raise ErroKami(
        422,
        "erro.retorno.nao_conectou",
        "não deu pra enviar pelo servidor de e-mail ({servidor}); confira a internet ou use o GitHub",
        servidor=servidores_smtp(conta["imap_host"])[0][0],
    ) from ultimo_erro
