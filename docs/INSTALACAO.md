# Instalação do Kami

O Kami é um aplicativo desktop local-first. O backend e o banco SQLite
rodam na sua máquina; nenhum serviço remoto é necessário para usar o app.
Ele só acessa a internet quando você ativa GitHub, e-mail ou busca (lista
completa no [README](../README.md#o-que-sai-da-sua-máquina-e-quando)).
Os instaladores oficiais ficam na [página de Releases](https://github.com/emanuel-frs/KAMI/releases/latest)
e na [página de download](./index.html).

## Linux

As Releases publicadas pelo workflow do repositório trazem, para x86_64,
estes assets:

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
sh scripts/install.sh --version 1.8.0
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

O instalador ainda não é assinado: assinatura de código para Windows é
paga e o Kami é um projeto pessoal. Na prática, isso pode fazer o
Windows mostrar avisos como "editor desconhecido" ou até dizer que o
arquivo pode ser malicioso. Programas novos, sem assinatura e com poucos
downloads costumam cair nisso, e este também embute um backend em Python
empacotado com PyInstaller, formato que antivírus às vezes marcam por
engano (falso positivo). **Isso não é uma prova de que o arquivo é
seguro nem de que é perigoso**: por isso, confira a origem antes de
confiar.

Antes de executar:

1. Baixe o instalador apenas da [página de Releases](https://github.com/emanuel-frs/KAMI/releases/latest) deste repositório.
2. Baixe também o `SHA256SUMS` da mesma Release e compare o hash no PowerShell:
   `Get-FileHash .\kami-<versão>-windows-x64-setup.exe -Algorithm SHA256`
   (o valor deve ser idêntico ao da linha desse arquivo no `SHA256SUMS`).
3. Se quiser uma segunda opinião, envie o arquivo ao VirusTotal.
   Alguns motores podem apontar falso positivo em executáveis não
   assinados.
4. O código-fonte está neste repositório e o instalador é gerado pelo
   workflow público [`release.yml`](../.github/workflows/release.yml).

Se você decidiu confiar no arquivo, na tela do SmartScreen o fluxo usual
é **Mais informações → Executar assim mesmo**. Se o Microsoft Defender
bloquear ou colocar o arquivo em quarentena, o caminho é **Segurança do
Windows → Proteção contra vírus e ameaças → Histórico de proteção**,
onde a detecção pode ser permitida no dispositivo. Faça isso somente se a
origem e o hash estiverem conferidos.

O Smart App Control pode bloquear um aplicativo sem assinatura sem
oferecer uma opção para liberá-lo naquela tela. Não desative as
proteções do Windows para contornar esse bloqueio. As alternativas são
usar uma instalação/máquina em que o aplicativo possa ser executado de
acordo com a política local ou aguardar uma futura decisão sobre
assinatura; não há garantia de que o aviso ou o bloqueio desapareçam.

<!-- [PREENCHER: print da tela do SmartScreen e do botão "Executar assim mesmo" em docs/screenshots/smartscreen.png] -->

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
