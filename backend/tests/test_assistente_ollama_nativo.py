"""
2.1.0: Ollama pela API nativa (`/api/chat`) pra pedir o contexto.

O `/v1` do Ollama abre o modelo com 4096 tokens e não deixa pedir outro; o
pedido do Kami (instruções + ferramentas + uma leitura) passava disso e a
resposta saía cortada. Aqui: o Kami reconhece o Ollama pelo `/api/version`,
conversa pelo `/api/chat` com `options.num_ctx`, lê o NDJSON (texto,
pedido de ferramenta, uso de tokens) e manda o histórico no formato nativo.
Servidor local que não é Ollama (LM Studio) segue pelo `/v1`.
"""
import json

import pytest

from app.assistente import ollama_nativo, openai_compat, transporte
from app.assistente.tipos import Chamada, ChamadaFerramenta, Ferramenta, Fim, Mensagem, Provedor, TextoDelta, Uso
from provedor_falso import ProvedorFalso, openai_texto


@pytest.fixture()
def falso():
    f = ProvedorFalso()
    ollama_nativo.esquecer()
    yield f
    f.fechar()
    ollama_nativo.esquecer()


def _ndjson(*pedacos) -> bytes:
    return "\n".join(json.dumps(p) for p in pedacos).encode() + b"\n"


def _p(falso, local=True):
    return Provedor(tipo="openai", url_base=falso.url, modelo="qwen3.5:4b", chave=None, local=local)


NDJSON = {"Content-Type": "application/x-ndjson"}  # o que o Ollama 0.30 manda (o falso sem isso deixou passar um bug)
FERRAMENTA = Ferramenta("learning", "estudos", {"type": "object", "properties": {}})


def test_ollama_conversa_pela_api_nativa_com_o_contexto(falso):
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", headers=NDJSON, bruto=_ndjson(
        {"message": {"role": "assistant", "content": "Olá"}, "done": False},
        {"message": {"role": "assistant", "content": ", tudo bem"}, "done": False},
        {"message": {"role": "assistant", "content": ""}, "done": True, "done_reason": "stop",
         "prompt_eval_count": 120, "eval_count": 4}))
    eventos = list(openai_compat.conversar(_p(falso), [Mensagem("sistema", "regras"), Mensagem("usuario", "oi")], [FERRAMENTA]))
    assert "".join(e.delta for e in eventos if isinstance(e, TextoDelta)) == "Olá, tudo bem"
    assert [e for e in eventos if isinstance(e, Uso)] == [Uso(120, 4)]
    assert eventos[-1] == Fim("fim")
    pedido = falso.recebidas[-1]
    assert pedido["caminho"] == "/api/chat"  # a sonda não conta nas recebidas
    corpo = pedido["json"]
    assert corpo["options"]["num_ctx"] == ollama_nativo.CONTEXTO and corpo["think"] is False and corpo["stream"] is True
    assert corpo["tools"][0]["function"]["name"] == "learning"
    assert [m["role"] for m in corpo["messages"]] == ["system", "user"]


def test_pedido_de_ferramenta_e_historico_no_formato_nativo(falso):
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", headers=NDJSON, bruto=_ndjson(
        {"message": {"role": "assistant", "content": "",
                     "tool_calls": [{"function": {"name": "learning", "arguments": {"x": 1}}}]}, "done": False},
        {"message": {"role": "assistant", "content": ""}, "done": True, "done_reason": "stop",
         "prompt_eval_count": 50, "eval_count": 9}))
    historico = [Mensagem("usuario", "como estão meus estudos?"),
                 Mensagem("assistente", "", [ChamadaFerramenta("c0", "learning", {})]),
                 Mensagem("ferramenta", "<dados>…</dados>", id_chamada="c0", nome_ferramenta="learning")]
    eventos = list(openai_compat.conversar(_p(falso), historico, [FERRAMENTA]))
    chamadas = [e.chamada for e in eventos if isinstance(e, Chamada)]
    assert [(c.nome, c.argumentos) for c in chamadas] == [("learning", {"x": 1})]
    assert eventos[-1] == Fim("ferramentas")
    msgs = falso.recebidas[-1]["json"]["messages"]
    assert msgs[1] == {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "learning", "arguments": {}}}]}
    assert msgs[2] == {"role": "tool", "tool_name": "learning", "content": "<dados>…</dados>"}


