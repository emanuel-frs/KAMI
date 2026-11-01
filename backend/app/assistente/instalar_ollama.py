"""
Instalar, ligar e desinstalar o Ollama pelo app (IA-07b).

Sempre o instalador OFICIAL, da última release do GitHub do Ollama
(P-165), conferido antes de rodar — e nada roda sem o clique (P-164):

- **Linux** (P-163): o `install.sh` oficial, conferido contra o
  `sha256sum.txt` da mesma release, roda com a senha do sistema (pkexec,
  que mostra a janela de senha do próprio sistema). `OLLAMA_VERSION` fica
  fixo na versão conferida, então o pacote que o script baixa é o dessa
  release. Limite honesto (dito na tela e no SECURITY.md): o script baixa
  o pacote grande do site oficial por HTTPS, sem conferir o SHA-256 dele —
  o Kami confere o script, não o pacote. Sem pkexec (sistema sem janela de
  senha), a tela mostra o comando pra rodar no terminal.
- **Windows** (P-164): `OllamaSetup.exe` (~1,6 GB) conferido pelo
  SHA-256 E pela assinatura digital (tem que ser válida e da Ollama). O
  instalador é por usuário (não pede administrador); roda sem perguntas
  (o clique no Kami já foi o consentimento) e depois é apagado.

O Ollama já instalado e só fechado: "ligar" (serviço do sistema no Linux,
com a senha; senão `ollama serve` no fundo).

Desinstalar (P-166) só o que o KAMI instalou (marcador
`ollama-pelo-kami.json` na pasta de dados): um Ollama que a pessoa
instalou por conta própria nunca é removido daqui — a tela explica como.
Os modelos baixados só saem se a pessoa marcar (desmarcado por padrão).
"""
import hashlib
import json
import logging
import os
import platform
import shutil
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

from app.assistente import local
from app.database import local_now
from app.mensagens import Texto
from app.paths import get_data_dir

logger = logging.getLogger(__name__)

RELEASE_API = "https://api.github.com/repos/ollama/ollama/releases/latest"
# os links oficiais que a tela mostra (tutorial e desinstalar à mão)
LINKS = {
    "site": "https://ollama.com/download",
    "comando_linux": "curl -fsSL https://ollama.com/install.sh | sh",
    "desinstalar": {"linux": "https://docs.ollama.com/linux#uninstall", "windows": "https://docs.ollama.com/windows"},
}
TIMEOUT = 30
ESPERA_API_S = 90
LINHAS_SAIDA = 8

# passos da desinstalação oficial no Linux (docs.ollama.com/linux#uninstall)
_DESINSTALAR_LINUX = """set -u
systemctl stop ollama 2>/dev/null || true
systemctl disable ollama 2>/dev/null || true
rm -f /etc/systemd/system/ollama.service
systemctl daemon-reload 2>/dev/null || true
for b in /usr/local/bin/ollama /usr/bin/ollama /bin/ollama; do rm -f "$b"; done
rm -rf /usr/local/lib/ollama /usr/lib/ollama
{modelos}
userdel ollama 2>/dev/null || true
groupdel ollama 2>/dev/null || true
"""


class NaoDa(ValueError):
    """Pedido que não pode ser feito agora (já rodando, não foi o Kami que instalou…)."""


def _marcador() -> Path:
    return get_data_dir() / "ollama-pelo-kami.json"


