"""
IA-07b: instalar o Ollama pelo app — instalador oficial da última release
conferido pelo SHA-256 (e pela assinatura no Windows) antes de rodar,
senha do sistema no Linux (pkexec), versão fixa, só desinstala o que o
Kami instalou, modelos só com a caixa marcada (P-163..P-166).

Nada é instalado de verdade: a release é servida localmente e quem roda
o instalador é substituído.
"""
import hashlib
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.assistente import instalar_ollama as inst
from app.assistente import local

SCRIPT = b"#!/bin/sh\necho instalando\n"
SETUP = b"MZ instalador falso"


class _Release(BaseHTTPRequestHandler):
    somas_erradas = False

    def log_message(self, *a):
        pass

    def do_GET(self):
        base = f"http://127.0.0.1:{self.server.server_address[1]}"
        if self.path == "/latest":
            corpo = json.dumps({"tag_name": "v0.40.13", "assets": [
                {"name": n, "browser_download_url": f"{base}/{n}", "size": 10}
                for n in ("install.sh", "OllamaSetup.exe", "sha256sum.txt")]}).encode()
        elif self.path == "/sha256sum.txt":
            sha_script = "0" * 64 if self.somas_erradas else hashlib.sha256(SCRIPT).hexdigest()
            corpo = (f"{sha_script}  ./install.sh\n{hashlib.sha256(SETUP).hexdigest()}  ./OllamaSetup.exe\n").encode()
        elif self.path == "/install.sh":
            corpo = SCRIPT
        elif self.path == "/OllamaSetup.exe":
            corpo = SETUP
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


@pytest.fixture()
def release(monkeypatch, tmp_path):
    _Release.somas_erradas = False
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Release)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(inst, "RELEASE_API", f"http://127.0.0.1:{srv.server_address[1]}/latest")
    monkeypatch.setattr(inst, "get_data_dir", lambda: tmp_path)
    monkeypatch.setattr(local, "ollama", lambda base=None: {"instalado": False, "rodando": False, "modelos": []})
    monkeypatch.setattr(inst, "_esperar_api", lambda segundos=0: True)
    rodou = []

    def falso_rodar(cmd, **kw):
        rodou.append(cmd)
        return rodou_codigo[0]

    rodou_codigo = [0]
    monkeypatch.setattr(inst, "_rodar", falso_rodar)
    inst._resetar_para_testes()
    yield {"rodou": rodou, "codigo": rodou_codigo, "pasta": tmp_path}
    srv.shutdown()
    inst._resetar_para_testes()


def _fim(client, segundos=5):
    limite = time.time() + segundos
    while time.time() < limite:
        t = client.get("/api/assistente/local/instalacao").json()["tarefa"]
        if t and t["fim"]:
            return t
        time.sleep(0.05)
    raise AssertionError("a tarefa não terminou")


@pytest.fixture()
def linux(monkeypatch):
    monkeypatch.setattr(inst, "suporte", lambda: {"sistema": "linux", "como": "pkexec", "motivo": None})
    monkeypatch.setattr(inst, "sistema", lambda: "linux")


@pytest.fixture()
def windows(monkeypatch):
    monkeypatch.setattr(inst, "suporte", lambda: {"sistema": "windows", "como": "setup", "motivo": None})
    monkeypatch.setattr(inst, "sistema", lambda: "windows")


def test_linux_roda_o_script_conferido_com_a_senha_e_a_versao_fixa(client, release, linux):
    assert client.post("/api/assistente/local/instalar").status_code == 202
    t = _fim(client)
    assert t["etapa"] == "pronto" and t["versao"] == "0.40.13", t
    cmd = release["rodou"][0]
    assert cmd[:3] == ["pkexec", "env", "OLLAMA_VERSION=0.40.13"] and cmd[3] == "sh" and cmd[4].endswith("install.sh")
    assert inst.pelo_kami()["versao"] == "0.40.13"
    assert not (release["pasta"] / "ollama-instalador").exists(), "o instalador baixado é apagado"


def test_checksum_errado_nao_roda_nada(client, release, linux):
    _Release.somas_erradas = True
    client.post("/api/assistente/local/instalar")
    t = _fim(client)
    assert t["etapa"] == "erro" and t["erro_chave"] == "erro.local.checksum_errado"
    assert release["rodou"] == [] and inst.pelo_kami() is None


