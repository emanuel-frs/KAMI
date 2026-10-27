"""
IA-01: adaptadores (compatível com OpenAI e Anthropic) e o transporte,
contra um servidor de verdade (provedor_falso.py) mandando os formatos
reais de cada provedor — pedaços de streaming, pedido de ferramenta
partido ou inteiro, uso de tokens, erros, redirecionamento, demora.
"""
import json

import pytest

from app.assistente import anthropic, openai_compat, provedores, transporte
from app.assistente.tipos import (
    Chamada, ChamadaFerramenta, Ferramenta, Fim, Mensagem, Provedor, TextoDelta, Uso,
)
from provedor_falso import ProvedorFalso, anthropic_texto, openai_texto

CHAVE = "sk-segredo-123456"
FERR = [Ferramenta("resumo_mes", "resumo do mês", {"type": "object", "properties": {"mes": {"type": "string"}}})]


@pytest.fixture()
def falso():
    f = ProvedorFalso()
    yield f
    f.fechar()


def _p(falso, tipo="openai", chave=CHAVE, modelo="m1"):
    return Provedor(tipo=tipo, url_base=falso.url, modelo=modelo, chave=chave, local=True)


def _eventos(gerador):
    return list(gerador)


def _texto(eventos):
    return "".join(e.delta for e in eventos if isinstance(e, TextoDelta))


# ── compatível com OpenAI ───────────────────────────────────────────────

def test_openai_texto_em_pedacos_com_uso(falso):
    falso.responder("/v1/chat/completions", sse=[": OPENROUTER PROCESSING", *openai_texto("Olá", ", tudo", " certo?")])
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("sistema", "sis"), Mensagem("usuario", "oi")]))
    assert _texto(ev) == "Olá, tudo certo?"
    assert Uso(10, 5) in ev and ev[-1] == Fim("fim")
    pedido = falso.recebidas[0]
    assert pedido["headers"]["authorization"] == f"Bearer {CHAVE}"
    assert pedido["json"]["model"] == "m1" and pedido["json"]["stream"] is True
    assert pedido["json"]["messages"] == [{"role": "system", "content": "sis"}, {"role": "user", "content": "oi"}]
    assert "max_tokens" not in pedido["json"]  # modelos de raciocínio da OpenAI recusam


def test_openai_ferramenta_em_pedacos_com_indice(falso):
    """OpenAI/Groq/OpenRouter: id e nome no 1º pedaço, argumentos aos poucos."""
    pedacos = [
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": "resumo_mes", "arguments": ""}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '{"me'}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": 's": "2026-10"}'}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 1, "id": "call_2", "function": {"name": "resumo_mes", "arguments": "{}"}}]}}]},
        {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
        {"choices": [], "x_groq": {"usage": {"prompt_tokens": 30, "completion_tokens": 9}}},
        "[DONE]",
    ]
    falso.responder("/v1/chat/completions", sse=pedacos)
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "e o mês?")], FERR))
    chamadas = [e.chamada for e in ev if isinstance(e, Chamada)]
    assert chamadas == [ChamadaFerramenta("call_1", "resumo_mes", {"mes": "2026-10"}),
                        ChamadaFerramenta("call_2", "resumo_mes", {})]
    assert Uso(30, 9) in ev and ev[-1] == Fim("ferramentas")
    assert falso.recebidas[0]["json"]["tools"][0]["function"]["name"] == "resumo_mes"


