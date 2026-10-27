"""
IA-03 (P-112): filtro de dados sensíveis na saída das ferramentas — o que
TEM que sair como [removido] e o que NÃO pode ser mexido (valores, datas,
horas, ids), senão as respostas ficam erradas.
"""
import pytest

from app.assistente.filtro import REMOVIDO, limpar, limpar_dado


@pytest.mark.parametrize("texto", [
    "manda pra ana.silva+kami@exemplo.com.br amanhã",
    "cartão 4111 1111 1111 1111 vence 12/27",
    "cartao 5555555555554444",
    "CPF 123.456.789-09 do titular",
    "cpf 12345678909",
    "CNPJ 12.345.678/0001-95",
    "IBAN DE89 3704 0044 0532 0130 00",
    "ag 1234 cc 56789-0 itaú",
    "Agência 0001, conta corrente 12345678-9",
    "minha chave sk-proj-abc123def456ghi789jkl0",
    "token do github ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    "groq gsk_abcdefghijklmnop1234",
    "aws AKIAIOSFODNN7EXAMPLE",
    "google AIzaSyA-1234567890abcdefghijklmnopqrstu",
    "senha: hunter2",
    "Password = correcthorse",
    "pin: 4321",
    "acesso https://admin:s3nh4@servidor.local/painel",
    "link https://api.exemplo.com/x?token=abc123&y=1",
    "liga pro (11) 98765-4321",
    "telefone +55 11 98765-4321",
    "fone 3456-7890",
    "whats +5511987654321",
    "segredo a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
])
def test_remove(texto):
    limpo = limpar(texto)
    assert REMOVIDO in limpo, limpo


def test_nao_sobra_nada_do_segredo():
    assert "hunter2" not in limpar("senha: hunter2")
    assert "s3nh4" not in limpar("https://admin:s3nh4@servidor.local/painel")
    assert "abc123" not in limpar("https://api.exemplo.com/x?token=abc123&y=1")
    assert limpar("https://api.exemplo.com/x?token=abc123&y=1").startswith("https://api.exemplo.com/x?token=")


@pytest.mark.parametrize("texto", [
    "gastou R$ 1.234,56 em mercado",
    "valor 1234567.89",
    "2026-10-27T10:00:00-03:00",
    "reunião 27/10/2026 às 09:30",
    "de 2026-10-01 a 2026-10-31",
    "id 5f2f9aaa-dcbc-43e0-907a-805a83397577",
    "trilha python: 3 de 10 marcos (30%)",
    "nível 12, 4500 xp",
    "aluguel dia 5",
    "https://docs.python.org/3/library/re.html",
    "conta fixa: internet 99,90",
    "número do pedido 12345",
    "senha forte é importante",  # sem rótulo seguido de valor
])
def test_nao_mexe(texto):
    assert limpar(texto) == texto


def test_estrutura_so_mexe_em_texto():
    dado = {"valor": 4111111111111111, "itens": [{"titulo": "email ana@x.com", "n": 3}], "ok": True}
    assert limpar_dado(dado) == {"valor": 4111111111111111, "itens": [{"titulo": f"email {REMOVIDO}", "n": 3}], "ok": True}
