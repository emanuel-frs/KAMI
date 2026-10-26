# Instalação do Kami

*[English](./INSTALACAO.en.md)*

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
sh scripts/install.sh --version 1.8.1
sh scripts/install.sh --uninstall
sh scripts/install.sh --uninstall --apagar-dados
sh scripts/install.sh --help
```

O `--uninstall` remove o pacote ou AppImage e o que o Kami deixou na sua
pasta pessoal (o iniciar com o sistema e o lançador com o ícone da cor),
mas preserva os dados do usuário. Com `--apagar-dados` ele apaga também
os dados, o cache da tela e a chave das senhas no cofre do sistema —
pede para você digitar `apagar` antes. Em Linux, os dados ficam em
`$XDG_DATA_HOME/kami` ou, quando `XDG_DATA_HOME` não estiver definido,
em `~/.local/share/kami`.

Removeu o pacote direto pelo `apt`/`dnf`/`yay`, sem o script? O Kami
não aparece mais no menu nem tenta abrir no login (as entradas que ele
deixou na pasta pessoal se desligam sozinhas quando o programa some), e os
arquivos que sobraram estão listados em
[Remover tudo à mão](#remover-tudo-à-mão).

### Fontes para chinês, japonês, coreano e hindi

O Kami usa as fontes do sistema. A maioria das distribuições já vem com
elas; numa instalação mínima, o texto desses idiomas pode aparecer como
quadradinhos — o app avisa e mostra o pacote. O `.deb` e o `.rpm`
recomendam as fontes, e o PKGBUILD as lista como opcionais:

```sh
sudo dnf install google-noto-sans-cjk-fonts google-noto-sans-devanagari-fonts   # Fedora
sudo apt install fonts-noto-cjk fonts-noto-core                                  # Debian/Ubuntu
sudo pacman -S noto-fonts-cjk noto-fonts                                         # Arch
```

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
2. Compare o hash no PowerShell, na pasta do download:
   `Get-FileHash .\kami-<versão>-windows-x64-setup.exe -Algorithm SHA256`.
   O valor certo está impresso na própria página da Release, logo abaixo
   da tabela de arquivos (e na linha desse arquivo no `SHA256SUMS`).
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

O **Smart App Control** (Windows 11) é mais rígido: ele bloqueia
aplicativos sem assinatura e não oferece um "executar assim mesmo". Com
ele ligado, o Kami não instala nesta máquina — não desative a proteção
só para isso. Não há previsão de assinatura: a opção gratuita exige uma
licença de código aberto, e o Kami não usa certificado pago, então o
aviso do SmartScreen continua aparecendo a cada versão, inclusive quando
você atualiza pelo próprio app.

### Desinstalar e dados preservados

Use **Configurações do Windows → Aplicativos → Aplicativos instalados**
para remover o Kami. O desinstalador tira os atalhos e o iniciar com o
sistema. Os seus dados (`%APPDATA%\kami`) ficam, a não ser que você marque
**"Remover dados do programa"** — aí vão também os dados, as cópias
automáticas e a chave das senhas no Gerenciador de Credenciais. Para
desinstalar sem perguntas: `uninstall.exe /S` (mantém os dados) ou
`uninstall.exe /S /APAGARDADOS`, na pasta do Kami
(`%LOCALAPPDATA%\Kami`).

## Remover tudo do Kami deste computador

Vai parar de usar o Kami nesta máquina? Em **configurações › backup e
dados › remover tudo do kami deste computador** o próprio app apaga, depois
de você confirmar duas vezes: seus dados, as cópias automáticas, a chave
das senhas no cofre do sistema, o iniciar com o sistema, o ícone da cor no
lançador/atalhos e o cache da tela — e fecha. Exporte um backup antes se
quiser guardar algo (o botão está ali mesmo). Ficam: a **pasta extra** das
cópias, se você configurou uma (é a sua cópia fora do computador), e o
**programa** — no Windows o desinstalador abre no fim; no Linux remova o
pacote (`sudo apt remove kami`, `sudo dnf remove kami`, `yay -R kami-bin`)
ou apague o AppImage.

### Remover tudo à mão

O que o Kami cria fora da pasta do programa:

| O quê | Linux | Windows |
|---|---|---|
| dados (banco, cópias, log, ícones da cor) | `~/.local/share/kami` | `%APPDATA%\kami` |
| cache e armazenamento da tela | `~/.local/share/com.kami.app`, `~/.cache/com.kami.app` | `%APPDATA%\com.kami.app`, `%LOCALAPPDATA%\com.kami.app` |
| iniciar com o sistema | `~/.config/autostart/Kami.desktop` | registro: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, valor `Kami` |
| ícone da cor no menu | `~/.local/share/applications/Kami.desktop` (só se tiver `X-Kami-IconeTema`) | atalhos `Kami.lnk` (somem com o programa) |
| chave das senhas | Secret Service/KWallet: serviço `kami`, usuário `chave-dos-segredos-…` | Gerenciador de Credenciais: `kami`, usuário `chave-dos-segredos-…` |
| cópias na pasta extra | a pasta que você escolheu (`kami-semanal-*.db`) | idem |

Na chave das senhas, apague só a do usuário `chave-dos-segredos-…` — outras
entradas do serviço `kami` (de uma pasta de demonstração, por exemplo) são
de outra pasta de dados.

## Atualizar

O Kami avisa no sino quando sai uma versão nova — ele **nunca baixa nem
instala sozinho**. Para saber, consulta só a lista de versões da página de
Releases (ao abrir e uma vez por dia); dá pra desligar em configurações ›
sobre › "procurar atualizações", e lá também tem "procurar agora".

- **Windows**, **AppImage** e **`.rpm`**: "atualizar agora" (no sino ou
  em configurações › sobre) guarda uma cópia do banco
  (`backups/kami-antes-de-atualizar-…`), baixa a versão nova, confere a
  assinatura das atualizações e instala; o Kami fecha e abre de novo já
  atualizado. No `.rpm` o sistema pede a sua senha nessa hora (pkexec).
  No Windows o SmartScreen pode mostrar "editor desconhecido" de novo —
  é o mesmo aviso da instalação (veja
  [Windows sem assinatura](#windows-sem-assinatura)).
- **`.deb` e AUR**: o aviso aparece igual, mas quem atualiza é o
  gerenciador de pacotes do sistema (baixe o pacote novo da Release e
  instale por cima, ou `yay -Syu` no Arch). Os seus dados ficam.

**Atualizar o `.rpm` sozinho (opcional).** Quem prefere não pensar nisso
pode instalar um serviço do sistema que confere a última versão ao ligar o
computador e uma vez por dia, confere o SHA-256 publicado pelo GitHub e
instala com `dnf` — sem perguntar:

```sh
sudo bash scripts/atualizar-rpm.sh instalar   # desfazer: ... remover
```

Avisos de versão de teste (`2.0.0-rc.1`, por exemplo) não aparecem: só
versões publicadas.

## Dados, logs e diagnóstico

| Sistema | Dados e log |
|---|---|
| Windows | `%APPDATA%\kami`; log em `%APPDATA%\kami\kami-backend.log` |
| Linux | `$XDG_DATA_HOME/kami` ou `~/.local/share/kami`; log em `kami-backend.log` dentro dessa pasta |

Se o backend não subir ou cair, o Kami mostra uma faixa no topo com o
motivo, tenta reiniciar sozinho e oferece **reiniciar** e **abrir pasta
do log**. Anexe
`kami-backend.log` ao report do problema no repositório. Antes de
compartilhar, revise o arquivo e remova qualquer informação pessoal que
não queira publicar.

Quando algo dá errado do lado do Kami, aparece um aviso vermelho com um
código (ex.: `código #k7f2a9`) e o botão **copiar detalhes**. O mesmo
código está na linha do erro no `kami-backend.log`. Cole os detalhes no
relato para achar o problema rápido. Erros da própria tela também vão
para o log, como `[app.frontend]`.

