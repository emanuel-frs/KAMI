# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec pro sidecar do backend (decisão 19).
#
# Gera um binário standalone (quem baixa o app do GitHub não precisa
# ter Python instalado). Roda por SO — sem cross-compile, decisão 19:
# rode este spec no Linux pra gerar o binário Linux, e no Windows pra
# gerar o .exe.
#
# Uso (de dentro de backend/, com o .venv de sempre + `pip install
# pyinstaller`):
#
#   pyinstaller kami-backend.spec --clean --noconfirm
#
# Saída em dist/kami-backend (ou dist/kami-backend.exe no Windows).
# O nome final que o Tauri espera (com sufixo de target triple) é
# aplicado depois por scripts/build_sidecar.sh, não aqui.
#
# NÃO TESTADO DE VERDADE ainda (escrito sem PyInstaller/Rust
# disponíveis no ambiente onde este arquivo foi gerado) — rode e
# ajuste hiddenimports/datas se faltar alguma coisa em tempo de
# execução (erro típico: "ModuleNotFoundError" só ao RODAR o binário,
# não ao compilar).

block_cipher = None

a = Analysis(
    ['run_server.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('app/schema.sql', 'app'),
        # arquivo de versão (fonte de verdade única, raiz do repo, um
        # nível acima de backend/) — ver app/version.py
        ('../VERSION', '.'),
    ],
    hiddenimports=[
        # uvicorn resolve esses módulos dinamicamente (auto-detecção
        # de event loop / protocolo) — a análise estática do
        # PyInstaller não enxerga esses imports sozinha.
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan.on',
        # workalendar.america é importado explicitamente em
        # business_days.py, mas o pacote workalendar registra
        # calendários por região via introspecção interna — incluído
        # aqui por precaução.
        'workalendar.america',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='kami-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,   # dá pra trocar pra False depois de validar que
                     # nenhum log de depuração do backend é mais
                     # necessário no console
)
