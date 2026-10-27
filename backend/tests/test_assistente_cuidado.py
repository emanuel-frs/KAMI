"""
IA-03 (P-111): exceção de cuidado — as regras locais pegam risco nos 10
idiomas e NÃO disparam com hipérbole do dia a dia; a tabela de ajuda é
válida.
"""
import json

import pytest

from app.assistente import cuidado


@pytest.mark.parametrize("texto", [
    "às vezes penso em me matar", "Quero me matar", "vou tirar minha própria vida", "não quero mais viver",
    "tô sem vontade de viver", "quero me cortar", "pensei em suicídio", "quero morrer",
    "I want to die", "sometimes I think about killing myself", "I don't want to live anymore", "I keep hurting myself",
    "quiero matarme", "no quiero vivir", "pienso en quitarme la vida",
    "je veux mourir", "j'ai envie de me tuer", "mettre fin à mes jours",
    "voglio morire", "vorrei uccidermi", "non voglio più vivere",
    "ich will sterben", "ich will mich umbringen", "Gedanken an Suizid",
    "我想死", "我不想活了", "有自杀的念头",
    "死にたい", "もう生きていたくない",
    "죽고 싶어", "자살 생각이 나요",
    "मैं मरना चाहता हूँ", "आत्महत्या के विचार",
])
def test_detecta_risco(texto):
    assert cuidado.ha_risco(texto), texto


@pytest.mark.parametrize("texto", [
    "esse prazo vai me matar", "morrendo de rir com essa conta", "quero morrer de vergonha",
    "matar a saudade da viagem", "me matar de estudar pra prova", "vou matar a aula",
    "this deadline is killing me", "I'm dying to know my balance", "die Hard é meu filme favorito",
    "quiero morir de risa", "voglio morire dal ridere",
    "estou triste com as contas", "como cortar gastos?", "quanto gastei em outubro?",
    "a bateria morreu", "kill the process", "o projeto morreu",
])
def test_nao_dispara_com_hiperbole(texto):
    assert not cuidado.ha_risco(texto), texto


def test_servico_do_pais_e_reserva():
    assert cuidado.servico("BR")["telefone"] == "188"
    assert cuidado.servico("br")["nome"].startswith("CVV")
    reserva = cuidado.servico("PT")
    assert reserva["reserva"] is True and reserva["site"] == "https://findahelpline.com"
    assert cuidado.servico(None)["reserva"] is True


def test_tabela_de_ajuda_valida():
    tabela = json.loads(cuidado.ARQUIVO_AJUDA.read_text(encoding="utf-8"))
    for pais, s in tabela["paises"].items():
        assert len(pais) == 2 and pais.isupper()
        assert s["nome"] and (s["telefone"] or s["site"])
        assert s["site"] is None or s["site"].startswith("https://")