Cada linha do log começa com a data e a hora local (ex.:
`2026-10-17 16:42:07.684-03:00 INFO [uvicorn.error] ...`), então dá para
achar o trecho do momento em que o problema aconteceu. Quando passa de
1 MB, o log atual vira `kami-backend.log.old` e um novo começa. Endereços
de requisição aparecem sem os parâmetros (`?busca=...`), para não gravar
buscas e filtros no disco.

### O que fica na pasta de dados

| Arquivo | O que é |
|---|---|
| `kami.db` (e `kami.db-wal`, `kami.db-shm`) | todos os seus dados |
| `backups/` | cópias automáticas do banco: semanais (as 4 últimas), antes de ações grandes — importar, apagar tudo, redefinir a chave, restaurar, atualizar o app — (as 5 últimas) e antes de migrar o banco para uma versão nova (as 3 últimas) |
| `kami-backend.log` (e `.old`) | o log do backend |
| `backend_port.txt`, `backend_token.txt` | porta e token da execução atual; recriados a cada abertura |
| `pin.json` | só com o PIN ligado: o hash do PIN e do código de recuperação |
| `.secret_key_no_cofre` | marcador de que a chave das senhas salvas está no cofre do sistema (sem segredo nenhum) |
| `.secret_key` | só em sistemas sem cofre: a chave das senhas salvas |

**Esqueci o PIN.** Na tela de bloqueio, use "esqueci o PIN" com o código
de recuperação mostrado quando o PIN foi ligado. Sem o código: feche o
Kami e apague `pin.json` dessa pasta. Na próxima abertura ele abre sem
PIN, com todos os dados — o PIN protege a abertura do app, não cifra o
banco.
