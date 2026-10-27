"""
Adaptador "compatível com OpenAI" (IA-01): `POST {url_base}/chat/completions`
e `GET {url_base}/models`. É o formato que quase todo provedor copia —
OpenAI, Google Gemini (endpoint .../v1beta/openai), Groq, OpenRouter,
Mistral, Ollama e LM Studio —, e é também o do provedor "outro".

"Compatível" não quer dizer idêntico. As diferenças que já conhecemos e
que este arquivo absorve (cada uma testada em tests/test_assistente_
adaptadores.py com o formato real que o provedor manda):

- pedido de ferramenta em pedaços (`delta.tool_calls[i]` com `index`,
  `function.arguments` chegando aos poucos) na OpenAI/Groq/OpenRouter;
  inteiro num pedaço só, às vezes sem `index`, no Gemini e no Ollama;
- `finish_reason` sempre "stop" no Ollama, mesmo quando pediu
  ferramenta — o motivo do fim sai do que chegou, não só do campo;
- uso de tokens: `usage` no último pedaço quando pedimos
  `stream_options.include_usage`; o Groq também manda em `x_groq.usage`;
  alguns servidores locais não mandam nada (uso.py estima);
- servidor que recusa `stream_options` (campo desconhecido) → repete uma
  vez sem ele;
- ids de modelo do Gemini vêm como "models/gemini-…" no /models, e o
  /chat/completions quer sem o prefixo.

- modelo local que escreve o pedido de ferramenta como TEXTO (o
  qwen2.5-coder no Ollama 0.30 manda `{"name": …, "arguments": …}` no
  `content`, com `finish_reason` "stop") — ver `_chamadas_no_texto`.

`max_tokens` NÃO é enviado: os modelos de raciocínio da OpenAI recusam o
campo (querem `max_completion_tokens`, que outros provedores não
conhecem). Quem segura o gasto é o teto diário (uso.py) e o botão parar.
"""
import json
from typing import Iterator, Optional

from app.assistente import transporte
from app.assistente.tipos import (
    Chamada, ChamadaFerramenta, Ferramenta, Fim, Mensagem, Provedor, TextoDelta, Uso,
)

# nomes de modelo que claramente não conversam (o /models da OpenAI e do
# Groq lista tudo junto). Só esconde da lista: o campo de modelo continua
# aceitando qualquer nome digitado (princípio 8).
_NAO_CONVERSA = ("embed", "whisper", "tts", "dall-e", "moderation", "transcribe", "audio", "image", "guard", "rerank")


def _cabecalhos(p: Provedor) -> dict:
    return {"Authorization": f"Bearer {p.chave}"} if p.chave else {}


def _timeout(p: Provedor, curto: bool = False) -> float:
    if curto:
        return transporte.TIMEOUT_CURTO_LOCAL if p.local else transporte.TIMEOUT_CURTO_NUVEM
    return transporte.TIMEOUT_LOCAL if p.local else transporte.TIMEOUT_NUVEM


def listar_modelos(p: Provedor) -> list[str]:
    dado = transporte.pedir_json(f"{p.url_base}/models", _cabecalhos(p), None, _timeout(p, curto=True), p.chave)
    itens = dado.get("data") if isinstance(dado, dict) else None
    if itens is None and isinstance(dado, dict):
        itens = dado.get("models")  # alguns servidores locais
    if not isinstance(itens, list):
        raise transporte.ErroProvedor("url_errada", 200, "a resposta de /models não tem a lista de modelos")
    ids = set()
    for item in itens:
        mid = item.get("id") or item.get("name") if isinstance(item, dict) else item
        if not isinstance(mid, str) or not mid:
            continue
        mid = mid.removeprefix("models/")
        if not any(p_ in mid.lower() for p_ in _NAO_CONVERSA):
            ids.add(mid)
    return sorted(ids, key=str.lower)


