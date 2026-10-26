"""I18N-04: o app pergunta se o sistema tem fonte pro idioma (fontconfig no Linux)."""
import subprocess

from app.routers import sistema


def test_idioma_latino_sempre_tem(client):
    assert client.get("/api/sistema/fonte/de").json() == {"tem": True}


def test_linux_pergunta_ao_fontconfig(client, monkeypatch):
    monkeypatch.setattr(sistema.platform, "system", lambda: "Linux")
    monkeypatch.setattr(sistema.shutil, "which", lambda _: "/usr/bin/fc-list")
    chamadas = []

    def falso(cmd, **_):
        chamadas.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="" if ":lang=ko" in cmd else "Noto Sans CJK SC\n")

    monkeypatch.setattr(sistema.subprocess, "run", falso)
    assert client.get("/api/sistema/fonte/zh").json() == {"tem": True}
    assert client.get("/api/sistema/fonte/ko").json() == {"tem": False}
    assert chamadas[0] == ["/usr/bin/fc-list", ":lang=zh-cn", "family"]


def test_sem_fc_list_nao_sabe(client, monkeypatch):
    monkeypatch.setattr(sistema.platform, "system", lambda: "Linux")
    monkeypatch.setattr(sistema.shutil, "which", lambda _: None)
    assert client.get("/api/sistema/fonte/ja").json() == {"tem": None}


def test_windows_sempre_tem(client, monkeypatch):
    monkeypatch.setattr(sistema.platform, "system", lambda: "Windows")
    assert client.get("/api/sistema/fonte/hi").json() == {"tem": True}
