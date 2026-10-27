"""
HTTP do assistente (IA-01): urllib da biblioteca padrão, como o resto do
backend (busca da Tavily, GitHub) — sem SDK de provedor e sem
dependência nova. O streaming é SSE, que é só texto linha a linha, e o
urllib lê isso bem.

Regras que valem pra TODA chamada a provedor:

- **Não segue redirecionamento.** O urllib, por padrão, repete os
  cabeçalhos (inclusive `Authorization`/`x-api-key`) no endereço novo,
  mesmo que seja outro domínio. Um provedor (ou um endereço digitado
  errado) que responda 30x levaria a chave pra onde a pessoa nunca
  escolheu — então 30x vira erro (`redirecionado`) e a pessoa vê o
  endereço novo pra conferir e colar, se for o caso (P-109).
- **Tempo limite** em toda leitura: `timeout` do urllib vale por
  operação de socket (conectar, cada leitura), não pela chamada inteira —
  num streaming, é o tempo máximo SEM receber nada. Modelo local
  carregando na memória demora bem mais pro primeiro pedaço, por isso o
  limite maior pra provedor local.
- **Erro sempre vira `ErroProvedor`** com um código fechado (lista em
  CODIGOS) que o router traduz pra mensagem da tela; o texto que o
  provedor mandou vai junto em `detalhe`, cortado e sem a chave (alguns
  provedores ecoam a chave na mensagem de "chave inválida").
- Nada aqui grava log com corpo de requisição ou cabeçalho.
"""
import json
import socket
import ssl
import threading
import urllib.error
import urllib.request
from typing import Iterator, Optional

# tempo máximo sem receber nada (segundos) — ver cabeçalho
TIMEOUT_NUVEM = 60
TIMEOUT_LOCAL = 180
# listar modelos / testar: resposta curta, sem streaming
TIMEOUT_CURTO_NUVEM = 20
TIMEOUT_CURTO_LOCAL = 60
DETALHE_MAX = 300

CODIGOS = {
    "chave_invalida",       # 401/403, ou 400 dizendo que a chave não vale
    "sem_credito",          # 402, cota/saldo esgotado
    "limite",               # 429: muitas chamadas em pouco tempo (limite do PROVEDOR)
    "modelo_indisponivel",  # modelo não existe / desativado / sem acesso
    "sem_ferramentas",      # o modelo não aceita chamada de ferramentas
    "url_errada",           # 404 fora do modelo, ou resposta que não é da API
    "redirecionado",        # 30x — ver cabeçalho
    "sem_conexao",          # não conectou (offline, porta fechada, DNS, TLS)
    "tempo_esgotado",       # ficou sem resposta além do limite
    "servidor",             # 5xx / sobrecarregado
    "recusado",             # outro 4xx (pedido que o provedor não aceitou)
    "resposta_invalida",    # veio algo que não dá pra ler
}


class ErroProvedor(Exception):
    def __init__(self, codigo: str, status: Optional[int] = None, detalhe: str = "", local_redirecionado: str = ""):
        assert codigo in CODIGOS, codigo
        super().__init__(f"{codigo} (http {status}): {detalhe}")
        self.codigo = codigo
        self.status = status
        self.detalhe = detalhe
        self.local_redirecionado = local_redirecionado


