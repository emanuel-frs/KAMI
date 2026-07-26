# Ícones do app

Pasta vazia de propósito — não dá pra gerar `.ico`/`.icns` de verdade
sem uma arte-fonte e sem o Tauri CLI (que faz a conversão localmente,
mas não está disponível neste ambiente).

Quando tiver um logo em PNG (recomendado: quadrado, ≥1024×1024, fundo
transparente ou sólido — dá pra usar o próprio avatar ASCII da Kami
renderizado como imagem, ou uma versão simplificada dele), rode na sua
máquina:

```bash
cd src-tauri
cargo tauri icon caminho/para/logo.png
```

Isso gera todos os tamanhos/formatos que `tauri.conf.json` espera
(`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico`) direto nesta pasta.