def test_ollama_e_gemini_ferramenta_inteira_sem_indice_e_finish_stop(falso):
    """Ollama manda tudo num pedaço e finish_reason 'stop' mesmo pedindo
    ferramenta; argumentos às vezes como objeto, não texto."""
    falso.responder("/v1/chat/completions", sse=[
        {"choices": [{"delta": {"tool_calls": [{"id": "a", "function": {"name": "resumo_mes", "arguments": {"mes": "2026-09"}}},
                                               {"id": "b", "function": {"name": "resumo_mes", "arguments": "{}"}}]}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
        "[DONE]",
    ])
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")], FERR))
    assert [e.chamada.id for e in ev if isinstance(e, Chamada)] == ["a", "b"]
    assert ev[-1] == Fim("ferramentas")
    assert not any(isinstance(e, Uso) for e in ev)  # local sem uso → uso.py estima


def test_openai_argumentos_invalidos_viram_marcacao(falso):
    falso.responder("/v1/chat/completions", sse=[
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c", "function": {"name": "resumo_mes", "arguments": "{quebrado"}}]}}]},
        "[DONE]"])
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")], FERR))
    assert [e.chamada.argumentos for e in ev if isinstance(e, Chamada)] == [{"_invalido": "{quebrado"}]


def test_openai_mensagens_com_ferramenta_e_resultado(falso):
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    msgs = [Mensagem("usuario", "x"),
            Mensagem("assistente", "", [ChamadaFerramenta("c1", "resumo_mes", {"mes": "2026-10"})]),
            Mensagem("ferramenta", '{"total": 10}', id_chamada="c1", nome_ferramenta="resumo_mes")]
    _eventos(openai_compat.conversar(_p(falso), msgs, FERR))
    enviadas = falso.recebidas[0]["json"]["messages"]
    assert enviadas[1] == {"role": "assistant", "content": None, "tool_calls": [
        {"id": "c1", "type": "function", "function": {"name": "resumo_mes", "arguments": '{"mes": "2026-10"}'}}]}
    assert enviadas[2] == {"role": "tool", "tool_call_id": "c1", "name": "resumo_mes", "content": '{"total": 10}'}


def test_openai_repete_sem_stream_options_quando_recusado(falso):
    falso.responder("/v1/chat/completions", status=400, json={"error": {"message": "Unrecognized request argument supplied: stream_options"}})
    falso.responder("/v1/chat/completions", sse=openai_texto("oi", uso=None))
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))
    assert _texto(ev) == "oi"
    assert "stream_options" in falso.recebidas[0]["json"] and "stream_options" not in falso.recebidas[1]["json"]


def test_openai_erro_no_meio_do_stream(falso):
    falso.responder("/v1/chat/completions", sse=[*openai_texto("começo", uso=None)[:1], {"error": {"message": "rate limit exceeded", "code": 429}}])
    with pytest.raises(transporte.ErroProvedor) as e:
        _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))
    assert e.value.codigo in ("limite", "servidor", "recusado")


def test_openai_listar_modelos_tira_prefixo_e_esconde_o_que_nao_conversa(falso):
    falso.responder("/v1/models", json={"object": "list", "data": [
        {"id": "models/gemini-x-flash"}, {"id": "gpt-z"}, {"id": "text-embedding-3-small"}, {"id": "whisper-large"},
        {"id": "Alfa"}, {"id": "gpt-z"}]})
    assert openai_compat.listar_modelos(_p(falso)) == ["Alfa", "gemini-x-flash", "gpt-z"]
    assert falso.recebidas[0]["headers"]["authorization"] == f"Bearer {CHAVE}"


def test_sem_chave_nao_manda_authorization(falso):
    falso.responder("/v1/models", json={"data": [{"id": "llama"}]})
    openai_compat.listar_modelos(_p(falso, chave=None))
    assert "authorization" not in falso.recebidas[0]["headers"]


# ── erros do transporte ────────────────────────────────────────────────

@pytest.mark.parametrize("status,corpo,codigo", [
    (401, {"error": {"message": "Incorrect API key provided: sk-segredo-123456"}}, "chave_invalida"),
    (403, {"error": {"message": "forbidden"}}, "chave_invalida"),
    (400, [{"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT"}}], "chave_invalida"),
    (402, {"error": {"message": "Insufficient credits"}}, "sem_credito"),
    (429, {"error": {"message": "You exceeded your current quota", "type": "insufficient_quota"}}, "sem_credito"),
    (429, {"error": {"message": "Rate limit reached"}}, "limite"),
    (404, {"error": {"message": "The model `xyz` does not exist"}}, "modelo_indisponivel"),
    (400, {"error": {"message": "model_decommissioned: the model has been decommissioned"}}, "modelo_indisponivel"),
    (400, {"error": {"message": "this model does not support tools"}}, "sem_ferramentas"),
    (404, {"detail": "Not Found"}, "url_errada"),
    (500, {"error": {"message": "boom"}}, "servidor"),
    (400, {"error": {"message": "bad request"}}, "recusado"),
])
def test_erros_http_classificados(falso, status, corpo, codigo):
    falso.responder("/v1/models", status=status, json=corpo)
    with pytest.raises(transporte.ErroProvedor) as e:
        openai_compat.listar_modelos(_p(falso))
    assert e.value.codigo == codigo and e.value.status == status
    assert CHAVE not in e.value.detalhe and CHAVE not in str(e.value)