def _mensagens(mensagens: list[Mensagem]) -> list[dict]:
    saida = []
    for m in mensagens:
        if m.papel == "sistema":
            saida.append({"role": "system", "content": m.texto})
        elif m.papel == "usuario":
            saida.append({"role": "user", "content": m.texto})
        elif m.papel == "assistente":
            item = {"role": "assistant", "content": m.texto or None}
            if m.chamadas:
                item["tool_calls"] = [
                    {"id": c.id, "type": "function",
                     "function": {"name": c.nome, "arguments": json.dumps(c.argumentos, ensure_ascii=False)}}
                    for c in m.chamadas
                ]
            saida.append(item)
        elif m.papel == "ferramenta":
            saida.append({"role": "tool", "tool_call_id": m.id_chamada, "name": m.nome_ferramenta, "content": m.texto})
        else:
            raise ValueError(f"papel desconhecido: {m.papel}")
    return saida


def _ferramentas(ferramentas: list[Ferramenta]) -> list[dict]:
    return [
        {"type": "function", "function": {"name": f.nome, "description": f.descricao, "parameters": f.parametros}}
        for f in ferramentas
    ]


def _argumentos(bruto: str) -> dict:
    if not bruto or not bruto.strip():
        return {}
    try:
        dado = json.loads(bruto)
    except ValueError:
        return {"_invalido": bruto[:500]}  # quem executa devolve o erro pro modelo
    return dado if isinstance(dado, dict) else {"_invalido": bruto[:500]}


def conversar(p: Provedor, mensagens: list[Mensagem], ferramentas: Optional[list[Ferramenta]] = None,
              cancelamento: Optional[transporte.Cancelamento] = None) -> Iterator:
    corpo = {"model": p.modelo, "messages": _mensagens(mensagens), "stream": True,
             "stream_options": {"include_usage": True}}
    if ferramentas:
        corpo["tools"] = _ferramentas(ferramentas)
    url = f"{p.url_base}/chat/completions"
    try:
        stream = transporte.abrir_stream(url, _cabecalhos(p), corpo, _timeout(p), p.chave)
    except transporte.ErroProvedor as e:
        if e.codigo != "recusado" or "stream_options" not in e.detalhe:
            raise
        corpo.pop("stream_options")
        stream = transporte.abrir_stream(url, _cabecalhos(p), corpo, _timeout(p), p.chave)
    if cancelamento:
        cancelamento.registrar(stream)
    with stream:
        yield from _ler(stream, {f.nome for f in ferramentas or []})


# ── pedido de ferramenta escrito como texto ───────────────────────────────
# Alguns modelos locais não usam o campo `tool_calls` e escrevem o pedido
# no texto: um objeto JSON {"name", "arguments"|"parameters"}, às vezes
# dentro de ```json … ``` ou <tool_call> … </tool_call>, ou uma lista
# deles. Só vale como pedido quando a resposta INTEIRA é isso e todo nome
# é de uma ferramenta oferecida nesta chamada — qualquer outra coisa
# continua sendo texto pra pessoa. É saída do próprio modelo (não dado de
# fora), e ferramenta nenhuma escreve sem a prévia do princípio 4.
#
# Pra o JSON não piscar na tela antes de virar pedido, o começo da
# resposta fica SEGURADO enquanto ainda pode ser um pedido desses
# (começa com `{`, `[`, ``` ou `<tool_call>`); assim que fica claro que
# não é, o que estava segurado sai de uma vez e o resto segue em streaming.
def _pode_ser_pedido(texto: str) -> bool:
    """Ainda dá pra ser um pedido em texto? Estrito o bastante pra uma
    lista em markdown ("[x] …") ou um bloco de código ("```python")
    voltarem a sair em streaming logo nos primeiros caracteres."""
    t = texto.lstrip()
    if not t:
        return True
    if t.startswith("{"):
        resto = t[1:].lstrip()
        return not resto or resto.startswith('"')
    if t.startswith("["):
        resto = t[1:].lstrip()
        return not resto or (resto.startswith("{") and _pode_ser_pedido(resto))
    for marca in ("```", "<tool_call>"):
        if marca.startswith(t):
            return True
        if t.startswith(marca):
            resto = t[len(marca):].lstrip()
            if marca == "```":
                if "json".startswith(resto.lower()):
                    return True
                if resto.lower().startswith("json"):
                    resto = resto[4:].lstrip()
            return not resto or _pode_ser_pedido(resto)
    return False


