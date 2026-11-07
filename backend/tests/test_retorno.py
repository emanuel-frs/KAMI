"""EST-01 (P-194): relatar um erro ou dar uma ideia pela conta de e-mail ligada no Kami."""
import smtplib
from unittest.mock import MagicMock

import pytest

from app.routers import retorno


def _conta(client, host="imap.gmail.com", label="pessoal"):
    r = client.post(
        "/api/organizacao/email-accounts",
        json={"label": label, "imap_host": host, "imap_port": 993, "username": f"{label}@exemplo.com", "app_password": "senha-de-app"},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture()
def smtp(mocker):
    """Simula SMTP_SSL/SMTP; devolve a conexão falsa (context manager)."""
    conn = MagicMock()
    conn.__enter__.return_value = conn
    ssl_ = mocker.patch("app.routers.retorno.smtplib.SMTP_SSL", return_value=conn)
    tls = mocker.patch("app.routers.retorno.smtplib.SMTP", return_value=conn)
    conn.ssl, conn.tls = ssl_, tls
    return conn


def test_servidor_smtp_vem_do_imap():
    assert retorno.servidores_smtp("imap.gmail.com") == [("smtp.gmail.com", 465)]
    assert retorno.servidores_smtp("outlook.office365.com") == [("smtp.office365.com", 587)]
    assert retorno.servidores_smtp(" IMAP.Provedor.com.br ") == [("smtp.provedor.com.br", 465), ("smtp.provedor.com.br", 587)]


def test_sem_conta_ligada_avisa_sem_tentar_rede(client, smtp):
    r = client.post("/api/retorno/enviar", json={"assunto": "Kami · um erro", "mensagem": "oi"})
    assert r.status_code == 409
    assert r.json()["chave"] == "erro.retorno.sem_conta"
    smtp.ssl.assert_not_called()
    assert client.get("/api/retorno/contas").json() == []


def test_envia_pela_conta_para_o_endereco_do_projeto(client, smtp):
    _conta(client)
    r = client.post(
        "/api/retorno/enviar",
        json={"assunto": "Kami 2.0.0 · um erro", "mensagem": "  travou ao salvar  ", "diagnostico": "--- diagnóstico ---\nversão 2.0.0"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"enviado": True, "de": "pessoal@exemplo.com", "para": "kami.feedback@gmail.com"}
    assert smtp.ssl.call_args.args[:2] == ("smtp.gmail.com", 465)
    smtp.login.assert_called_once_with("pessoal@exemplo.com", "senha-de-app")
    msg = smtp.send_message.call_args.args[0]
    assert msg["To"] == "kami.feedback@gmail.com"
    assert msg["From"] == msg["Reply-To"] == "pessoal@exemplo.com"
    assert msg["Subject"] == "Kami 2.0.0 · um erro"
    corpo = msg.get_content()
    assert corpo.startswith("travou ao salvar\n\n--- diagnóstico ---")


def test_escolhe_a_conta_e_o_destino_e_sempre_fixo(client, smtp):
    _conta(client, label="pessoal")
    trabalho = _conta(client, host="imap.provedor.com", label="trabalho")
    contas = client.get("/api/retorno/contas").json()
    assert [c["label"] for c in contas] == ["pessoal", "trabalho"]
    assert "app_password_enc" not in contas[0]
    # campo extra pra trocar o destinatário é ignorado (o modelo não tem)
    r = client.post("/api/retorno/enviar", json={"conta_id": trabalho, "assunto": "x", "mensagem": "ideia", "para": "outro@x.com"})
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert smtp.send_message.call_args.args[0]["To"] == "kami.feedback@gmail.com"
        assert smtp.ssl.call_args.args[:2] == ("smtp.provedor.com", 465)


def test_porta_465_fechada_tenta_587(client, smtp):
    _conta(client, host="imap.provedor.com")
    smtp.ssl.side_effect = OSError("recusada")
    r = client.post("/api/retorno/enviar", json={"assunto": "x", "mensagem": "oi"})
    assert r.status_code == 200, r.text
    assert smtp.tls.call_args.args[:2] == ("smtp.provedor.com", 587)
    smtp.starttls.assert_called_once()


def test_login_recusado_e_sem_conexao_viram_erros_traduziveis(client, smtp):
    _conta(client)
    smtp.login.side_effect = smtplib.SMTPAuthenticationError(535, b"bad")
    r = client.post("/api/retorno/enviar", json={"assunto": "x", "mensagem": "oi"})
    assert r.status_code == 422
    assert r.json()["chave"] == "erro.retorno.login_recusado"

    smtp.login.side_effect = None
    smtp.ssl.side_effect = OSError("sem rede")
    r = client.post("/api/retorno/enviar", json={"assunto": "x", "mensagem": "oi"})
    assert r.status_code == 422
    assert r.json()["chave"] == "erro.retorno.nao_conectou"
    assert r.json()["vars"]["servidor"] == "smtp.gmail.com"


def test_mensagem_vazia_recusada(client, smtp):
    _conta(client)
    r = client.post("/api/retorno/enviar", json={"assunto": "x", "mensagem": "   "})
    assert r.status_code == 422
    smtp.ssl.assert_not_called()
