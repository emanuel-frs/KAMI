"""
Ponte entre a configuração salva e os adaptadores (IA-01): escolhe o
adaptador pelo formato da API, valida o endereço (P-109) e faz o "testar
conexão".

Endereço (P-109):
- `https://` em qualquer lugar;
- `http://` só pra este computador ou a rede local (Ollama/LM Studio em
  outra máquina da casa) — chave de provedor na nuvem nunca viaja sem
  TLS;
- sem usuário/senha embutidos, sem `?` ou `#` (a chave nunca vai na URL);
- a barra do fim sai (os adaptadores montam `{url_base}/models`).

Local × nuvem (princípio 5, a tela mostra qual é): endereço deste
computador ou da rede local conta como local — é o que decide se o que a
pessoa escreve sai da máquina/casa.
"""
import ipaddress
import time
from urllib.parse import urlsplit

from app.assistente import anthropic, openai_compat, transporte
from app.assistente.tipos import Ferramenta, Mensagem, Provedor

ADAPTADORES = {"openai": openai_compat, "anthropic": anthropic}


class UrlInvalida(ValueError):
    def __init__(self, motivo: str):
        super().__init__(motivo)
        self.motivo = motivo  # vazia | esquema | credenciais | consulta | http_fora_da_rede | host


def _host_local(host: str) -> bool:
    host = host.strip("[]").lower()
    if host in ("localhost",) or host.endswith(".localhost") or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


def normalizar_url(url: str) -> tuple[str, bool]:
    """(url limpa, é local?) — ou UrlInvalida com o motivo."""
    url = (url or "").strip()
    if not url:
        raise UrlInvalida("vazia")
    partes = urlsplit(url)
    if partes.scheme not in ("http", "https"):
        raise UrlInvalida("esquema")
    if partes.username or partes.password:
        raise UrlInvalida("credenciais")
    if partes.query or partes.fragment or "?" in url or "#" in url:
        raise UrlInvalida("consulta")
    host = partes.hostname or ""
    if not host:
        raise UrlInvalida("host")
    local = _host_local(host)
    if partes.scheme == "http" and not local:
        raise UrlInvalida("http_fora_da_rede")
    return url.rstrip("/"), local


def adaptador(tipo: str):
    return ADAPTADORES[tipo]


def listar_modelos(p: Provedor) -> list[str]:
    return adaptador(p.tipo).listar_modelos(p)


# ── testar conexão ──────────────────────────────────────────────────────
# Uma chamada só (gasta pouco e conta no teto): pede pro modelo usar uma
# ferramenta de mentira. Se ele chamar, conexão e ferramentas funcionam
# (a Fase 3 depende delas); se responder em texto, a conexão funciona mas
# o modelo não usa ferramentas; se o provedor recusar o campo `tools`,
# repete sem ferramentas pra ao menos confirmar a conexão.

_FERRAMENTA_TESTE = Ferramenta(
    nome="confirmar_conexao",
    descricao="Confirma que a conexão com o Kami funciona. Chame sempre que pedirem um teste de conexão.",
    parametros={"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]},
)
_PEDIDO_TESTE = "Teste de conexão: chame a ferramenta confirmar_conexao com ok=true. Não escreva mais nada."
_PEDIDO_SEM_FERRAMENTA = "Teste de conexão: responda apenas com a palavra ok."


def _rodar(p: Provedor, mensagens, ferramentas):
    texto, chamou, uso = "", False, None
    for ev in adaptador(p.tipo).conversar(p, mensagens, ferramentas):
        nome = type(ev).__name__
        if nome == "TextoDelta":
            texto += ev.delta
        elif nome == "Chamada":
            chamou = chamou or ev.chamada.nome == _FERRAMENTA_TESTE.nome
        elif nome == "Uso":
            uso = ev
    return texto, chamou, uso


def testar(p: Provedor) -> dict:
    """{"ok", "ferramentas", "ms", "uso": Uso|None, "texto"} — ou ErroProvedor."""
    inicio = time.monotonic()
    try:
        texto, chamou, uso = _rodar(p, [Mensagem("usuario", _PEDIDO_TESTE)], [_FERRAMENTA_TESTE])
        ferramentas = chamou
    except transporte.ErroProvedor as e:
        if e.codigo not in ("sem_ferramentas", "recusado"):
            raise
        texto, _, uso = _rodar(p, [Mensagem("usuario", _PEDIDO_SEM_FERRAMENTA)], None)
        ferramentas = False
    return {"ok": True, "ferramentas": ferramentas, "ms": int((time.monotonic() - inicio) * 1000),
            "uso": uso, "texto": texto[:200]}
