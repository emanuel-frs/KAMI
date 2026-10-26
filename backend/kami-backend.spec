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

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

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
        # I18N-06: os calendários de feriados dos outros países (dados
        # dos calendários lunares/hebraico usados por alguns deles)
        *collect_data_files('workalendar'),
        *collect_data_files('convertdate'),
        *collect_data_files('lunardate'),
        *collect_data_files('pyluach'),
    ],
    hiddenimports=[
        # uvicorn resolve esses módulos dinamicamente (auto-detecção
        # de event loop / protocolo) — a análise estática do
        # PyInstaller não enxerga esses imports sozinha.
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan.on',
        # I18N-06: o país dos feriados é escolhido pela pessoa e o
        # registro da workalendar importa o módulo de cada região na hora
        # (workalendar.registry) — a análise estática não enxerga.
        *collect_submodules('workalendar'),
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
    # O backend é um sidecar de GUI; manter console=True abre uma janela
    # de terminal no Windows sempre que o Kami é iniciado.
    console=False,
)
