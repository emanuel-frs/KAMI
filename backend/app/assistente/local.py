"""
IA no computador (IA-07a): o que a máquina tem, qual modelo cabe nela, e o
Ollama / LM Studio que já estiverem aqui — conectar, baixar e remover
modelo (só no Ollama, P-159).

Detecção da máquina (P-158): memória, disco livre (onde o Ollama guarda
os modelos), sistema e processador. Memória de vídeo só quando dá pra
confiar: NVIDIA pelo nvidia-smi e placa AMD dedicada pelo sysfs (Linux).
Placa integrada ou desconhecida = "integrada / não detectada", e a
recomendação vai só pela memória.

Recomendação (P-157): faixas em local.json — só dados.

Só fala com programa NESTE computador (127.0.0.1 / localhost): é a única
coisa que esta parte do Kami gerencia. Um endereço de outra máquina da
rede no provedor Ollama aparece como alerta (P-162), e nada é baixado ou
apagado lá.

Baixar modelo (P-161): POST /api/pull do Ollama em streaming, numa thread;
a tela consulta o andamento. Cancelar fecha a conexão — o Ollama guarda o
que já baixou e continua de onde parou na próxima vez.
"""
import ctypes
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from app.mensagens import Texto

logger = logging.getLogger(__name__)

DADOS = json.loads((Path(__file__).parent / "local.json").read_text(encoding="utf-8"))
OLLAMA_PADRAO = "http://127.0.0.1:11434"
LMSTUDIO_PADRAO = "http://127.0.0.1:1234"
HOSTS_DESTE_COMPUTADOR = {"127.0.0.1", "localhost", "::1"}
NOME_MODELO = re.compile(r"^[a-z0-9][a-z0-9._-]*(/[a-z0-9._-]+)?(:[a-z0-9._-]+)?$")
TIMEOUT_SONDA = 1.5
GB = 1024**3


class ModeloInvalido(ValueError):
    pass


class ProgramaFora(RuntimeError):
    """O Ollama não está rodando (ou não responde)."""


# ── máquina ────────────────────────────────────────────────────────────

def _ram_bytes() -> int | None:
    if platform.system() == "Windows":
        class Status(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        s = Status()
        s.dwLength = ctypes.sizeof(Status)
        return s.ullTotalPhys if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s)) else None
    try:
        for linha in Path("/proc/meminfo").read_text().splitlines():
            if linha.startswith("MemTotal:"):
                return int(linha.split()[1]) * 1024
    except OSError:
        pass
    return None


def _processador() -> str | None:
    if platform.system() == "Windows":
        try:
            import winreg

            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as k:
                return str(winreg.QueryValueEx(k, "ProcessorNameString")[0]).strip()
        except OSError:
            return platform.processor() or None
    try:
        for linha in Path("/proc/cpuinfo").read_text().splitlines():
            if linha.startswith("model name"):
                return linha.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or None


