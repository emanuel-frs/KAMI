"""
IA-07a: limpeza do fim da resposta (moeda, HTML, emojis, ícones) e o
quadro com os números da consulta — casos reais do teste do Emanuel. O
"! confira" (valores que não estavam nos dados) saiu na 2.0.
"""
import json

import pytest

from app.assistente import chat, conferir, conversas, ferramentas
from provedor_falso import ProvedorFalso, openai_texto

FIN = ferramentas._embrulhar("finance_summary", json.dumps({
    "income": 0, "expenses": 10.0, "net_this_month": -10.0, "accounts_total_available": 0.0,
    "expected_income": [{"label": "salário", "amount": 1250.0, "expected_date": "2026-11-09"}]}))

def test_moeda_arrumada():
    assert conferir.arrumar_moeda("saldo: r$ 0,00 e R\\$ 10 e US\\$ 5") == "saldo: R$ 0,00 e R$ 10 e US$ 5"
    assert conferir.arrumar_moeda("bar$ fica") == "bar$ fica"


# ── no chat ──────────────────────────────────────────────────────────────

@pytest.fixture()
def falso():
    conversas._resetar_para_testes()
    f = ProvedorFalso()
    yield f
    f.fechar()
    conversas._resetar_para_testes()


def _ligar(client, falso):
    client.post("/api/assistente/provedores", json={"catalogo": "ollama", "url_base": falso.url, "modelo": "m1"})
    assert client.put("/api/assistente/config", json={"ativo": True}).json()["pronto"] is True


def _enviar(client, texto, **extra):
    with client.stream("POST", "/api/assistente/mensagens", json={"texto": texto, "idioma": "pt", **extra}) as r:
        return [json.loads(l[6:]) for l in r.iter_lines() if l.startswith("data: ")]


def test_resposta_limpa_sem_aviso_e_continua_no_historico(client, falso):
    """Teste do Emanuel: o "! confira" saiu; a limpeza (moeda, emojis…) fica."""
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("Seu saldo é r$ 49.031."))
    ev = _enviar(client, "estou gastando muito?")
    conf = next(e for e in ev if e["tipo"] == "conferido")
    assert conf == {"tipo": "conferido", "texto": "Seu saldo é R$ 49.031."}
    assert [e["tipo"] for e in ev][-2:] == ["conferido", "fim"]
    cid = ev[0]["conversa_id"]
    guardada = client.get(f"/api/assistente/conversas/{cid}").json()["mensagens"][-1]
    assert guardada["texto"] == "Seu saldo é R$ 49.031." and guardada["aviso"] is None

    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    _enviar(client, "e agora?", conversa_id=cid)
    enviadas = [r["json"] for r in falso.recebidas if r["caminho"].endswith("/chat/completions")][-1]["messages"]
    assert any(m["role"] == "assistant" and "49.031" in (m.get("content") or "") for m in enviadas)


def test_resposta_que_nao_precisa_de_limpeza_nao_ganha_evento(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("Não conto piadas — posso ajudar com suas metas."))
    assert not any(e["tipo"] == "conferido" for e in _enviar(client, "me conta uma piada"))


def test_cuidado_de_so_olha_o_aviso_de_cuidado():
    assert chat._cuidado_de({"aviso": {"tipo": "cuidado"}}) and not chat._cuidado_de({"aviso": {"tipo": "conferir"}})
    assert not chat._cuidado_de({"aviso": None})


def test_quadro_so_das_consultas_com_quadro_e_sem_erro():
    assert ferramentas.quadro("finance_summary", FIN)["dados"]["expected_income"][0]["amount"] == 1250.0
    assert ferramentas.quadro("inbox", ferramentas._embrulhar("inbox", "{}")) is None
    assert ferramentas.quadro("goals", ferramentas._embrulhar("goals", '{"error": "x"}')) is None
    assert ferramentas.quadro("goals", "lixo") is None
    # texto da pessoa com "</dados" (escapado pro modelo) volta inteiro pra tela
    corpo = ferramentas._FECHA_DADOS.sub("<\\/dados", json.dumps({"goals": [{"title": "a </dados b"}]}))
    escapado = ferramentas._embrulhar("goals", corpo)
    assert "</dados b" not in escapado
    assert ferramentas.quadro("goals", escapado)["dados"]["goals"][0]["title"] == "a </dados b"


