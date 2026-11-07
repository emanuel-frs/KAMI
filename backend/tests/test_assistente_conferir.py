"""
IA-07a: o Kami confere os valores e as datas da resposta com o que as
ferramentas entregaram — casos reais do qwen3.5:4b no teste do Emanuel.
"""
import json
from datetime import date

import pytest

from app.assistente import chat, conferir, conversas, ferramentas
from provedor_falso import ProvedorFalso, openai_texto

HOJE = date(2026, 11, 2)
FIN = ferramentas._embrulhar("finance_summary", json.dumps({
    "income": 0, "expenses": 10.0, "net_this_month": -10.0, "accounts_total_available": 0.0,
    "expected_income": [{"label": "salário", "amount": 1250.0, "expected_date": "2026-11-09"}]}))
META = ferramentas._embrulhar("goals", json.dumps({"goals": [
    {"target": 100.0, "deadline": "2026-11-25", "needed_per_week": 30.43, "days_left": 23}]}))


def test_valores_nos_formatos_comuns():
    assert conferir.valor("1.250,00") == 1250.0 and conferir.valor("1,250.00") == 1250.0
    assert conferir.valor("30,43") == 30.43 and conferir.valor("1.259") == 1259.0
    assert conferir.valor("49031,27") == 49031.27 and conferir.valor("10") == 10.0
    assert conferir.soltos("previsto R$ 1 250 e 2\u00a0500,50 €", [FIN], "x", HOJE) == ["2\u00a0500,50 €"]


def test_acha_o_que_o_modelo_inventou():
    resposta = ("**Sim — você gastou mais do que ganhou.**\n- R$ 0 na conta, com entrada prevista de "
                "R$ 1.259 no dia 02/11.\n- Saldo atual: R$ 49.031,27; vence em 15/11.")
    assert conferir.soltos(resposta, [FIN], "estou gastando muito?", date(2026, 11, 3)) == [
        "R$ 1.259", "02/11", "R$ 49.031,27", "15/11"]


def test_nao_acusa_o_que_esta_nos_dados():
    resposta = ("**Sim.** Gastou R$ 10,00 (saldo -R$ 10) e não entrou nada; R$ 1.250 previstos pra 09/11. "
                "A meta de R$ 100 vence em 25/11/26: ~R$ 30 por semana (R$ 30,43), 23 dias.")
    assert conferir.soltos(resposta, [FIN, META], "x", HOJE) == []
    # hoje e o que a própria pessoa escreveu também valem
    assert conferir.soltos("hoje (02/11) você citou R$ 250.", [], "gastei R$ 250 ontem", HOJE) == []


def test_sem_consultar_nada_todo_valor_e_conferido():
    assert conferir.soltos("Seu saldo é R$ 49.031 e 568,59 €.", [], "estou gastando muito?", HOJE) == [
        "R$ 49.031", "568,59 €"]


def test_mesmo_valor_escrito_de_jeitos_diferentes_avisa_uma_vez():
    assert conferir.soltos("R$ 7 e **R$7** e R$ 7.", [], "x", HOJE) == ["R$ 7"]


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


def test_resposta_com_numero_inventado_ganha_aviso_e_continua_no_historico(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("Seu saldo é r$ 49.031."))
    ev = _enviar(client, "estou gastando muito?")
    conf = next(e for e in ev if e["tipo"] == "conferido")
    assert conf == {"tipo": "conferido", "texto": "Seu saldo é R$ 49.031.", "valores": ["R$ 49.031"]}
    assert [e["tipo"] for e in ev][-2:] == ["conferido", "fim"]
    cid = ev[0]["conversa_id"]
    guardada = client.get(f"/api/assistente/conversas/{cid}").json()["mensagens"][-1]
    assert guardada["texto"] == "Seu saldo é R$ 49.031." and guardada["aviso"] == {"tipo": "conferir", "valores": ["R$ 49.031"]}

    # a resposta conferida continua indo no histórico (o aviso de cuidado é que não vai)
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    _enviar(client, "e agora?", conversa_id=cid)
    enviadas = [r["json"] for r in falso.recebidas if r["caminho"].endswith("/chat/completions")][-1]["messages"]
    assert any(m["role"] == "assistant" and "49.031" in (m.get("content") or "") for m in enviadas)