class _SemRedirecionamento(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # o urllib então levanta HTTPError com o 30x


_opener = urllib.request.build_opener(_SemRedirecionamento)


def _limpar(texto: str, segredo: Optional[str]) -> str:
    texto = " ".join(str(texto).split())
    if segredo:
        texto = texto.replace(segredo, "***")
    return texto[:DETALHE_MAX]


def _mensagem_do_corpo(corpo: bytes) -> str:
    """A mensagem de erro que o provedor mandou, nos formatos conhecidos:
    OpenAI {"error": {"message"}}, Anthropic {"type": "error", "error":
    {...}}, Gemini às vezes numa lista [{"error": {...}}]."""
    texto = corpo.decode("utf-8", "replace")
    try:
        dado = json.loads(texto)
    except ValueError:
        return texto
    if isinstance(dado, list) and dado:
        dado = dado[0]
    if isinstance(dado, dict):
        erro = dado.get("error", dado)
        if isinstance(erro, dict):
            partes = [str(erro.get(k)) for k in ("message", "type", "code", "status") if erro.get(k)]
            return " · ".join(partes) or texto
        if isinstance(erro, str):
            return erro
    return texto


def classificar_http(status: int, mensagem: str) -> str:
    m = mensagem.lower()
    if status in (401, 403):
        return "chave_invalida"
    if status == 402 or "insufficient_quota" in m or "credit balance" in m or "billing" in m:
        return "sem_credito"
    if status == 400 and "api key" in m and ("invalid" in m or "not valid" in m or "expired" in m):
        return "chave_invalida"  # Gemini responde 400 pra chave errada
    if status == 429:
        return "limite"
    if "tool" in m and ("support" in m or "not available" in m or "unsupported" in m):
        return "sem_ferramentas"
    if "model" in m and any(p in m for p in ("not found", "does not exist", "decommission", "deprecated", "not supported", "no access", "unknown", "invalid model", "not a valid model")):
        return "modelo_indisponivel"
    if status == 404:
        return "url_errada"
    if status >= 500:
        return "servidor"
    return "recusado"


def _erro_de_http(e: urllib.error.HTTPError, segredo: Optional[str]) -> ErroProvedor:
    if 300 <= e.code < 400:
        return ErroProvedor("redirecionado", e.code, "", _limpar(e.headers.get("Location", ""), segredo))
    try:
        corpo = e.read(20000)
    except Exception:  # noqa: BLE001 — corpo do erro é só pra mensagem
        corpo = b""
    mensagem = _mensagem_do_corpo(corpo)
    return ErroProvedor(classificar_http(e.code, mensagem), e.code, _limpar(mensagem, segredo))


def _erro_de_rede(e: Exception) -> ErroProvedor:
    razao = getattr(e, "reason", e)
    if isinstance(razao, (socket.timeout, TimeoutError)) or isinstance(e, (socket.timeout, TimeoutError)):
        return ErroProvedor("tempo_esgotado")
    if isinstance(razao, ssl.SSLError):
        return ErroProvedor("sem_conexao", None, "tls: " + _limpar(razao, None))
    return ErroProvedor("sem_conexao", None, _limpar(type(razao).__name__ + ": " + str(razao), None))


def _requisicao(url: str, headers: dict, corpo: Optional[dict]) -> urllib.request.Request:
    data = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    cab = {"Accept": "application/json", "User-Agent": "Kami"}
    cab.update(headers)
    if data is not None:
        cab["Content-Type"] = "application/json"
    return urllib.request.Request(url, data=data, headers=cab, method="POST" if data is not None else "GET")


def pedir_json(url: str, headers: dict, corpo: Optional[dict], timeout: float, segredo: Optional[str] = None) -> dict:
    """GET (corpo None) ou POST com JSON; devolve o JSON da resposta."""
    try:
        with _opener.open(_requisicao(url, headers, corpo), timeout=timeout) as resp:
            bruto = resp.read()
    except urllib.error.HTTPError as e:
        raise _erro_de_http(e, segredo) from None
    except (urllib.error.URLError, OSError) as e:
        raise _erro_de_rede(e) from None
    try:
        return json.loads(bruto.decode("utf-8"))
    except ValueError:
        # 200 com HTML (portal de wi-fi, URL de site em vez da API)
        raise ErroProvedor("url_errada", 200, _limpar(bruto[:200].decode("utf-8", "replace"), segredo)) from None


class Stream:
    """
    Resposta em SSE aberta. Use com `with`: fechar no meio (botão parar,
    a tela fechou, o teto bateu) corta a conexão com o provedor na hora —
    e com ela a geração que seria cobrada.
    """

    def __init__(self, resp, segredo: Optional[str]):
        self._resp = resp
        self._segredo = segredo
        self.fechado = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.fechar()

    def fechar(self):
        self.fechado = True
        try:
            self._resp.close()
        except Exception:  # noqa: BLE001
            pass

    def eventos(self) -> Iterator[tuple[str, str]]:
        """(nome do evento, dados) por evento SSE. Linhas `:` são
        comentário (o OpenRouter manda ": OPENROUTER PROCESSING" pra
        manter a conexão viva); várias linhas `data:` se juntam com \\n."""
        nome, dados = "", []
        try:
            for bruta in self._resp:
                linha = bruta.decode("utf-8", "replace").rstrip("\r\n")
                if not linha:
                    if dados:
                        yield nome or "message", "\n".join(dados)
                    nome, dados = "", []
                    continue
                if linha.startswith(":"):
                    continue
                campo, _, valor = linha.partition(":")
                valor = valor[1:] if valor.startswith(" ") else valor
                if campo == "event":
                    nome = valor
                elif campo == "data":
                    dados.append(valor)
            if dados:
                yield nome or "message", "\n".join(dados)
        except (socket.timeout, TimeoutError, urllib.error.URLError, OSError, ValueError, AttributeError) as e:
            # fechado por fora (Cancelamento) no meio da leitura: o erro
            # do socket é consequência do parar, não falha do provedor
            if self.fechado:
                raise Cancelado() from None
            if isinstance(e, (socket.timeout, TimeoutError)):
                raise ErroProvedor("tempo_esgotado") from None
            if isinstance(e, (urllib.error.URLError, OSError)):
                raise _erro_de_rede(e) from None
            raise
        if self.fechado:
            raise Cancelado()

    def mensagem_de_erro(self, dados: str) -> str:
        return _limpar(_mensagem_do_corpo(dados.encode("utf-8")), self._segredo)


class Cancelamento:
    """
    Botão parar / tela fechada (IA-02). A leitura do streaming fica
    bloqueada numa thread esperando o próximo pedaço; fechar a conexão
    por FORA (de outra thread) é o que destrava na hora — e corta a
    geração que seria cobrada. Quem lê registra o stream aberto aqui;
    `cancelar()` fecha o que estiver aberto e impede abrir outro.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._stream: Optional[Stream] = None
        self.cancelado = False

    def registrar(self, stream: "Stream") -> None:
        with self._lock:
            if self.cancelado:
                stream.fechar()
                raise Cancelado()
            self._stream = stream

    def cancelar(self) -> None:
        with self._lock:
            self.cancelado = True
            if self._stream is not None:
                self._stream.fechar()


class Cancelado(Exception):
    """A leitura foi interrompida de propósito (não é erro do provedor)."""


def abrir_stream(url: str, headers: dict, corpo: dict, timeout: float, segredo: Optional[str] = None) -> Stream:
    req = _requisicao(url, {**headers, "Accept": "text/event-stream"}, corpo)
    try:
        resp = _opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise _erro_de_http(e, segredo) from None
    except (urllib.error.URLError, OSError) as e:
        raise _erro_de_rede(e) from None
    tipo = resp.headers.get("Content-Type", "")
    if "json" in tipo and "event-stream" not in tipo:
        # alguns servidores respondem o erro como JSON com 200; e um que
        # ignore o pedido de streaming não serve (a tela depende dele)
        bruto = resp.read(20000)
        resp.close()
        mensagem = _mensagem_do_corpo(bruto)
        codigo = classificar_http(400, mensagem) if b'"error"' in bruto else "resposta_invalida"
        raise ErroProvedor(codigo, 200, _limpar(mensagem, segredo))
    return Stream(resp, segredo)