def pelo_kami() -> dict | None:
    try:
        return json.loads(_marcador().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def sistema() -> str | None:
    return {"Linux": "linux", "Windows": "windows"}.get(platform.system())


def suporte() -> dict:
    """Como instalar aqui: pkexec (Linux), setup (Windows) ou só o tutorial."""
    so = sistema()
    if so == "windows":
        return {"sistema": so, "como": "setup", "motivo": None}
    if so == "linux":
        if shutil.which("pkexec") and shutil.which("sh"):
            return {"sistema": so, "como": "pkexec", "motivo": None}
        return {"sistema": so, "como": None, "motivo": "sem_pkexec"}
    return {"sistema": so, "como": None, "motivo": "sistema"}


# ── tarefa em andamento (uma de cada vez) ─────────────────────────────

_lock = threading.Lock()
_tarefa: dict | None = None


def tarefa() -> dict | None:
    with _lock:
        return None if _tarefa is None else {**_tarefa, "saida": list(_tarefa["saida"])}


def _marcar(**campos) -> None:
    with _lock:
        _tarefa.update(campos)


def _linha(texto: str) -> None:
    with _lock:
        _tarefa["saida"].append(texto.rstrip()[:200])
        del _tarefa["saida"][:-LINHAS_SAIDA]


def _comecar(acao: str, alvo) -> dict:
    global _tarefa
    with _lock:
        if _tarefa and not _tarefa["fim"]:
            raise NaoDa(Texto("erro.local.ocupado", "o Kami já está mexendo no Ollama — espere terminar"))
        _tarefa = {"acao": acao, "etapa": "iniciando", "feito": 0, "total": 0, "erro": None, "fim": False,
                   "versao": None, "saida": []}
    def rodar():
        try:
            alvo()
            _marcar(etapa="pronto", fim=True)
        except NaoDa as e:
            _marcar(etapa="erro", erro=str(e), erro_chave=getattr(e.args[0], "chave", None), fim=True)
        except Exception as e:  # noqa: BLE001 — a tela mostra; o log guarda o resto
            logger.exception("ollama: %s falhou", acao)
            _marcar(etapa="erro", erro=str(e)[:200], erro_chave=None, fim=True)
    threading.Thread(target=rodar, daemon=True, name=f"ollama-{acao}").start()
    return tarefa()


# ── release oficial ──────────────────────────────────────────────────

def _abrir(url: str, timeout: float = TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": "Kami", "Accept": "application/vnd.github+json"})
    return urllib.request.urlopen(req, timeout=timeout)


def ultima_release() -> dict:
    with _abrir(RELEASE_API) as r:
        d = json.loads(r.read().decode("utf-8"))
    arquivos = {a["name"]: {"url": a["browser_download_url"], "tamanho": a.get("size", 0)} for a in d.get("assets", [])}
    if "sha256sum.txt" not in arquivos:
        raise NaoDa(Texto("erro.local.sem_checksum", "a release do Ollama não tem checksum pra conferir — instale pelo site oficial"))
    return {"versao": d["tag_name"].lstrip("v"), "arquivos": arquivos}


def sha_esperado(somas: str, nome: str) -> str | None:
    for linha in somas.splitlines():
        partes = linha.split()
        if len(partes) == 2 and partes[1].lstrip("*").removeprefix("./") == nome:
            return partes[0].lower()
    return None


def _baixar(url: str, destino: Path, contar: bool) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    with _abrir(url, timeout=120) as r, open(destino, "wb") as fh:
        if contar:
            _marcar(total=int(r.headers.get("Content-Length") or 0), feito=0)
        feito = 0
        while bloco := r.read(1 << 20):
            fh.write(bloco)
            feito += len(bloco)
            if contar:
                _marcar(feito=feito)
    return destino


def _sha256(arquivo: Path) -> str:
    h = hashlib.sha256()
    with open(arquivo, "rb") as fh:
        while bloco := fh.read(1 << 20):
            h.update(bloco)
    return h.hexdigest()


def baixar_conferido(rel: dict, nome: str, pasta: Path, contar: bool = False) -> Path:
    """Baixa o arquivo da release e confere o SHA-256 com o sha256sum.txt dela."""
    with _abrir(rel["arquivos"]["sha256sum.txt"]["url"]) as r:
        esperado = sha_esperado(r.read().decode("utf-8"), nome)
    if not esperado:
        raise NaoDa(Texto("erro.local.sem_checksum", "a release do Ollama não tem checksum pra conferir — instale pelo site oficial"))
    _marcar(etapa="baixando")
    arquivo = _baixar(rel["arquivos"][nome]["url"], pasta / nome, contar)
    _marcar(etapa="conferindo")
    if _sha256(arquivo) != esperado:
        arquivo.unlink(missing_ok=True)
        raise NaoDa(Texto("erro.local.checksum_errado", "o arquivo baixado não bate com o checksum oficial — nada foi instalado"))
    return arquivo


def assinatura_windows(arquivo: Path) -> bool:
    """Authenticode válido e emitido pra Ollama (PowerShell, sem dependência nova)."""
    script = ("$s = Get-AuthenticodeSignature -LiteralPath $env:KAMI_ARQ; "
              "Write-Output ('STATUS=' + $s.Status); "
              "Write-Output ('SUJEITO=' + $s.SignerCertificate.Subject); "
              "Write-Output ('MSG=' + $s.StatusMessage)")
    proc = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                          capture_output=True, text=True, errors="replace", timeout=120,
                          env={**os.environ, "KAMI_ARQ": str(arquivo)},
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    campos = {}
    for linha in proc.stdout.splitlines():
        chave, _, valor = linha.strip().lstrip("\ufeff").partition("=")
        if chave in ("STATUS", "SUJEITO", "MSG"):
            campos[chave] = valor.strip()
    ok = campos.get("STATUS") == "Valid" and "ollama" in campos.get("SUJEITO", "").lower()
    # diagnóstico (sem nada da pessoa): o que o Windows disse da assinatura
    (logger.info if ok else logger.warning)(
        "assinatura do instalador do Ollama: status=%s sujeito=%s msg=%s stderr=%s",
        campos.get("STATUS"), campos.get("SUJEITO"), campos.get("MSG"), proc.stderr.strip()[:300])
    if not ok:
        _linha(f"assinatura: {campos.get('STATUS') or '?'} — {campos.get('MSG') or proc.stderr.strip()[:150]}")
    return ok


# ── esperar a API ─────────────────────────────────────────────────────

def _esperar_api(segundos: float = ESPERA_API_S) -> bool:
    fim = time.time() + segundos
    while time.time() < fim:
        if local.ollama(local.OLLAMA_PADRAO)["rodando"]:
            return True
        time.sleep(1)
    return False


def _rodar(cmd: list[str], **kw) -> int:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), **kw)
    for linha in proc.stdout:
        if linha.strip():
            _linha(linha)
    return proc.wait()


