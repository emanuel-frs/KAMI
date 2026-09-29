# Instalação do Kami

O Kami é um aplicativo desktop local-first. O backend e o banco SQLite
rodam na sua máquina; nenhum serviço remoto é necessário para usar o app.
Os instaladores oficiais ficam na [página de Releases](https://github.com/emanuel-frs/KAMI/releases/latest)
e na [página de download](./index.html).

## Linux

A partir das releases geradas pelo workflow desta branch, os assets
para x86_64 terão estes nomes:

| Distribuição/formato | Asset |
|---|---|
| Debian, Ubuntu e derivados | `kami-<versão>-linux-amd64.deb` |
| Fedora, RHEL e derivados | `kami-<versão>-linux-x86_64.rpm` |
| Qualquer distribuição compatível | `kami-<versão>-linux-x86_64.AppImage` |
| Arch e derivados, com `makepkg` | `kami-<versão>-PKGBUILD` e o pacote `.deb` verificado pela receita |

Os nomes dos assets fazem parte do contrato de instalação. O arquivo
`SHA256SUMS` publicado junto deles lista cada instalador pelo nome exato;
confira o arquivo antes de instalar manualmente. `scripts/install.sh`
baixa a release oficial e verifica o SHA-256 antes de passar o pacote ao
gerenciador ou instalar o AppImage.

Releases antigas podem usar nomes gerados pelo Tauri e não incluir
`SHA256SUMS`; o instalador aborta nesse caso em vez de instalar um
arquivo sem verificação. A página de download continua mostrando os
instaladores antigos quando disponíveis, mas não apresenta comandos de
instalação verificada para eles.

Para usar o instalador em um clone do repositório:

```sh
git clone https://github.com/emanuel-frs/KAMI.git
cd KAMI
sh scripts/install.sh --dry-run
sh scripts/install.sh
```

O instalador detecta Debian/Ubuntu, Fedora/RHEL e Arch. Para outros
Linux, instala o AppImage em `~/.local/bin/kami` e cria um atalho em
`~/.local/share/applications/`. Em Arch, rode como usuário normal:
`makepkg` não pode ser executado como root. Se `makepkg` não estiver
instalado, o instalador usa o AppImage.

Opções disponíveis:

```sh
sh scripts/install.sh --version 1.7.2
sh scripts/install.sh --uninstall
sh scripts/install.sh --help
```

O `--uninstall` remove o pacote ou AppImage e o atalho correspondente,
mas preserva os dados do usuário. Em Linux, os dados ficam em
`$XDG_DATA_HOME/kami` ou, quando `XDG_DATA_HOME` não estiver definido,
em `~/.local/share/kami`.

### Instalação manual e verificação

Baixe o asset adequado e o `SHA256SUMS` da mesma Release. Na pasta dos
downloads, verifique o manifesto antes de instalar:

```sh
sha256sum --ignore-missing --check SHA256SUMS
```

Depois, use o gerenciador da distribuição para instalar o `.deb` ou
`.rpm`, ou torne o AppImage executável e abra-o. Para Arch, use o
`PKGBUILD` versionado da Release e siga sua verificação com
`SHA256SUMS`. Não instale um arquivo cujo checksum divergir.

## Windows

Baixe `kami-<versão>-windows-x64-setup.exe` na página de Releases e
execute o instalador. O NSIS está configurado para instalar no perfil
do usuário atual, sem solicitar privilégios de administrador. O
WebView2 usa o `downloadBootstrapper` padrão do Tauri: se o runtime não
estiver disponível, o instalador busca o bootstrapper oficial da
Microsoft; isso pode exigir conexão à internet.

### Windows sem assinatura

O instalador ainda não é assinado. Por isso, o SmartScreen pode mostrar
um aviso de editor desconhecido. Se você decidiu confiar no arquivo,
confirme que ele veio da Release oficial e que o SHA-256 confere; na
tela do SmartScreen, o fluxo usual é **Mais informações → Executar
assim mesmo**.

O Smart App Control pode bloquear um aplicativo sem assinatura sem
oferecer uma opção para liberá-lo naquela tela. Não desative as
proteções do Windows para contornar esse bloqueio. As alternativas são
usar uma instalação/máquina em que o aplicativo possa ser executado de
acordo com a política local ou aguardar uma futura decisão sobre
assinatura; não há garantia de que o aviso ou o bloqueio desapareçam.

TODO: print aqui

### Desinstalar e dados preservados

Use **Configurações do Windows → Aplicativos → Aplicativos instalados**
para remover o Kami. A desinstalação do programa não deve apagar a pasta
de dados do usuário: `%APPDATA%\kami`. O log do backend fica em
`%APPDATA%\kami\kami-backend.log`.

## Dados, logs e diagnóstico

| Sistema | Dados e log |
|---|---|
| Windows | `%APPDATA%\kami`; log em `%APPDATA%\kami\kami-backend.log` |
| Linux | `$XDG_DATA_HOME/kami` ou `~/.local/share/kami`; log em `kami-backend.log` dentro dessa pasta |

Se o app abrir, mas os widgets não carregarem, o Kami mostra um modal
com o motivo informado pelo backend e o caminho do log. Anexe
`kami-backend.log` ao report do problema no repositório. Antes de
compartilhar, revise o arquivo e remova qualquer informação pessoal que
não queira publicar.