def test_pedido_escrito_como_texto_tambem_vale(falso):
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", headers=NDJSON, bruto=_ndjson(
        {"message": {"content": '{"name": "learning", "arguments": {}}'}, "done": False},
        {"message": {"content": ""}, "done": True, "done_reason": "stop"}))
    eventos = list(openai_compat.conversar(_p(falso), [Mensagem("usuario", "estudos")], [FERRAMENTA]))
    assert [e.chamada.nome for e in eventos if isinstance(e, Chamada)] == ["learning"]
    assert not [e for e in eventos if isinstance(e, TextoDelta)]


def test_cortado_pelo_limite_e_erro_do_ollama(falso):
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", headers=NDJSON, bruto=_ndjson({"message": {"content": "abc"}, "done": True, "done_reason": "length"}))
    assert list(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))[-1] == Fim("limite")
    falso.limpar()
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", headers=NDJSON, bruto=_ndjson({"error": "model 'qwen3.5:4b' not found"}))
    with pytest.raises(transporte.ErroProvedor):
        list(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))


def test_erro_do_ollama_em_json_antes_do_streaming(falso):
    """Modelo que não existe: o Ollama responde 404 em JSON, sem streaming."""
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", status=404, json={"error": "model 'x' not found"})
    with pytest.raises(transporte.ErroProvedor):
        list(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))


def test_aquecer_usa_o_mesmo_contexto(falso):
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", json={"message": {"content": ""}, "done": True})
    openai_compat.aquecer(_p(falso), [Mensagem("sistema", "regras")], [FERRAMENTA])
    corpo = falso.recebidas[-1]["json"]
    assert corpo["options"] == {"num_ctx": ollama_nativo.CONTEXTO, "num_predict": 1} and corpo["stream"] is False


def test_servidor_local_que_nao_e_ollama_segue_pelo_v1(falso):
    """LM Studio e outros: /api/version dá 404 → compatível com OpenAI."""
    falso.responder("/v1/chat/completions", sse=openai_texto("oi"))
    eventos = list(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))
    assert "".join(e.delta for e in eventos if isinstance(e, TextoDelta)) == "oi"
    assert falso.recebidas[-1]["caminho"] == "/v1/chat/completions"


def test_nuvem_nem_pergunta(falso):
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/v1/chat/completions", sse=openai_texto("oi"))
    list(openai_compat.conversar(_p(falso, local=False), [Mensagem("usuario", "x")]))
    assert falso.recebidas[-1]["caminho"] == "/v1/chat/completions"


def test_ollama_que_falha_ao_ler_o_pedido_do_modelo_tenta_de_novo(falso):
    """'qwen3.5 tool call parsing failed' → 500 do Ollama; na segunda vai."""
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", status=500, json={"error": "XML syntax error on line 3: element <function> closed by </parameter>"})
    falso.responder("/api/chat", headers=NDJSON, bruto=_ndjson(
        {"message": {"content": "", "tool_calls": [{"function": {"name": "learning", "arguments": {}}}]}, "done": False},
        {"message": {"content": ""}, "done": True, "done_reason": "stop"}))
    eventos = list(openai_compat.conversar(_p(falso), [Mensagem("usuario", "estudos")], [FERRAMENTA]))
    assert [e.chamada.nome for e in eventos if isinstance(e, Chamada)] == ["learning"]
    assert [r["caminho"] for r in falso.recebidas] == ["/api/chat", "/api/chat"]


def test_erro_que_persiste_chega_na_tela(falso):
    falso.responder("/api/version", json={"version": "0.30.8"})
    falso.responder("/api/chat", status=500, json={"error": "falhou"})
    with pytest.raises(transporte.ErroProvedor):
        list(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))
    assert len(falso.recebidas) == 1 + ollama_nativo.REPETIR_NO_ERRO