def test_resposta_sem_numero_nao_ganha_evento(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("Não conto piadas — posso ajudar com suas metas."))
    assert not any(e["tipo"] == "conferido" for e in _enviar(client, "me conta uma piada"))


def test_cuidado_de_so_olha_o_aviso_de_cuidado():
    assert chat._cuidado_de({"aviso": {"tipo": "cuidado"}}) and not chat._cuidado_de({"aviso": {"tipo": "conferir"}})
    assert not chat._cuidado_de({"aviso": None})


def test_numero_de_uma_consulta_anterior_da_conversa_nao_e_acusado(client, falso, monkeypatch):
    """No local o histórico não leva os dados antigos, mas o modelo repete
    números da resposta anterior — eles estão na conversa (teste do Emanuel)."""
    _ligar(client, falso)
    leitura = ferramentas._POR_NOME["finance_summary"]
    monkeypatch.setattr(leitura, "executar", lambda conn, args: {"expenses": 37.5})
    pede = [{"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "t0", "function": {
        "name": "finance_summary", "arguments": "{}"}}]}}]}, {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}, "[DONE]"]
    falso.responder("/v1/chat/completions", sse=pede)
    falso.responder("/v1/chat/completions", sse=openai_texto("Você gastou R$ 37,50."))
    ev = _enviar(client, "quanto gastei?")
    assert not any(e["tipo"] == "conferido" for e in ev)
    falso.limpar()  # a última resposta da fila se repete
    falso.responder("/v1/chat/completions", sse=openai_texto("Como eu disse: R$ 37,50 — e R$ 99 de nada."))
    ev2 = _enviar(client, "repete?", conversa_id=ev[0]["conversa_id"])
    conf = next(e for e in ev2 if e["tipo"] == "conferido")
    assert conf["valores"] == ["R$ 99"]



# ── quadro: os números da consulta, do jeito que o Kami leu ──────────────

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


def test_soma_de_itens_da_mesma_lista_nao_e_acusada():
    """Teste do Emanuel: "as outras três somam R$ 87,5" (50 + 25 + 12,5) saiu como "confira"."""
    metas = ferramentas._embrulhar("goals", json.dumps({"goals": [
        {"title": "teste", "remaining": 100.0}, {"title": "teste 2", "remaining": 50.0},
        {"title": "teste 3", "remaining": 25.0}, {"title": "teste 4", "remaining": 12.5}]}))
    assert conferir.soltos("as outras três somam R$87.5 e todas, R$ 187,50", [metas], "x", HOJE) == []
    assert conferir.soltos("somam R$ 88", [metas], "x", HOJE) == []  # arredondado
    assert conferir.soltos("somam R$ 90", [metas], "x", HOJE) == ["R$ 90"]  # conta errada continua acusada
    # lista grande: só o total
    muitos = ferramentas._embrulhar("x", json.dumps({"itens": [{"v": float(i)} for i in range(1, 13)]}))
    assert conferir.soltos("total R$ 78; dois: R$ 3", [muitos], "x", HOJE) == []
    assert conferir.soltos("três primeiros: R$ 6,50", [muitos], "x", HOJE) == ["R$ 6,50"]



def test_fracao_nao_e_data():
    """Teste do Emanuel: "notebook (5/10)" e "3/5 marcos" viravam "confira"."""
    contas = ferramentas._embrulhar("bills_due", json.dumps({"bills": [
        {"name": "notebook (5/10)", "amount": 200.0, "due_date": "2026-12-01", "installment": 5, "installments": 10}]}))
    trilhas = ferramentas._embrulhar("learning", json.dumps({"tracks": [
        {"track": "inglês", "completed": 3, "total": 5, "progress_pct": 60}], "achievements": "16/50"}))
    resposta = "Parcela 5/10 do notebook em 01/12. Inglês: 3/5 marcos (60%). Conquistas 16/50."
    assert conferir.soltos(resposta, [contas, trilhas], "x", HOJE) == []
    # data de verdade que não está nos dados continua sendo acusada
    assert conferir.soltos("vence em 15/11", [contas, trilhas], "x", HOJE) == ["15/11"]
