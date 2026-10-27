"""
Adaptador da API Messages da Anthropic (IA-01): `POST {url_base}/messages`
e `GET {url_base}/models`, cabeçalhos `x-api-key` e `anthropic-version`.

Diferenças pro formato compatível com OpenAI que este arquivo absorve:

- instrução de sistema num campo à parte (`system`), não numa mensagem;
- `max_tokens` é obrigatório (MAX_TOKENS abaixo — teto por resposta; o
  diário fica em uso.py);
- pedido de ferramenta é um bloco `tool_use` dentro da resposta, e o
  resultado volta como bloco `tool_result` numa mensagem da PESSOA —
  vários resultados seguidos vão juntos numa mensagem só;
- streaming com eventos nomeados (message_start, content_block_start,
  content_block_delta, message_delta, error…); os argumentos da
  ferramenta chegam em pedaços de JSON (`input_json_delta`) e só são
  decodificados no fim do bloco;
- uso de tokens: entrada no `message_start`, saída (acumulada) no
  `message_delta`.
"""
import json
from typing import Iterator, Optional

from app.assistente import transporte
from app.assistente.tipos import (
    Chamada, ChamadaFerramenta, Ferramenta, Fim, Mensagem, Provedor, TextoDelta, Uso,
)

VERSAO_API = "2023-06-01"
MAX_TOKENS = 4096


def _cabecalhos(p: Provedor) -> dict:
    cab = {"anthropic-version": VERSAO_API}
    if p.chave:
        cab["x-api-key"] = p.chave
    return cab


def listar_modelos(p: Provedor) -> list[str]:
    dado = transporte.pedir_json(
        f"{p.url_base}/models?limit=1000", _cabecalhos(p), None, transporte.TIMEOUT_CURTO_NUVEM, p.chave
    )
    itens = dado.get("data") if isinstance(dado, dict) else None
    if not isinstance(itens, list):
        raise transporte.ErroProvedor("url_errada", 200, "a resposta de /models não tem a lista de modelos")
    return sorted({i["id"] for i in itens if isinstance(i, dict) and isinstance(i.get("id"), str)}, key=str.lower)


def _corpo(p: Provedor, mensagens: list[Mensagem], ferramentas: Optional[list[Ferramenta]]) -> dict:
    sistema = "\n\n".join(m.texto for m in mensagens if m.papel == "sistema")
    saida: list[dict] = []
    for m in mensagens:
        if m.papel == "sistema":
            continue
        if m.papel == "usuario":
            saida.append({"role": "user", "content": m.texto})
        elif m.papel == "assistente":
            blocos = [{"type": "text", "text": m.texto}] if m.texto else []
            blocos += [{"type": "tool_use", "id": c.id, "name": c.nome, "input": c.argumentos} for c in m.chamadas]
            saida.append({"role": "assistant", "content": blocos or [{"type": "text", "text": ""}]})
        elif m.papel == "ferramenta":
            bloco = {"type": "tool_result", "tool_use_id": m.id_chamada, "content": m.texto}
            anterior = saida[-1] if saida else None
            if anterior and anterior["role"] == "user" and isinstance(anterior["content"], list) \
                    and anterior["content"] and anterior["content"][0].get("type") == "tool_result":
                anterior["content"].append(bloco)
            else:
                saida.append({"role": "user", "content": [bloco]})
        else:
            raise ValueError(f"papel desconhecido: {m.papel}")
    corpo = {"model": p.modelo, "max_tokens": MAX_TOKENS, "messages": saida, "stream": True}
    if sistema:
        corpo["system"] = sistema
    if ferramentas:
        corpo["tools"] = [{"name": f.nome, "description": f.descricao, "input_schema": f.parametros} for f in ferramentas]
    return corpo


def conversar(p: Provedor, mensagens: list[Mensagem], ferramentas: Optional[list[Ferramenta]] = None,
              cancelamento: Optional[transporte.Cancelamento] = None) -> Iterator:
    timeout = transporte.TIMEOUT_LOCAL if p.local else transporte.TIMEOUT_NUVEM
    stream = transporte.abrir_stream(f"{p.url_base}/messages", _cabecalhos(p), _corpo(p, mensagens, ferramentas), timeout, p.chave)
    if cancelamento:
        cancelamento.registrar(stream)
    with stream:
        yield from _ler(stream)


def _ler(stream: transporte.Stream) -> Iterator:
    blocos: dict[int, dict] = {}  # índice → {"id", "nome", "json"} dos tool_use
    entrada = saida = 0
    motivo = None
    teve_uso = False
    for evento, dados in stream.eventos():
        try:
            dado = json.loads(dados)
        except ValueError:
            raise transporte.ErroProvedor("resposta_invalida", 200, dados[:200]) from None
        tipo = dado.get("type", evento) if isinstance(dado, dict) else evento
        if tipo == "error":
            msg = stream.mensagem_de_erro(dados)
            codigo = "servidor" if "overloaded" in msg.lower() else transporte.classificar_http(500, msg)
            raise transporte.ErroProvedor(codigo, None, msg)
        if tipo == "message_start":
            u = (dado.get("message") or {}).get("usage") or {}
            entrada = int(u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0) \
                + int(u.get("cache_creation_input_tokens") or 0)
            saida = int(u.get("output_tokens") or 0)
            teve_uso = True
        elif tipo == "content_block_start":
            bloco = dado.get("content_block") or {}
            if bloco.get("type") == "tool_use":
                blocos[dado.get("index", len(blocos))] = {"id": bloco.get("id", ""), "nome": bloco.get("name", ""), "json": ""}
        elif tipo == "content_block_delta":
            delta = dado.get("delta") or {}
            if delta.get("type") == "text_delta" and delta.get("text"):
                yield TextoDelta(delta["text"])
            elif delta.get("type") == "input_json_delta":
                alvo = blocos.get(dado.get("index"))
                if alvo is not None:
                    alvo["json"] += delta.get("partial_json") or ""
        elif tipo == "message_delta":
            motivo = (dado.get("delta") or {}).get("stop_reason") or motivo
            u = dado.get("usage") or {}
            if u.get("output_tokens") is not None:
                saida = int(u["output_tokens"])
                teve_uso = True
        elif tipo == "message_stop":
            break
    for idx in sorted(blocos):
        b = blocos[idx]
        try:
            args = json.loads(b["json"]) if b["json"].strip() else {}
        except ValueError:
            args = {"_invalido": b["json"][:500]}
        yield Chamada(ChamadaFerramenta(b["id"], b["nome"], args if isinstance(args, dict) else {"_invalido": b["json"][:500]}))
    if teve_uso:
        yield Uso(entrada, saida)
    if blocos:
        yield Fim("ferramentas")
    else:
        yield Fim({"end_turn": "fim", "stop_sequence": "fim", "max_tokens": "limite", "tool_use": "ferramentas"}.get(motivo or "end_turn", "outro"))