def test_quadro_ao_vivo_e_na_conversa_reaberta(client, falso, monkeypatch):
    _ligar(client, falso)
    monkeypatch.setattr(ferramentas._POR_NOME["finance_summary"], "executar", lambda conn, args: {"expenses": 10.0})
    pede = [{"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "t0", "function": {
        "name": "finance_summary", "arguments": "{}"}}]}}]}, {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}, "[DONE]"]
    falso.responder("/v1/chat/completions", sse=pede)
    falso.responder("/v1/chat/completions", sse=openai_texto("Ainda não entrou nada."))
    ev = _enviar(client, "estou gastando muito?")
    assert {"tipo": "quadro", "nome": "finance_summary", "dados": {"expenses": 10.0}} in ev
    msgs = client.get(f"/api/assistente/conversas/{ev[0]['conversa_id']}").json()["mensagens"]
    assert [m["papel"] for m in msgs] == ["usuario", "ferramenta", "assistente"]
    assert msgs[1]["quadro"] == {"nome": "finance_summary", "dados": {"expenses": 10.0}} and "texto" not in msgs[1]


# ── limpeza: HTML, emojis e ícones do Kami ───────────────────────────────

def test_html_da_resposta_vira_texto_e_emojis_saem():
    """Caso real do qwen3.5:4b: respondeu em <details>/<div> com 📂 e ⚡."""
    bruto = ('<details><summary style="cursor: pointer">📂 Finanças (10 de nov)</summary><div class="bento-card">'
             '<h5>O cartão</h5><span style="color: #9ca3ad">Gastei <b>r$ 10</b> em um único motivo.</span></div></details>')
    assert conferir.arrumar(bruto) == "Finanças (10 de nov)\nO cartão\nGastei **R$ 10** em um único motivo."
    assert conferir.arrumar("⚡ Aprendizados\n- item\n  - sub ✓ feito") == "Aprendizados\n- item\n  - sub ✓ feito"
    # bloco de código e comparação "a < b" ficam como estão
    assert conferir.arrumar("```html\n<b>x</b>\n```") == "```html\n<b>x</b>\n```"
    assert conferir.arrumar("se 3 < 5 e 7 > 2") == "se 3 < 5 e 7 > 2"


def test_icones_das_instrucoes_existem_no_kami_e_na_tela():
    from pathlib import Path
    from app.assistente import instrucoes
    raiz = Path(__file__).resolve().parents[2] / "frontend" / "js" / "components"
    icones_js = (raiz / "icons.js").read_text(encoding="utf-8")
    painel = (raiz / "assistente-painel.js").read_text(encoding="utf-8")
    for nome in instrucoes.ICONES:
        assert f'"{nome}":' in icones_js or f"\n  {nome}:" in icones_js, nome
        assert f'"{nome}"' in painel, f"{nome} fora de ICONES_IA"
    assert ":target:" in instrucoes.montar("pt", None, local=True) and ":target:" in instrucoes.montar("pt", None)


def test_icone_inventado_sai_e_os_do_kami_ficam():
    """Teste do Emanuel: ":todinho: 1 hábito ativo"."""
    assert conferir.arrumar(":todinho: 1 hábito ativo") == "1 hábito ativo"
    assert conferir.arrumar(":target: meta em dia às 10:30") == ":target: meta em dia às 10:30"
    assert conferir.arrumar("veja https://x.com/a:b:c e ```\n:todinho:\n```") == "veja https://x.com/a:b:c e ```\n:todinho:\n```"