def test_nao_segue_redirecionamento_nem_leva_a_chave(falso):
    outro = ProvedorFalso()
    try:
        outro.responder("/roubo/models", json={"data": [{"id": "x"}]})
        falso.responder("/v1/models", status=302, headers={"Location": outro.raiz + "/roubo/models"})
        with pytest.raises(transporte.ErroProvedor) as e:
            openai_compat.listar_modelos(_p(falso))
        assert e.value.codigo == "redirecionado" and e.value.local_redirecionado.endswith("/roubo/models")
        assert outro.recebidas == []  # a chave nunca chegou no outro endereço
    finally:
        outro.fechar()


def test_html_no_lugar_da_api_e_url_errada(falso):
    falso.responder("/v1/models", bruto=b"<html>portal do wi-fi</html>", headers={"Content-Type": "text/html"})
    with pytest.raises(transporte.ErroProvedor) as e:
        openai_compat.listar_modelos(_p(falso))
    assert e.value.codigo == "url_errada"


def test_stream_respondido_como_json_de_erro(falso):
    falso.responder("/v1/chat/completions", json={"error": {"message": "invalid model name"}})
    with pytest.raises(transporte.ErroProvedor) as e:
        _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))
    assert e.value.codigo == "modelo_indisponivel"


def test_tempo_esgotado(falso, monkeypatch):
    monkeypatch.setattr(transporte, "TIMEOUT_CURTO_LOCAL", 0.3)
    falso.responder("/v1/models", json={"data": []}, atraso=1.5)
    with pytest.raises(transporte.ErroProvedor) as e:
        openai_compat.listar_modelos(_p(falso))
    assert e.value.codigo == "tempo_esgotado"


def test_tempo_esgotado_no_meio_do_stream(falso, monkeypatch):
    monkeypatch.setattr(transporte, "TIMEOUT_LOCAL", 0.3)
    falso.responder("/v1/chat/completions", sse=openai_texto("a", "b", "c"), atraso_pedaco=1.0)
    with pytest.raises(transporte.ErroProvedor) as e:
        _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))
    assert e.value.codigo == "tempo_esgotado"


def test_sem_conexao_porta_fechada():
    falso = ProvedorFalso()
    url = falso.url
    falso.fechar()
    with pytest.raises(transporte.ErroProvedor) as e:
        openai_compat.listar_modelos(Provedor("openai", url, "m", None, True))
    assert e.value.codigo == "sem_conexao"


def test_parar_no_meio_fecha_a_conexao(falso):
    """Botão parar: largar o gerador fecha o stream (a geração cobrada para)."""
    falso.responder("/v1/chat/completions", sse=openai_texto(*["x"] * 50), atraso_pedaco=0.02)
    gen = openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")])
    assert isinstance(next(gen), TextoDelta)
    gen.close()  # não trava, não levanta


# ── Anthropic ─────────────────────────────────────────────────────────

def test_anthropic_texto_uso_e_cabecalhos(falso):
    falso.responder("/v1/messages", sse=anthropic_texto("Oi", " de novo"))
    ev = _eventos(anthropic.conversar(_p(falso, "anthropic"), [Mensagem("sistema", "regras"), Mensagem("usuario", "oi")]))
    assert _texto(ev) == "Oi de novo" and Uso(12, 7) in ev and ev[-1] == Fim("fim")
    pedido = falso.recebidas[0]
    assert pedido["headers"]["x-api-key"] == CHAVE and pedido["headers"]["anthropic-version"] == "2023-06-01"
    assert "authorization" not in pedido["headers"]
    assert pedido["json"]["system"] == "regras" and pedido["json"]["max_tokens"] == anthropic.MAX_TOKENS
    assert pedido["json"]["messages"] == [{"role": "user", "content": "oi"}]


