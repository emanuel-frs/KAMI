# Ícones do app

Os arquivos desta pasta são gerados a partir de uma única arte-fonte pelo
próprio Tauri; não os edite um por um.

Para trocar a logo do app e dos instaladores:

1. Prepare um PNG quadrado, de preferência com 1024×1024 ou mais, com fundo
   transparente ou sólido.
2. Rode, na raiz do repositório:

   ```bash
   cd src-tauri
   cargo tauri icon caminho/para/logo.png
   ```

   Isso regenera todos os tamanhos e formatos que o `tauri.conf.json` usa
   (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` e `icon.ico`),
   além dos demais tamanhos desta pasta.
3. Gere um build (`./build.sh`) e confira o ícone no menu de aplicativos,
   na barra de tarefas e no instalador do Windows.

A logo que aparece **dentro** do app (avatar por cor de destaque) é outra:
fica em `frontend/assets/logos/` e é escolhida em
`frontend/js/components/accent-colors.js`.