def _senha_negada(codigo: int) -> bool:
    # pkexec: 126 = a pessoa fechou/cancelou a janela de senha; 127 = sem autorização
    return codigo in (126, 127)


def _tem_servico_systemd() -> bool:
    return Path("/etc/systemd/system/ollama.service").exists()


def _ligar_desligado() -> None:
    """Ollama instalado mas parado: o serviço (Linux, com a senha) ou `ollama serve` no fundo."""
    so = sistema()
    if so == "linux" and _tem_servico_systemd() and shutil.which("pkexec"):
        _marcar(etapa="esperando_senha")
        codigo = _rodar(["pkexec", "systemctl", "start", "ollama"])
        if _senha_negada(codigo):
            raise NaoDa(Texto("erro.local.senha_cancelada", "a senha não foi digitada — nada mudou"))
    else:
        exe = _exe_windows("ollama app.exe") if so == "windows" else None
        cmd = [str(exe)] if exe else [shutil.which("ollama") or str(_exe_windows("ollama.exe") or "ollama"), "serve"]
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                         start_new_session=(so != "windows"), creationflags=flags)
    _marcar(etapa="ligando")
    if not _esperar_api(30):
        raise NaoDa(Texto("erro.local.nao_ligou", "o Ollama não respondeu depois de ligar — abra o Ollama pelo menu do sistema"))


def _exe_windows(nome: str) -> Path | None:
    base = os.environ.get("LOCALAPPDATA")
    p = Path(base) / "Programs" / "Ollama" / nome if base else None
    return p if p and p.exists() else None


# ── instalar ──────────────────────────────────────────────────────────

