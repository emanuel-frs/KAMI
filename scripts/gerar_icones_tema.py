#!/usr/bin/env python3
"""
Gera o ícone do app em cada cor de destaque (ICO-01).

Parte de src-tauri/icons/icon.png (o "K" verde fósforo no quadrado preto)
e recolore só o que é "K": cada pixel mantém a luminosidade relativa à
cor original (o preto continua preto, as linhas finas e o antisserrilhado
continuam proporcionais) e troca o tom pela cor de destaque.

Saída em src-tauri/icons/themes/<cor>/: 32x32.png, 128x128.png,
256x256.png e icon.ico — embutidos no app pelo Rust (main.rs,
aplicar_icone_tema). Os arquivos gerados são versionados: o build não
depende do Pillow. Rode de novo só se a arte ou as cores mudarem:

    python -m venv /tmp/pil && /tmp/pil/bin/pip install pillow
    /tmp/pil/bin/python scripts/gerar_icones_tema.py

As cores são as de frontend/js/components/accent-colors.js (ACCENT_OPTIONS).
"""
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parents[1]
FONTE = RAIZ / "src-tauri" / "icons" / "icon.png"
SAIDA = RAIZ / "src-tauri" / "icons" / "themes"

BASE = (0x8F, 0xBF, 0x8F)  # verde fósforo da arte original
CORES = {
    "verde": "#8fbf8f",
    "ambar": "#b3a06a",
    "azul": "#8fa8bf",
    "vermelho": "#b06060",
    "cinza": "#c9c9c9",
    "lilas": "#c9a0dc",
    "dourado": "#e0c15a",
    "turquesa": "#5ac8c8",
    "coral": "#e08fa0",
}


def _lum(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def recolorir(img: Image.Image, cor: str) -> Image.Image:
    alvo = tuple(int(cor[i : i + 2], 16) for i in (1, 3, 5))
    base = _lum(BASE)
    out = img.convert("RGBA").copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            t = min(1.0, _lum((r, g, b)) / base)
            px[x, y] = (round(alvo[0] * t), round(alvo[1] * t), round(alvo[2] * t), a)
    return out


def main():
    fonte = Image.open(FONTE).convert("RGBA")
    for nome, cor in CORES.items():
        pasta = SAIDA / nome
        pasta.mkdir(parents=True, exist_ok=True)
        icone = fonte if nome == "verde" else recolorir(fonte, cor)
        for lado in (32, 128, 256):
            icone.resize((lado, lado), Image.LANCZOS).save(pasta / f"{lado}x{lado}.png", optimize=True)
        icone.save(pasta / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        print(f"{nome}: ok")


if __name__ == "__main__":
    main()
