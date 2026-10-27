"""
Provedor de IA falso pros testes do assistente (IA-01): um servidor HTTP
de verdade em 127.0.0.1, numa porta livre, que responde o que o teste
mandar — JSON, SSE em pedaços, erro, redirecionamento, demora — e guarda
cada requisição recebida (caminho, cabeçalhos em minúsculas, corpo) pra conferir o que
o Kami enviou.

Servidor de verdade (e não mock do urllib) de propósito: o que mais
quebra num adaptador é justamente o transporte — SSE partido no meio,
cabeçalho, redirecionamento, tempo limite.

    falso.responder("/v1/models", json={"data": [{"id": "m1"}]})
    falso.responder("/v1/chat/completions", sse=[{"choices": [...]}, "[DONE]"])
    falso.url  # "http://127.0.0.1:<porta>/v1"
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # sem barulho na saída do pytest
        pass

    def _tratar(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        corpo = self.rfile.read(tamanho) if tamanho else b""
        try:
            corpo_json = json.loads(corpo) if corpo else None
        except ValueError:
            corpo_json = None
        caminho = self.path.split("?")[0]
        srv = self.server
        srv.recebidas.append({"metodo": self.command, "caminho": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "json": corpo_json})
        fila = srv.respostas.get(caminho)
        if not fila:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": {"message": "rota sem resposta no falso"}}')
            return
        r = fila[0] if len(fila) == 1 else fila.pop(0)  # a última resposta se repete
        if r.get("atraso"):
            time.sleep(r["atraso"])
        self.send_response(r.get("status", 200))
        for k, v in (r.get("headers") or {}).items():
            self.send_header(k, v)
        if r.get("sse") is not None:
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for item in r["sse"]:
                if isinstance(item, tuple):  # (evento, dados) — formato da Anthropic
                    nome, dado = item
                    bloco = f"event: {nome}\ndata: {json.dumps(dado)}\n\n"
                elif isinstance(item, str) and item.startswith(":"):
                    bloco = item + "\n\n"  # comentário SSE
                elif isinstance(item, str):
                    bloco = f"data: {item}\n\n"
                else:
                    bloco = f"data: {json.dumps(item)}\n\n"
                self.wfile.write(bloco.encode("utf-8"))
                self.wfile.flush()
                if r.get("atraso_pedaco"):
                    time.sleep(r["atraso_pedaco"])
            return
        bruto = r.get("bruto")
        if bruto is None:
            bruto = json.dumps(r.get("json", {})).encode("utf-8")
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(bruto)))
        self.end_headers()
        self.wfile.write(bruto)

    def _tratar_sem_cano_quebrado(self):
        try:
            self._tratar()
        except (BrokenPipeError, ConnectionResetError):
            pass  # o Kami fechou no meio (botão parar, tempo limite) — esperado

    do_GET = _tratar_sem_cano_quebrado
    do_POST = _tratar_sem_cano_quebrado


class ProvedorFalso:
    def __init__(self):
        self._srv = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self._srv.daemon_threads = True
        self._srv.respostas = {}
        self._srv.recebidas = []
        self._thread = threading.Thread(target=self._srv.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self._thread.start()

    @property
    def raiz(self) -> str:
        return f"http://127.0.0.1:{self._srv.server_address[1]}"

    @property
    def url(self) -> str:
        return self.raiz + "/v1"

    @property
    def recebidas(self) -> list:
        return self._srv.recebidas

    def responder(self, caminho: str, **resposta):
        """Enfileira uma resposta pra `caminho`; a última se repete."""
        self._srv.respostas.setdefault(caminho, []).append(resposta)

    def limpar(self):
        self._srv.respostas.clear()
        self._srv.recebidas.clear()

    def fechar(self):
        self._srv.shutdown()
        self._srv.server_close()


# ── pedaços prontos nos formatos reais ───────────────────────────────────

def openai_texto(*pedacos, uso=(10, 5), fim="stop"):
    sse = [{"choices": [{"index": 0, "delta": {"content": p}, "finish_reason": None}]} for p in pedacos]
    sse.append({"choices": [{"index": 0, "delta": {}, "finish_reason": fim}]})
    if uso:
        sse.append({"choices": [], "usage": {"prompt_tokens": uso[0], "completion_tokens": uso[1]}})
    sse.append("[DONE]")
    return sse


def anthropic_texto(*pedacos, uso=(12, 7)):
    sse = [("message_start", {"type": "message_start", "message": {"usage": {"input_tokens": uso[0], "output_tokens": 1}}}),
           ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
           ("ping", {"type": "ping"})]
    sse += [("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": p}})
            for p in pedacos]
    sse += [("content_block_stop", {"type": "content_block_stop", "index": 0}),
            ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": uso[1]}}),
            ("message_stop", {"type": "message_stop"})]
    return sse
