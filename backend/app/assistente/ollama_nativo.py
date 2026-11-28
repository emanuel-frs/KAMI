"""
Ollama pela API nativa (`/api/chat`) — 2.1.0.

O Ollama abre o modelo com o contexto padrão dele (4096 tokens no 0.30) e o
endpoint compatível com OpenAI (`/v1/chat/completions`) não deixa pedir
outro: carregar com contexto maior pela API nativa e chamar o `/v1` em
seguida recarrega com 4096 (medido em 2026-11-27). Com as instruções, as
ferramentas e uma leitura, o pedido passava disso; o Ollama cortava o
começo ("truncating input prompt" no log) e a resposta saía com 1 ou 2
letras. Pela API nativa o Kami pede `options.num_ctx` a cada chamada.

Só vale pra provedor local que é um Ollama — conferido uma vez por
endereço com `GET /api/version` (o LM Studio e os outros servidores locais
respondem 404 e seguem pelo compatível com OpenAI). O resto do caminho é o
mesmo: os eventos que saem daqui são os de openai_compat._ler.
"""
import json
import time
from typing import Iterator, Optional

from app.assistente import transporte
from app.assistente.tipos import Chamada, ChamadaFerramenta, Ferramenta, Fim, Mensagem, Provedor, TextoDelta, Uso

# contexto pedido ao Ollama: instruções + ferramentas (~4 mil tokens no
# modelo local) + leituras + a conversa. Mais que isso pesa na memória sem
# ganho pro uso do Kami (o qwen3.5:4b a 12k cabe em 8 GB, sem placa de vídeo).
CONTEXTO = 12_288
_SONDA_NEGATIVA_S = 60
_sondas: dict[str, float | bool] = {}  # raiz → True, ou o instante da última resposta negativa


def raiz(p: Provedor) -> Optional[str]:
    url = p.url_base.rstrip("/")
    return url[:-3] if url.endswith("/v1") else None


def serve(p: Provedor) -> bool:
    """Este provedor é um Ollama no computador? (cache por endereço)"""
    base = raiz(p)
    if not p.local or not base:
        return False
    visto = _sondas.get(base)
    if visto is True:
        return True
    if isinstance(visto, float) and time.monotonic() - visto < _SONDA_NEGATIVA_S:
        return False
    try:
        r = transporte.pedir_json(f"{base}/api/version", {}, None, transporte.TIMEOUT_CURTO_LOCAL)
        eh = isinstance(r, dict) and isinstance(r.get("version"), str)
    except transporte.ErroProvedor:
        eh = False
    _sondas[base] = True if eh else time.monotonic()
    return eh


def esquecer() -> None:
    _sondas.clear()


def _mensagens(mensagens: list[Mensagem]) -> list[dict]:
    saida = []
    for m in mensagens:
        if m.papel == "sistema":
            saida.append({"role": "system", "content": m.texto})
        elif m.papel == "usuario":
            saida.append({"role": "user", "content": m.texto})
        elif m.papel == "assistente":
            item = {"role": "assistant", "content": m.texto or ""}
            if m.chamadas:
                item["tool_calls"] = [{"function": {"name": c.nome, "arguments": c.argumentos}} for c in m.chamadas]
            saida.append(item)
        elif m.papel == "ferramenta":
            saida.append({"role": "tool", "tool_name": m.nome_ferramenta, "content": m.texto})
        else:
            raise ValueError(f"papel desconhecido: {m.papel}")
    return saida


def _corpo(p: Provedor, mensagens, ferramentas, stream: bool) -> dict:
    from app.assistente.openai_compat import _ferramentas
    corpo = {"model": p.modelo, "messages": _mensagens(mensagens), "stream": stream,
             # o "pensar" do qwen3.5 sem placa de vídeo leva minutos (IA-07a);
             # o gpt-oss não desliga e fica no mínimo
             "think": "low" if "gpt-oss" in (p.modelo or "") else False,
             "options": {"num_ctx": CONTEXTO}}
    if ferramentas:
        corpo["tools"] = _ferramentas(ferramentas)
    return corpo