def test_anthropic_ferramenta_com_json_em_pedacos(falso):
    falso.responder("/v1/messages", sse=[
        ("message_start", {"type": "message_start", "message": {"usage": {"input_tokens": 50, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "vou ver"}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "toolu_1", "name": "resumo_mes", "input": {}}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"mes": '}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '"2026-10"}'}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 1}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 20}}),
        ("message_stop", {"type": "message_stop"}),
    ])
    ev = _eventos(anthropic.conversar(_p(falso, "anthropic"), [Mensagem("usuario", "x")], FERR))
    assert _texto(ev) == "vou ver"
    assert [e.chamada for e in ev if isinstance(e, Chamada)] == [ChamadaFerramenta("toolu_1", "resumo_mes", {"mes": "2026-10"})]
    assert Uso(50, 20) in ev and ev[-1] == Fim("ferramentas")
    assert falso.recebidas[0]["json"]["tools"] == [{"name": "resumo_mes", "description": "resumo do mês", "input_schema": FERR[0].parametros}]


def test_anthropic_resultados_seguidos_numa_mensagem_so(falso):
    falso.responder("/v1/messages", sse=anthropic_texto("ok"))
    msgs = [Mensagem("usuario", "x"),
            Mensagem("assistente", "olhando", [ChamadaFerramenta("t1", "a", {}), ChamadaFerramenta("t2", "b", {"k": 1})]),
            Mensagem("ferramenta", "r1", id_chamada="t1", nome_ferramenta="a"),
            Mensagem("ferramenta", "r2", id_chamada="t2", nome_ferramenta="b")]
    _eventos(anthropic.conversar(_p(falso, "anthropic"), msgs))
    enviadas = falso.recebidas[0]["json"]["messages"]
    assert enviadas[1] == {"role": "assistant", "content": [
        {"type": "text", "text": "olhando"},
        {"type": "tool_use", "id": "t1", "name": "a", "input": {}},
        {"type": "tool_use", "id": "t2", "name": "b", "input": {"k": 1}}]}
    assert enviadas[2] == {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t1", "content": "r1"},
        {"type": "tool_result", "tool_use_id": "t2", "content": "r2"}]}
    assert len(enviadas) == 3