def _nvidia() -> dict | None:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        saida = subprocess.run([exe, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                               capture_output=True, text=True, timeout=5,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        nome, mib = saida.strip().splitlines()[0].rsplit(",", 1)
        return {"nome": nome.strip(), "vram_gb": round(int(mib) / 1024, 1), "dedicada": True}
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def _amd_dedicada() -> dict | None:
    """Linux: placa AMD com memória própria de verdade (a integrada reserva pouco)."""
    for card in sorted(Path("/sys/class/drm").glob("card[0-9]")):
        try:
            if (card / "device" / "vendor").read_text().strip() != "0x1002":
                continue
            vram = int((card / "device" / "mem_info_vram_total").read_text().strip())
        except (OSError, ValueError):
            continue
        if vram >= 4 * GB:
            return {"nome": "AMD", "vram_gb": round(vram / GB, 1), "dedicada": True}
    return None


def _disco_dos_modelos() -> Path:
    pasta = os.environ.get("OLLAMA_MODELS")
    if pasta:
        return Path(pasta)
    return Path.home() / ".ollama"


def maquina() -> dict:
    ram = _ram_bytes()
    alvo = _disco_dos_modelos()
    while not alvo.exists() and alvo != alvo.parent:
        alvo = alvo.parent
    try:
        livre = shutil.disk_usage(alvo).free
    except OSError:
        livre = None
    gpu = _nvidia() or (_amd_dedicada() if platform.system() == "Linux" else None)
    return {
        "ram_gb": round(ram / GB, 1) if ram else None,
        "disco_livre_gb": round(livre / GB, 1) if livre is not None else None,
        # "7.4.0-0.rc0.…fc46.x86_64" → "7.4.0": o resto não ajuda ninguém a decidir
        "sistema": f"{platform.system()} {platform.release().split('-')[0]}".strip(),
        "processador": _processador(),
        "nucleos": os.cpu_count(),
        "gpu": gpu,  # None = integrada / não detectada
    }


def recomendar(m: dict) -> dict | None:
    """A maior faixa que cabe pela memória (ou pela placa de vídeo, quando confiável)."""
    ram = m.get("ram_gb") or 0
    vram = (m.get("gpu") or {}).get("vram_gb") or 0
    cabe = [f for f in DADOS["faixas"]
            if ram >= f["ram_min_gb"] or (f.get("vram_min_gb") and vram >= f["vram_min_gb"])]
    return cabe[-1] if cabe else None


# ── programas ─────────────────────────────────────────────────────────

def deste_computador(url: str) -> bool:
    return (urlsplit(url).hostname or "").lower() in HOSTS_DESTE_COMPUTADOR


def raiz(url_v1: str) -> str:
    """http://localhost:11434/v1 → http://localhost:11434"""
    partes = urlsplit(url_v1.rstrip("/"))
    return f"{partes.scheme}://{partes.netloc}"


def _get(url: str, timeout: float = TIMEOUT_SONDA):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _ollama_instalado() -> bool:
    if shutil.which("ollama"):
        return True
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        return bool(local) and (Path(local) / "Programs" / "Ollama" / "ollama.exe").exists()
    return False


def _capacidades(base: str, nome: str) -> list[str]:
    try:
        req = urllib.request.Request(f"{base}/api/show", data=json.dumps({"model": nome}).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read().decode("utf-8")).get("capabilities") or []
    except (OSError, ValueError):
        return []


def ollama(base: str = OLLAMA_PADRAO) -> dict:
    estado = {"instalado": _ollama_instalado(), "rodando": False, "versao": None, "url": base, "modelos": []}
    if not deste_computador(base):
        return {**estado, "outro_computador": True}
    try:
        estado["versao"] = _get(f"{base}/api/version").get("version")
        estado["rodando"] = estado["instalado"] = True
        tags = _get(f"{base}/api/tags", timeout=5).get("models") or []
    except (OSError, ValueError):
        return estado
    estado["modelos"] = [
        {"nome": m["name"], "tamanho_gb": round(m.get("size", 0) / 1e9, 1),
         "parametros": (m.get("details") or {}).get("parameter_size"),
         "ferramentas": "tools" in _capacidades(base, m["name"])}
        for m in tags
    ]
    return estado


def lmstudio(base: str = LMSTUDIO_PADRAO) -> dict:
    try:
        modelos = [m["id"] for m in _get(f"{base}/v1/models").get("data") or []]
        return {"rodando": True, "url": base, "modelos": modelos}
    except (OSError, ValueError, KeyError, TypeError):
        return {"rodando": False, "url": base, "modelos": []}


def validar_nome(nome: str) -> str:
    nome = (nome or "").strip().lower()
    if not NOME_MODELO.match(nome) or len(nome) > 120:
        raise ModeloInvalido(Texto("erro.local.nome_modelo", "nome de modelo inválido"))
    return nome


def remover(base: str, nome: str) -> bool:
    """Apaga o modelo do Ollama. False se ele não existia."""
    req = urllib.request.Request(f"{base}/api/delete", data=json.dumps({"model": validar_nome(nome)}).encode(),
                                 method="DELETE", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30):
            return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


# ── baixar (uma vez de cada vez) ──────────────────────────────────────

_lock = threading.Lock()
_baixando: dict | None = None  # {"modelo", "status", "total", "feito", "erro", "fim", "cancelar"}


def andamento() -> dict | None:
    with _lock:
        return None if _baixando is None else {k: v for k, v in _baixando.items() if k != "cancelar"}


def _marcar(estado: dict, **campos) -> None:
    with _lock:
        estado.update(campos)


def _rodar_pull(base: str, nome: str, estado: dict) -> None:
    req = urllib.request.Request(f"{base}/api/pull", data=json.dumps({"model": nome, "stream": True}).encode(),
                                 method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            for linha in r:
                if estado["cancelar"].is_set():
                    _marcar(estado, status="cancelado", fim=True)
                    return
                if not linha.strip():
                    continue
                d = json.loads(linha)
                if d.get("error"):
                    _marcar(estado, erro=d["error"], fim=True)
                    return
                campos = {"status": d.get("status", estado["status"])}
                if d.get("total"):
                    campos.update(total=d["total"], feito=d.get("completed", 0))
                _marcar(estado, **campos)
        _marcar(estado, status="success", fim=True)
    except (OSError, ValueError) as e:
        _marcar(estado, erro=str(e)[:200], fim=True)
        logger.warning("baixar o modelo %s pelo Ollama falhou: %s", nome, e)


def baixar(base: str, nome: str) -> dict:
    global _baixando
    nome = validar_nome(nome)
    with _lock:
        if _baixando and not _baixando["fim"]:
            raise ModeloInvalido(Texto("erro.local.ja_baixando", "já tem um modelo baixando — espere ou cancele"))
        _baixando = {"modelo": nome, "status": "iniciando", "total": 0, "feito": 0, "erro": None, "fim": False,
                     "cancelar": threading.Event()}
        estado = _baixando
    threading.Thread(target=_rodar_pull, args=(base, nome, estado), daemon=True, name="ollama-pull").start()
    return andamento()


def cancelar() -> dict | None:
    with _lock:
        if _baixando and not _baixando["fim"]:
            _baixando["cancelar"].set()
    return andamento()


def _resetar_para_testes() -> None:
    global _baixando
    _baixando = None