def _instalar() -> None:
    sup = suporte()
    if not sup["como"]:
        raise NaoDa(Texto("erro.local.sem_instalador", "aqui o Kami não consegue instalar o Ollama — siga o tutorial"))
    _marcar(etapa="procurando")
    rel = ultima_release()
    _marcar(versao=rel["versao"])
    pasta = get_data_dir() / "ollama-instalador"
    try:
        if sup["como"] == "pkexec":
            script = baixar_conferido(rel, "install.sh", pasta)
            _marcar(etapa="esperando_senha")
            codigo = _rodar(["pkexec", "env", f"OLLAMA_VERSION={rel['versao']}", "sh", str(script)])
            if _senha_negada(codigo):
                raise NaoDa(Texto("erro.local.senha_cancelada", "a senha não foi digitada — nada mudou"))
            if codigo != 0:
                raise NaoDa(Texto("erro.local.instalador_falhou", "o instalador oficial terminou com erro — veja as últimas linhas"))
        else:
            setup = baixar_conferido(rel, "OllamaSetup.exe", pasta, contar=True)
            _marcar(etapa="conferindo")
            if not assinatura_windows(setup):
                setup.unlink(missing_ok=True)
                raise NaoDa(Texto("erro.local.assinatura", "a assinatura digital do instalador não é da Ollama — nada foi instalado"))
            _marcar(etapa="instalando")
            codigo = _rodar([str(setup), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
            if codigo != 0:
                raise NaoDa(Texto("erro.local.instalador_falhou", "o instalador oficial terminou com erro — veja as últimas linhas"))
    finally:
        shutil.rmtree(pasta, ignore_errors=True)  # o instalador do Windows tem 1,6 GB
    _marcador().write_text(json.dumps({"versao": rel["versao"], "sistema": sup["sistema"],
                                       "em": local_now().isoformat()}), encoding="utf-8")
    logger.warning("Ollama %s instalado pelo Kami (%s)", rel["versao"], sup["sistema"])
    _marcar(etapa="ligando")
    if not _esperar_api():
        _ligar_desligado()


def instalar() -> dict:
    if local.ollama(local.OLLAMA_PADRAO)["instalado"]:
        raise NaoDa(Texto("erro.local.ja_instalado", "o Ollama já está instalado neste computador"))
    return _comecar("instalar", _instalar)


def ligar() -> dict:
    estado = local.ollama(local.OLLAMA_PADRAO)
    if estado["rodando"]:
        raise NaoDa(Texto("erro.local.ja_rodando", "o Ollama já está aberto"))
    if not estado["instalado"]:
        raise NaoDa(Texto("erro.local.nao_instalado", "o Ollama não está instalado"))
    return _comecar("ligar", _ligar_desligado)


# ── desinstalar ───────────────────────────────────────────────────────

def _desinstalar(apagar_modelos: bool) -> None:
    so = sistema()
    if so == "linux":
        modelos = "rm -rf /usr/share/ollama" if apagar_modelos else ""
        _marcar(etapa="esperando_senha")
        codigo = _rodar(["pkexec", "sh", "-c", _DESINSTALAR_LINUX.format(modelos=modelos)])
        if _senha_negada(codigo):
            raise NaoDa(Texto("erro.local.senha_cancelada", "a senha não foi digitada — nada mudou"))
    elif so == "windows":
        unins = _exe_windows("unins000.exe")
        if unins:
            _marcar(etapa="desinstalando")
            # o app da bandeja e o servidor seguram os arquivos
            for proc in ("ollama app.exe", "ollama.exe"):
                subprocess.run(["taskkill", "/F", "/IM", proc], capture_output=True,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            _rodar([str(unins), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
            # o desinstalador do Inno se copia pra %TEMP% e segue rodando: espera sumir
            fim = time.time() + 120
            while _exe_windows("ollama.exe") and time.time() < fim:
                time.sleep(1)
        if apagar_modelos:
            shutil.rmtree(Path.home() / ".ollama" / "models", ignore_errors=True)
    _marcador().unlink(missing_ok=True)
    logger.warning("Ollama desinstalado pelo Kami (modelos %s)", "apagados" if apagar_modelos else "mantidos")


def desinstalar(apagar_modelos: bool) -> dict:
    if not pelo_kami():
        raise NaoDa(Texto("erro.local.nao_foi_o_kami", "esse Ollama não foi instalado pelo Kami — desinstale pelo sistema"))
    return _comecar("desinstalar", lambda: _desinstalar(apagar_modelos))


def estado() -> dict:
    sup = suporte()
    links = {"site": LINKS["site"], "comando": LINKS["comando_linux"] if sup["sistema"] == "linux" else None,
             "desinstalar": LINKS["desinstalar"].get(sup["sistema"] or "", LINKS["site"])}
    return {**sup, "pelo_kami": pelo_kami(), "tarefa": tarefa(), "links": links}


def _resetar_para_testes() -> None:
    global _tarefa
    _tarefa = None