def test_anthropic_evento_de_erro_sobrecarregado(falso):
    falso.responder("/v1/messages", sse=[("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})])
    with pytest.raises(transporte.ErroProvedor) as e:
        _eventos(anthropic.conversar(_p(falso, "anthropic"), [Mensagem("usuario", "x")]))
    assert e.value.codigo == "servidor"


def test_anthropic_sem_credito_vem_como_400(falso):
    falso.responder("/v1/messages", status=400, json={"type": "error", "error": {"type": "invalid_request_error", "message": "Your credit balance is too low to access the Anthropic API."}})
    with pytest.raises(transporte.ErroProvedor) as e:
        _eventos(anthropic.conversar(_p(falso, "anthropic"), [Mensagem("usuario", "x")]))
    assert e.value.codigo == "sem_credito"


def test_anthropic_listar_modelos(falso):
    falso.responder("/v1/models", json={"data": [{"id": "claude-b", "type": "model"}, {"id": "claude-a", "type": "model"}], "has_more": False})
    assert anthropic.listar_modelos(_p(falso, "anthropic")) == ["claude-a", "claude-b"]
    assert falso.recebidas[0]["caminho"] == "/v1/models?limit=1000"


# ── testar conexão ────────────────────────────────────────────────────

def test_testar_detecta_ferramentas(falso):
    falso.responder("/v1/chat/completions", sse=[
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c", "function": {"name": "confirmar_conexao", "arguments": '{"ok": true}'}}]}}]},
        "[DONE]"])
    r = provedores.testar(_p(falso))
    assert r["ok"] and r["ferramentas"] is True


def test_testar_modelo_que_responde_em_texto(falso):
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    r = provedores.testar(_p(falso))
    assert r["ok"] and r["ferramentas"] is False and r["uso"] == Uso(10, 5)


def test_testar_provedor_que_recusa_ferramentas_repete_sem(falso):
    falso.responder("/v1/chat/completions", status=400, json={"error": {"message": "tools are not supported for this model"}})
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    r = provedores.testar(_p(falso))
    assert r["ok"] and r["ferramentas"] is False
    assert "tools" in falso.recebidas[0]["json"] and "tools" not in falso.recebidas[1]["json"]


# ── endereço (P-109) ─────────────────────────────────────────────────

@pytest.mark.parametrize("url,esperado", [
    ("https://api.groq.com/openai/v1/", ("https://api.groq.com/openai/v1", False)),
    ("http://localhost:11434/v1", ("http://localhost:11434/v1", True)),
    ("http://127.0.0.1:1234/v1", ("http://127.0.0.1:1234/v1", True)),
    ("http://192.168.0.20:11434/v1", ("http://192.168.0.20:11434/v1", True)),
    ("http://[::1]:11434/v1", ("http://[::1]:11434/v1", True)),
    ("http://pc-da-sala.local:11434/v1", ("http://pc-da-sala.local:11434/v1", True)),
    ("https://10.0.0.5/v1", ("https://10.0.0.5/v1", True)),
])
def test_url_aceita(url, esperado):
    assert provedores.normalizar_url(url) == esperado


@pytest.mark.parametrize("url,motivo", [
    ("", "vazia"),
    ("api.groq.com/openai/v1", "esquema"),
    ("ftp://x.com", "esquema"),
    ("http://api.groq.com/openai/v1", "http_fora_da_rede"),
    ("http://8.8.8.8/v1", "http_fora_da_rede"),
    ("https://user:senha@api.x.com/v1", "credenciais"),
    ("https://api.x.com/v1?key=abc", "consulta"),
    ("https://api.x.com/v1#x", "consulta"),
    ("https:///v1", "host"),
])
def test_url_recusada(url, motivo):
    with pytest.raises(provedores.UrlInvalida) as e:
        provedores.normalizar_url(url)
    assert e.value.motivo == motivo


def test_transporte_codigos_fechados():
    with pytest.raises(AssertionError):
        transporte.ErroProvedor("inventado")
    assert json.dumps(sorted(transporte.CODIGOS))  # lista serializável (vai pra tela)


# ── pedido de ferramenta escrito como texto (modelos locais) ─────────────

def _sse_texto(*pedacos):
    return [{"choices": [{"delta": {"content": p}}]} for p in pedacos] + [{"choices": [{"delta": {}, "finish_reason": "stop"}]}, "[DONE]"]


@pytest.mark.parametrize("pedacos", [
    ('{\n    "name": "resumo_mes",\n', '    "arguments": {"mes": "2026-10"}\n}'),  # qwen2.5-coder no Ollama
    ('<tool_call>\n{"name": "resumo_mes", "arguments": {"mes": "2026-10"}}\n</tool_call>',),
    ("```json\n", '{"name": "resumo_mes", "parameters": {"mes": "2026-10"}}', "\n```"),
    ('[{"name": "resumo_mes", "arguments": "{\\"mes\\": \\"2026-10\\"}"}]',),
])
def test_pedido_em_texto_vira_chamada_sem_aparecer_na_tela(falso, pedacos):
    falso.responder("/v1/chat/completions", sse=_sse_texto(*pedacos))
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")], FERR))
    assert _texto(ev) == ""
    assert [e.chamada for e in ev if isinstance(e, Chamada)] == [ChamadaFerramenta("texto_0", "resumo_mes", {"mes": "2026-10"})]
    assert ev[-1] == Fim("ferramentas")


@pytest.mark.parametrize("pedacos", [
    ('{"name": "apagar_tudo", "arguments": {}}',),   # ferramenta que não foi oferecida
    ('{"name": "resumo_mes", "arguments": {}} e mais texto',),
    ('{"total": 10}',),
    ("[x] pagar a conta\n", "[ ] estudar"),
    ("```python\nprint(1)\n```",),
    ("Olá! ", "Seu mês: {", "\"x\": 1}"),
])
def test_texto_comum_continua_texto(falso, pedacos):
    falso.responder("/v1/chat/completions", sse=_sse_texto(*pedacos))
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")], FERR))
    assert _texto(ev) == "".join(pedacos)
    assert not any(isinstance(e, Chamada) for e in ev) and ev[-1] == Fim("fim")


def test_lista_em_markdown_sai_em_streaming_logo(falso):
    """Só os primeiros caracteres ficam segurados: o 1º pedaço já sai."""
    falso.responder("/v1/chat/completions", sse=_sse_texto("[x] pagar", " a conta", " hoje"))
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")], FERR))
    assert [e.delta for e in ev if isinstance(e, TextoDelta)] == ["[x] pagar", " a conta", " hoje"]


def test_sem_ferramentas_oferecidas_nada_e_segurado(falso):
    falso.responder("/v1/chat/completions", sse=_sse_texto('{"name": ', '"resumo_mes"}'))
    ev = _eventos(openai_compat.conversar(_p(falso), [Mensagem("usuario", "x")]))
    assert [e.delta for e in ev if isinstance(e, TextoDelta)] == ['{"name": ', '"resumo_mes"}']