def test_senha_cancelada_nao_marca_como_instalado(client, release, linux):
    release["codigo"][0] = 126
    client.post("/api/assistente/local/instalar")
    t = _fim(client)
    assert t["erro_chave"] == "erro.local.senha_cancelada"
    assert inst.pelo_kami() is None


def test_windows_confere_a_assinatura_antes_de_rodar(client, release, windows, monkeypatch):
    monkeypatch.setattr(inst, "assinatura_windows", lambda arq: False)
    client.post("/api/assistente/local/instalar")
    t = _fim(client)
    assert t["erro_chave"] == "erro.local.assinatura" and release["rodou"] == []

    monkeypatch.setattr(inst, "assinatura_windows", lambda arq: True)
    client.post("/api/assistente/local/instalar")
    t = _fim(client)
    assert t["etapa"] == "pronto", t
    assert release["rodou"][0][0].endswith("OllamaSetup.exe") and "/SILENT" in release["rodou"][0]
    assert inst.pelo_kami()["sistema"] == "windows"


def test_ja_instalado_nao_instala_de_novo(client, release, linux, monkeypatch):
    monkeypatch.setattr(local, "ollama", lambda base=None: {"instalado": True, "rodando": True, "modelos": []})
    r = client.post("/api/assistente/local/instalar")
    assert r.status_code == 409 and r.json()["chave"] == "erro.local.ja_instalado"


def test_so_desinstala_o_que_o_kami_instalou(client, release, linux):
    r = client.post("/api/assistente/local/desinstalar", json={})
    assert r.status_code == 409 and r.json()["chave"] == "erro.local.nao_foi_o_kami"

    client.post("/api/assistente/local/instalar")
    _fim(client)
    release["rodou"].clear()
    client.post("/api/assistente/local/desinstalar", json={"apagar_modelos": False})
    assert _fim(client)["etapa"] == "pronto"
    script = release["rodou"][0][-1]
    assert release["rodou"][0][:3] == ["pkexec", "sh", "-c"]
    assert "systemctl stop ollama" in script and "/usr/share/ollama" not in script, "modelos ficam por padrão"
    assert inst.pelo_kami() is None


def test_desinstalar_com_a_caixa_marcada_apaga_os_modelos(client, release, linux):
    client.post("/api/assistente/local/instalar")
    _fim(client)
    release["rodou"].clear()
    client.post("/api/assistente/local/desinstalar", json={"apagar_modelos": True})
    _fim(client)
    assert "rm -rf /usr/share/ollama" in release["rodou"][0][-1]


def test_uma_tarefa_de_cada_vez(client, release, linux, monkeypatch):
    liberar = threading.Event()
    monkeypatch.setattr(inst, "_esperar_api", lambda segundos=0: liberar.wait(5))
    client.post("/api/assistente/local/instalar")
    monkeypatch.setattr(local, "ollama", lambda base=None: {"instalado": True, "rodando": False, "modelos": []})
    r = client.post("/api/assistente/local/ligar")
    assert r.status_code == 409 and r.json()["chave"] == "erro.local.ocupado"
    liberar.set()
    _fim(client)


def test_ligar_o_ollama_parado(client, release, linux, monkeypatch, tmp_path):
    monkeypatch.setattr(local, "ollama", lambda base=None: {"instalado": True, "rodando": False, "modelos": []})
    abertos = []
    monkeypatch.setattr(inst.subprocess, "Popen", lambda cmd, **kw: abertos.append(cmd))
    monkeypatch.setattr(inst, "_tem_servico_systemd", lambda: False)
    assert client.post("/api/assistente/local/ligar").status_code == 202
    assert _fim(client)["etapa"] == "pronto"
    assert abertos and abertos[0][-1] == "serve"


def test_le_o_checksum_nos_formatos_do_sha256sum():
    somas = "aaa  ./install.sh\nbbb *OllamaSetup.exe\nccc  outro.zip\n"
    assert inst.sha_esperado(somas, "install.sh") == "aaa"
    assert inst.sha_esperado(somas, "OllamaSetup.exe") == "bbb"
    assert inst.sha_esperado(somas, "nada") is None
