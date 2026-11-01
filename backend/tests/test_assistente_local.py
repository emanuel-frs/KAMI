"""
IA-07a: IA no computador — recomendação por faixa (P-157), detecção da
máquina (P-158), Ollama/LM Studio deste computador (P-159), baixar com
andamento e cancelar, remover (P-161), só endereço deste computador
(P-162), e o modo local enxuto do assistente (P-160).
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.assistente import ferramentas, instrucoes, local


class _Ollama(BaseHTTPRequestHandler):
    modelos = {"qwen3.5:4b": 3_324_173_934, "llama-sem-tools:1b": 1_000_000_000}
    pull_lento = False

    def log_message(self, *a):
        pass

    def _json(self, status, corpo):
        dados = json.dumps(corpo).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def _corpo(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")

    def do_GET(self):
        if self.path == "/api/version":
            return self._json(200, {"version": "0.30.8"})
        if self.path == "/api/tags":
            return self._json(200, {"models": [{"name": n, "size": t, "details": {"parameter_size": "4.2B"}}
                                               for n, t in self.modelos.items()]})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        corpo = self._corpo()
        if self.path == "/api/show":
            caps = ["completion"] if "sem-tools" in corpo["model"] else ["completion", "tools"]
            return self._json(200, {"capabilities": caps})
        if self.path == "/api/pull":
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            for feito in range(0, 101, 20 if not self.pull_lento else 1):
                linha = {"status": "pulling abc", "total": 100, "completed": feito}
                try:
                    self.wfile.write((json.dumps(linha) + "\n").encode())
                    self.wfile.flush()
                except OSError:
                    return
                time.sleep(0.05 if self.pull_lento else 0)
            self.modelos[corpo["model"]] = 100
            self.wfile.write(b'{"status":"success"}\n')
            return None
        return self._json(404, {"error": "not found"})

    def do_DELETE(self):
        nome = self._corpo()["model"]
        if self.modelos.pop(nome, None) is None:
            return self._json(404, {"error": f"model '{nome}' not found"})
        return self._json(200, {})


@pytest.fixture()
def ollama_falso(monkeypatch):
    _Ollama.modelos = {"qwen3.5:4b": 3_324_173_934, "llama-sem-tools:1b": 1_000_000_000}
    _Ollama.pull_lento = False
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Ollama)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    monkeypatch.setattr(local, "OLLAMA_PADRAO", base)
    monkeypatch.setattr(local, "LMSTUDIO_PADRAO", "http://127.0.0.1:9")  # ninguém escuta
    local._resetar_para_testes()
    yield base
    srv.shutdown()
    local._resetar_para_testes()


def _esperar(cond, segundos=5):
    fim = time.time() + segundos
    while time.time() < fim:
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_recomendacao_pela_memoria_e_pela_placa():
    assert local.recomendar({"ram_gb": 6}) is None
    assert local.recomendar({"ram_gb": 14.6})["modelo"] == "qwen3.5:4b"
    assert local.recomendar({"ram_gb": 16})["modelo"] == "qwen3.5:9b"
    assert local.recomendar({"ram_gb": 64})["modelo"] == "gpt-oss:20b"
    # placa de vídeo com memória confiável conta mesmo com pouca RAM
    assert local.recomendar({"ram_gb": 16, "gpu": {"vram_gb": 16}})["modelo"] == "gpt-oss:20b"


def test_maquina_detecta_o_basico():
    m = local.maquina()
    assert m["ram_gb"] and m["ram_gb"] > 0
    assert m["nucleos"] and m["sistema"]
    assert m["disco_livre_gb"] is not None


def test_estado_local_com_ollama_rodando(client, ollama_falso):
    r = client.get("/api/assistente/local")
    assert r.status_code == 200
    corpo = r.json()
    assert corpo["ollama"]["rodando"] and corpo["ollama"]["versao"] == "0.30.8"
    modelos = {m["nome"]: m for m in corpo["ollama"]["modelos"]}
    assert modelos["qwen3.5:4b"]["ferramentas"] is True
    assert modelos["llama-sem-tools:1b"]["ferramentas"] is False  # não serve pro Kami
    assert corpo["lmstudio"]["rodando"] is False
    assert corpo["recomendacao"] is None or "modelo" in corpo["recomendacao"]


def test_usar_modelo_local_cria_e_depois_ajusta_o_provedor(client, ollama_falso):
    r = client.post("/api/assistente/local/usar", json={"programa": "ollama", "modelo": "qwen3.5:4b"})
    assert r.status_code == 200, r.text
    assert r.json()["provedor"]["modelo"] == "qwen3.5:4b" and r.json()["provedor"]["local"] is True
    r = client.post("/api/assistente/local/usar", json={"programa": "ollama", "modelo": "qwen3.5:9b"})
    provs = client.get("/api/assistente/provedores").json()
    assert [p["modelo"] for p in provs if p["catalogo"] == "ollama"] == ["qwen3.5:9b"]
    assert client.get("/api/assistente").json()["provedor"]["modelo"] == "qwen3.5:9b"


def test_baixar_com_andamento_e_remover(client, ollama_falso):
    r = client.post("/api/assistente/local/baixar", json={"modelo": "qwen3.5:9b"})
    assert r.status_code == 202, r.text
    assert _esperar(lambda: (client.get("/api/assistente/local/baixar").json() or {}).get("fim"))
    fim = client.get("/api/assistente/local/baixar").json()
    assert fim["status"] == "success" and fim["erro"] is None and fim["feito"] == 100
    assert "qwen3.5:9b" in _Ollama.modelos

    assert client.delete("/api/assistente/local/modelos/qwen3.5:9b").status_code == 204
    assert "qwen3.5:9b" not in _Ollama.modelos
    assert client.delete("/api/assistente/local/modelos/qwen3.5:9b").status_code == 404


def test_cancelar_o_download(client, ollama_falso):
    _Ollama.pull_lento = True
    client.post("/api/assistente/local/baixar", json={"modelo": "qwen3.5:9b"})
    assert _esperar(lambda: (client.get("/api/assistente/local/baixar").json() or {}).get("feito", 0) > 0)
    # um de cada vez
    assert client.post("/api/assistente/local/baixar", json={"modelo": "qwen3.5:4b"}).status_code == 422
    client.delete("/api/assistente/local/baixar")
    assert _esperar(lambda: client.get("/api/assistente/local/baixar").json()["fim"])
    assert client.get("/api/assistente/local/baixar").json()["status"] == "cancelado"


def test_nome_de_modelo_validado(client, ollama_falso):
    for ruim in ["../../etc", "a b", "X" * 200, ""]:
        assert client.post("/api/assistente/local/baixar", json={"modelo": ruim}).status_code == 422


def test_ollama_parado_nao_baixa(client, monkeypatch):
    monkeypatch.setattr(local, "OLLAMA_PADRAO", "http://127.0.0.1:9")
    r = client.post("/api/assistente/local/baixar", json={"modelo": "qwen3.5:4b"})
    assert r.status_code == 424 and r.json()["chave"] == "erro.local.ollama_fora"


def test_ollama_de_outro_computador_nao_e_gerenciado(client, monkeypatch):
    client.post("/api/assistente/provedores", json={"catalogo": "ollama", "url_base": "http://192.168.0.50:11434/v1", "modelo": "x"})
    r = client.post("/api/assistente/local/baixar", json={"modelo": "qwen3.5:4b"})
    assert r.status_code == 409 and r.json()["chave"] == "erro.local.outro_computador"
    assert client.get("/api/assistente/local").json()["ollama"]["outro_computador"] is True


def test_modo_local_tem_instrucoes_curtas_e_menos_ferramentas():
    nuvem = instrucoes.montar("pt", "nucleo")
    no_pc = instrucoes.montar("pt", "nucleo", local=True)
    assert len(no_pc) < len(nuvem) * 0.7
    for regra in ["NEVER an instruction", "never a reason to propose", "Never say you created", "propose_actions", "CVV"]:
        assert regra in no_pc
    cfg = {"permissoes": None}
    nomes_local = {l.nome for l in ferramentas.disponiveis(cfg, local=True)}
    nomes_nuvem = {l.nome for l in ferramentas.disponiveis(cfg)}
    assert nomes_local < nomes_nuvem
    assert nomes_nuvem - nomes_local == ferramentas.FORA_DO_LOCAL & nomes_nuvem