# o qwen3.5 às vezes escreve o pedido de ferramenta torto e o próprio Ollama
# falha ao ler ("qwen3.5 tool call parsing failed", HTTP 500 — visto em
# 2026-11-27); de novo, o modelo quase sempre acerta
REPETIR_NO_ERRO = 2


def conversar(p: Provedor, mensagens: list[Mensagem], ferramentas: Optional[list[Ferramenta]] = None,
              cancelamento: Optional[transporte.Cancelamento] = None) -> Iterator:
    from app.assistente.openai_compat import _timeout
    corpo = _corpo(p, mensagens, ferramentas, True)
    for tentativa in range(REPETIR_NO_ERRO + 1):
        saiu = False  # algum texto já foi pra tela: aí não dá pra repetir
        try:
            stream = transporte.abrir_stream(f"{raiz(p)}/api/chat", {}, corpo, _timeout(p), None, ndjson=True)
            if cancelamento:
                cancelamento.registrar(stream)
            with stream:
                for ev in _ler(stream, {f.nome for f in ferramentas or []}):
                    saiu = saiu or isinstance(ev, TextoDelta)
                    yield ev
            return
        except transporte.ErroProvedor as e:
            if saiu or tentativa == REPETIR_NO_ERRO or e.codigo not in ("servidor", "resposta_invalida"):
                raise


def aquecer(p: Provedor, mensagens: list[Mensagem], ferramentas: Optional[list[Ferramenta]] = None) -> None:
    """Lê instruções e ferramentas sem responder (1 token) — com o MESMO
    contexto da conversa, senão o Ollama recarrega o modelo no meio."""
    from app.assistente.openai_compat import _timeout
    corpo = _corpo(p, mensagens, ferramentas, False)
    corpo["options"]["num_predict"] = 1
    transporte.pedir_json(f"{raiz(p)}/api/chat", {}, corpo, _timeout(p), None)


def _ler(stream: transporte.Stream, nomes: set[str] = frozenset()) -> Iterator:
    """Uma linha JSON por pedaço (NDJSON). O texto que pode ser um pedido de
    ferramenta escrito como texto fica segurado, como no compatível."""
    from app.assistente.openai_compat import _chamadas_no_texto, _pode_ser_pedido
    chamadas: list[ChamadaFerramenta] = []
    uso, motivo = None, None
    segurado, segurando = "", bool(nomes)
    for linha in stream.linhas():
        try:
            pedaco = json.loads(linha)
        except ValueError:
            raise transporte.ErroProvedor("resposta_invalida", 200, linha[:200]) from None
        if not isinstance(pedaco, dict):
            continue
        if pedaco.get("error"):
            msg = stream.mensagem_de_erro(json.dumps({"error": {"message": str(pedaco["error"])}}))
            raise transporte.ErroProvedor(transporte.classificar_http(500, msg), None, msg)
        msg = pedaco.get("message") or {}
        texto = msg.get("content")
        if isinstance(texto, str) and texto:
            if segurando:
                segurado += texto
                if not _pode_ser_pedido(segurado):
                    segurando, texto, segurado = False, segurado, ""
                    yield TextoDelta(texto)
            else:
                yield TextoDelta(texto)
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function") or {}
            args = fn.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {"_invalido": args[:500]}
            if fn.get("name"):
                chamadas.append(ChamadaFerramenta(tc.get("id") or f"chamada_{len(chamadas)}", fn["name"],
                                                  args if isinstance(args, dict) else {}))
        if pedaco.get("done"):
            motivo = pedaco.get("done_reason")
            if pedaco.get("prompt_eval_count") is not None:
                uso = Uso(int(pedaco.get("prompt_eval_count") or 0), int(pedaco.get("eval_count") or 0))
    if segurado:
        no_texto = None if chamadas else _chamadas_no_texto(segurado, nomes)
        if no_texto:
            chamadas.extend(no_texto)
        else:
            yield TextoDelta(segurado)
    for c in chamadas:
        yield Chamada(c)
    if uso:
        yield uso
    yield Fim("ferramentas" if chamadas else {"length": "limite"}.get(motivo or "stop", "fim"))