def _chamadas_no_texto(texto: str, nomes: set[str]) -> list[ChamadaFerramenta] | None:
    t = texto.strip()
    if t.startswith("<tool_call>") and t.endswith("</tool_call>"):
        t = t[len("<tool_call>"):-len("</tool_call>")].strip()
    elif t.startswith("```") and t.endswith("```"):
        t = t[3:-3].strip()
        t = t[4:].strip() if t.lower().startswith("json") else t
    try:
        dado = json.loads(t)
    except ValueError:
        return None
    itens = dado if isinstance(dado, list) else [dado]
    chamadas = []
    for i, item in enumerate(itens):
        if not isinstance(item, dict) or item.get("name") not in nomes:
            return None
        args = item.get("arguments", item.get("parameters", {}))
        if isinstance(args, str):
            args = _argumentos(args)
        if not isinstance(args, dict):
            return None
        chamadas.append(ChamadaFerramenta(f"texto_{i}", item["name"], args))
    return chamadas or None


def _ler(stream: transporte.Stream, nomes: set[str] = frozenset()) -> Iterator:
    chamadas: dict[int, dict] = {}  # índice → {"id", "nome", "args"}
    motivo = None
    uso = None
    segurado = ""  # começo da resposta que ainda pode ser pedido em texto
    segurando = bool(nomes)
    for _evento, dados in stream.eventos():
        if dados.strip() == "[DONE]":
            break
        try:
            pedaco = json.loads(dados)
        except ValueError:
            raise transporte.ErroProvedor("resposta_invalida", 200, dados[:200]) from None
        if not isinstance(pedaco, dict):
            continue
        if pedaco.get("error"):
            msg = stream.mensagem_de_erro(dados)
            raise transporte.ErroProvedor(transporte.classificar_http(500, msg), None, msg)
        bruto_uso = pedaco.get("usage") or (pedaco.get("x_groq") or {}).get("usage")
        if isinstance(bruto_uso, dict) and bruto_uso.get("prompt_tokens") is not None:
            uso = Uso(int(bruto_uso.get("prompt_tokens") or 0), int(bruto_uso.get("completion_tokens") or 0))
        for escolha in pedaco.get("choices") or []:
            delta = escolha.get("delta") or {}
            texto = delta.get("content")
            if isinstance(texto, str) and texto:
                if segurando:
                    segurado += texto
                    if _pode_ser_pedido(segurado):
                        continue
                    segurando, texto, segurado = False, segurado, ""
                yield TextoDelta(texto)
            for pos, tc in enumerate(delta.get("tool_calls") or []):
                fn = tc.get("function") or {}
                if isinstance(tc.get("index"), int):
                    idx = tc["index"]
                elif tc.get("id") and not any(c["id"] == tc["id"] for c in chamadas.values()):
                    idx = len(chamadas)  # Gemini/Ollama: inteiro, sem índice
                else:
                    idx = max(chamadas) if chamadas else pos
                atual = chamadas.setdefault(idx, {"id": "", "nome": "", "args": ""})
                atual["id"] = tc.get("id") or atual["id"]
                atual["nome"] = fn.get("name") or atual["nome"]
                args = fn.get("arguments")
                if isinstance(args, dict):  # alguns servidores mandam objeto, não texto
                    args = json.dumps(args)
                atual["args"] += args or ""
            if escolha.get("finish_reason"):
                motivo = escolha["finish_reason"]
    if segurado:
        no_texto = None if chamadas else _chamadas_no_texto(segurado, nomes)
        if no_texto:
            for i, c in enumerate(no_texto):
                chamadas[i] = {"id": c.id, "nome": c.nome, "args": json.dumps(c.argumentos)}
        else:
            yield TextoDelta(segurado)
    for idx in sorted(chamadas):
        c = chamadas[idx]
        if c["nome"]:
            yield Chamada(ChamadaFerramenta(c["id"] or f"chamada_{idx}", c["nome"], _argumentos(c["args"])))
    if uso:
        yield uso
    if chamadas:
        yield Fim("ferramentas")
    else:
        yield Fim({"stop": "fim", "length": "limite", "tool_calls": "ferramentas"}.get(motivo or "stop", "outro"))
