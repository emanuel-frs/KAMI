<div align="center">

# Kami

**Um app de produtividade pessoal, local-first, que transforma organização de vida em um jogo.**
Carreira, finanças, estudos e metas num só lugar, com os dados no seu computador.

[![Smoke test](https://github.com/emanuel-frs/KAMI/actions/workflows/smoke-test.yml/badge.svg?branch=main)](https://github.com/emanuel-frs/KAMI/actions/workflows/smoke-test.yml)
[![Última versão](https://img.shields.io/github/v/release/emanuel-frs/KAMI)](https://github.com/emanuel-frs/KAMI/releases/latest)
![Licença](https://img.shields.io/badge/licença-source--available-lightgrey)
![Plataformas](https://img.shields.io/badge/Windows%20%7C%20Linux-suportados-blue)

**[⬇ Baixar](https://github.com/emanuel-frs/KAMI/releases/latest)** ·
**[Guia de instalação](./docs/INSTALACAO.md)** ·
**[Relatar problema ou dar feedback](https://github.com/emanuel-frs/KAMI/issues/new/choose)**

<img src="docs/media/kami-demo.gif" alt="Demonstração do Kami: núcleo, finanças, aprendizado e metas" width="820">

---

</div>

> **English:** Kami is a local-first desktop app (Tauri v2 + FastAPI + SQLite, with a
> vanilla JavaScript frontend) that tracks career, finances, learning and goals as a game with XP and
> levels. Your data stays in a local SQLite file; the app only goes online when you enable an
> integration. Windows and Linux builds are available. The UI is in Brazilian Portuguese.
> Source-available, not open source (see [LICENSE](./LICENSE)).

---

## O que é e para quem é

Eu tinha informação pessoal espalhada em anotações soltas, planilhas, e-mails e memória, sem nenhuma
visão consolidada de carreira, finanças, aprendizado e metas. O Kami junta isso num app só e usa uma
ideia simples para dar motivo de voltar: cada ação registrada (um gasto lançado, um módulo de estudo
concluído, uma meta que avançou) gera XP em um de cinco atributos de vida, sobe de nível e libera
conquistas.

O visual é uma homenagem a terminais antigos: preto, branco, cinza e uma única cor de destaque,
configurável.

**Para quem é:** quem gosta de ferramentas locais, que não exigem conta nem assinatura, e se sente à
vontade com uma interface em português e feriados do Brasil. **Quem não vai gostar:** quem precisa de
macOS, de sincronização entre dispositivos ou de aplicativo para celular, que não existem.

Projeto pessoal, mantido por uma pessoa. Foi feito para o meu uso e publicado como portfólio.

| Núcleo | Finanças | Aprendizado |
|---|---|---|
| <img src="docs/media/screenshot/nucleo.png" width="260"> | <img src="docs/media/screenshot/financas.png" width="260"> | <img src="docs/media/screenshot/aprendizado.png" width="260"> |

## Funcionalidades

- **Núcleo:** os cinco atributos de vida (Carreira, Finanças, Aprendizado, Organização e Metas), cada
  um com XP e nível, nível geral do jogador, log filtrável de tudo que foi registrado, 50 conquistas
  automáticas (com níveis e algumas secretas), conquistas que você mesmo cria ("10 ações em
  aprendizado com 'inglês'") e um painel de widgets que você arruma como quiser. Cada ação mostra o XP
  ganho na hora; subir de nível abre uma tela própria e conquistas sobem num aviso no canto da tela.
- **Hábito:** sequência de dias com uma chama em pixel art que cresce com ela e proteções que seguram
  um dia em branco; três missões por dia e uma por semana, sorteadas a partir do que dá para fazer
  agora; bônus de XP pela primeira ação do dia, pela sequência e por cuidar do atributo mais atrasado;
  e o radar avisa quando um atributo está parado há duas semanas.
- **Progressão:** subir o nível geral libera títulos (exibidos sob o seu nome) e temas de terminal
  (fósforo, CRT e âmbar); sua classe (Erudito, Mercador, Artífice, Estrategista, Arquivista ou Polímata)
  vem do atributo mais forte; e todo mês abre uma retrospectiva em ASCII do mês que acabou, exportável
  em `.txt`.
- **Cara de terminal antigo:** texto que se digita, números que rolam, cards que ligam como um CRT,
  brilho de fósforo e cursor em pixel art, além de bipes 8-bit gerados na hora para progresso, cliques
  e avisos. Efeitos (completo, sutil ou desligado) e sons (por grupo, com volume) se ajustam em
  configurações › aparência.
- **Finanças e Wallet:** renda recorrente com cálculo de dia útil (calendário brasileiro), contas
  fixas, dívidas, assinaturas, compras parceladas, cartões de crédito, lançamentos por categoria e
  visão mensal com comparação com o mês anterior. Lançamento digitado errado se corrige ou apaga, e o
  saldo e o XP acompanham; quitar uma dívida pode lançar a saída na conta.
- **Aprendizado:** trilhas de estudo com marcos, progresso automático, roadmap reordenável e heatmap de
  atividade.
- **Metas pessoais:** tipos como financeira, saúde, leitura, hábito, aprendizado e acadêmica, com um peso
  que multiplica o XP. Uma meta financeira pode debitar de uma conta real do Wallet.
- **Organização:** notas com editor visual (salvas em markdown, com tags, cores, vínculo a metas,
  trilhas, eventos e posições, e notas trancadas pelo PIN), caixa de entrada da captura rápida, links
  categorizados, status dos seus repositórios do GitHub, e-mail por IMAP lido como texto limpo (sem
  HTML de terceiros, com link para abrir no webmail) e busca na web opcional.
- **Captura e busca:** `Alt+Q` anota qualquer coisa de qualquer tela — `$ 32,90 farmácia ontem` vira
  um gasto, `# ideia` uma nota, `! sexta 14h reunião` um evento, `@ amanhã 9h ligar pro banco` um
  lembrete, e o resto vai para a caixa de entrada; `Ctrl+K` busca em tudo (sem ligar para acento) e
  roda comandos.
- **Hábitos:** tela própria (`Alt+9`) com hábitos diários, em dias fixos ou "x vezes por semana",
  grade das últimas 12 semanas, sequência e recorde por hábito, pausa e arquivo; marcar dá XP e conta
  para as missões e para a sequência geral.
- **Lembretes:** com dia, hora e repetição, ligados a notas, contas, metas ou hábitos, avisam dentro do
  app e pela notificação do sistema (com "adiar"); avisos de vencimento agrupados num horário escolhido.
  Opcional: manter o Kami na bandeja ao fechar e iniciar com o sistema.
- **Carreira e Calendário:** linha do tempo de posições, formação e histórico salarial; calendário
  mensal que reúne contas, dívidas, parcelas, metas, eventos próprios e lembretes.
- **Datas no seu formato:** seguem o idioma do sistema (dd/mm/aaaa no Brasil), ou o formato escolhido
  em configurações › aparência.
- **Perfil:** avatar em ASCII gerado no próprio app a partir de uma foto; só o texto é salvo, a foto não.
- **Confiabilidade:** quando algo dá errado aparece um aviso com um código que também está no log;
  se o backend cair, o app percebe e o reinicia sozinho, sem fechar; antes de atualizar o banco para
  uma versão nova, o Kami guarda uma cópia e volta para ela se a atualização falhar; e em
  configurações › sobre dá para copiar um diagnóstico, sem dados pessoais, para relatar um problema.
- **Telas que se organizam:** os widgets se encaixam sozinhos em faixas alinhadas, em qualquer tamanho
  de janela e com qualquer quantidade de dados, e cada tela tem um layout padrão montado para combinar
  (com "restaurar padrão"). Um widget removido e adicionado de novo volta para o lugar dele.
  Opcional: o ícone do app na cor de destaque.
- **Segurança:** PIN opcional para abrir o app (com código de recuperação e bloqueio por
  inatividade), backup exportado com senha, e as senhas salvas protegidas por uma chave no cofre do
  sistema. Detalhes e limites em [SECURITY.md](./SECURITY.md).

Hoje o Kami **não usa inteligência artificial**. O "assistente Kami" que aparece na barra lateral
está marcado como "em breve" e ainda não faz nada.

## Instalar

Baixe o instalador na [página de Releases](https://github.com/emanuel-frs/KAMI/releases/latest) e
confira o `SHA256SUMS` publicado junto. Detalhes completos, desinstalação e onde ficam os dados estão em
[docs/INSTALACAO.md](./docs/INSTALACAO.md).

| Sistema | Como |
|---|---|
| **Windows (64 bits)** | Baixe `kami-<versão>-windows-x64-setup.exe` e execute. Instala só para o seu usuário, sem pedir administrador. Veja o aviso abaixo. |
| **Debian, Ubuntu e derivados** | `.deb` da Release, ou `sh scripts/install.sh` |
| **Fedora, RHEL e derivados** | `.rpm` da Release, ou `sh scripts/install.sh` |
| **Arch e derivados** | `PKGBUILD` da Release (usa `makepkg`), ou `sh scripts/install.sh` |
| **Outras distribuições** | `.AppImage` |
| **macOS** | Não suportado ainda |

### ⚠ O instalador do Windows não é assinado

Assinatura de código para Windows é paga e o Kami é um projeto pessoal, então o instalador **não é
assinado**. Na prática, o SmartScreen ou o Defender podem mostrar "editor desconhecido" ou até avisar
que o arquivo pode ser malicioso. Isso é comum em programas novos e sem assinatura, e este também embute
um backend em Python empacotado com PyInstaller, formato que antivírus às vezes marcam por engano.
**O aviso não prova que o arquivo é seguro nem que é perigoso.** Confira a origem antes de confiar:

1. baixe só da página de Releases deste repositório;
2. compare o hash com o do `SHA256SUMS` (`Get-FileHash <arquivo> -Algorithm SHA256`);
3. se quiser, envie o arquivo ao VirusTotal;
4. o código está aqui e o instalador é gerado pelo workflow público
   [`release.yml`](./.github/workflows/release.yml).

Passo a passo do SmartScreen, do Defender e do Smart App Control em
[docs/INSTALACAO.md](./docs/INSTALACAO.md#windows-sem-assinatura).

**Outras limitações:** sem atualização automática (baixe a nova Release), interface só em português e
feriados do Brasil.

## Privacidade: o que sai da sua máquina

Seus dados ficam num banco SQLite local. O app só acessa a internet quando você ativa uma integração.
Sem isso, nada sai do computador. Não há telemetria nem conta de usuário.

| Destino | Quando | O que é enviado |
|---|---|---|
| `api.github.com` | só se você cadastrar um repositório ou token | nomes de repositórios e o token (no header) |
| Seu provedor de e-mail (IMAP) | só se você cadastrar uma conta | usuário e senha de app, por conexão SSL |
| `api.tavily.com` | só se você cadastrar uma chave de busca | suas buscas e a chave |
| `duckduckgo.com` | só ao clicar em "abrir busca" | a busca, aberta no navegador |
| Microsoft (Windows) | só na instalação, se faltar o WebView2 | download do runtime |

Senhas de app e tokens ficam cifrados no banco, com a chave no cofre do sistema (Gerenciador de
Credenciais no Windows, Secret Service no Linux), não na pasta de dados. Isso não protege contra outro
programa rodando com o seu usuário; o [SECURITY.md](./SECURITY.md) descreve o que o Kami protege e o
que não protege.

## Como funciona por dentro

```mermaid
flowchart LR
  subgraph Desktop["App desktop (Tauri v2, Rust)"]
    W["WebView<br/>HTML, CSS e JS puro (ES Modules)"]
    R["Casca Rust<br/>inicia e encerra o sidecar"]
  end
  subgraph Sidecar["Sidecar (PyInstaller)"]
    A["FastAPI em 127.0.0.1<br/>porta escolhida pelo sistema"]
  end
  D[("SQLite<br/>pasta de dados do usuário")]
  X["GitHub, IMAP, Tavily<br/>só se você ativar"]

  R -->|"1. inicia"| A
  A -->|"2. grava porta e token"| R
  W -->|"3. pede porta e token"| R
  W -->|"4. HTTP com X-Kami-Token"| A
  A --> D
  A -.->|"opcional"| X
```

O frontend é HTML, CSS e JavaScript puro com módulos ES e sem bundler. O backend é FastAPI com SQLite e
vira um executável único com PyInstaller, que o Tauri embute como *sidecar*. A cada execução o sidecar
escolhe uma porta livre em `127.0.0.1` e gera um token aleatório; só o app, que lê esses dois valores de
arquivos na pasta de dados, consegue usar a API.

## Decisões técnicas e o que aprendi

**"Funciona na minha máquina" não é "funciona na máquina de outra pessoa".** O primeiro instalador do
Windows abria o app, mas o backend embutido morria em silêncio: sem console, o PyInstaller deixa
`stdout` e `stderr` nulos e o uvicorn quebrava ao configurar o log. Ainda por cima, a porta era publicada
*antes* de o servidor estar de pé. A correção foi gravar logs em arquivo, publicar a porta só depois da
inicialização, mostrar na tela o motivo da falha com o caminho do log, e instalar o app em máquinas limpas
de Windows, Debian, Fedora e Arch a cada envio ao repositório, pelo CI.

**Uma API em `localhost` não é segura só por isso.** O backend escuta apenas em `127.0.0.1`, mas o CORS
estava aberto e a API tem rotas como o export completo dos dados. Qualquer página aberta no navegador
poderia varrer portas locais e usá-las. Tentei restringir pela origem da requisição e isso quebrou o app,
porque a origem real do Tauri não era a documentada. A solução foi não depender da origem: um token de
sessão por execução, que uma página web não consegue obter. Os testes do sidecar em Linux conferem que a
API responde `401` sem ele.

**Fechar o app tem que fechar tudo.** O backend é um executável PyInstaller de arquivo único: um
inicializador que roda o Python num processo filho. No Linux, encerrar o app matava só o inicializador,
e o backend de verdade ficava rodando órfão a cada fechada. Só apareceu testando o app real, contando
processos depois de fechar a janela. Agora o app encerra a árvore inteira, e o backend também sai sozinho
se o app sumir sem avisar.

**Promessas de privacidade precisam bater com o código.** Ao revisar, descobri que o app ainda pedia o
ícone de cada link salvo a um serviço do Google. Troquei por uma inicial local, e a tabela acima descreve
só o que realmente sai da máquina.

**Sem framework nem bundler no frontend.** Foi uma escolha de simplicidade e de aprender a plataforma, e
tem custo: alguns arquivos ficaram grandes (veja o roadmap).

## Problemas conhecidos e roadmap

Sem datas. Até a **2.0** (a versão em que o Kami entra em pausa, sem novidades por um tempo), o plano é:

- **Base:** atualização avisada pelo próprio app (instala só quando você quiser), backup automático
  (inclusive numa segunda pasta, como um pendrive), desinstalação que não deixa nada para trás, testes
  automáticos cobrindo todas as telas e arquivos grandes divididos (`aprendizado.js`, `organizacao.py`).
- **Idiomas:** português, inglês, espanhol, francês, italiano, alemão, chinês, japonês, coreano e hindi.
- **Assistente de IA (opcional, desligado por padrão):** chat, ações sempre com prévia e confirmação,
  avisos, e IA local rodando no seu computador. Nenhuma chave vem embutida.
- **Banco cifrado em disco**, opcional.

Ficam de fora, pelo menos até a 2.0:

- **Windows:** assinatura de código. O aviso do SmartScreen continua aparecendo, porque a opção gratuita
  para open source não vale para a licença atual (veja o [SECURITY.md](./SECURITY.md#instaladores)). O CI
  valida instalação e backend, mas não o comportamento do antivírus de cada PC.
- **macOS, celular e sincronização entre dispositivos.**
- **Ícones dos links** guardados localmente, **PyInstaller em modo pasta** (reduz falsos positivos) e
  publicação no AUR e em outros repositórios. Veja [docs/ROADMAP-INSTALACAO.md](./docs/ROADMAP-INSTALACAO.md).

## Licença e contribuição

Código **visível, mas não open source**. Você pode ler o código, instalar e usar o Kami para fins
pessoais, mas não pode redistribuí-lo, publicar cópias como outro produto nem usá-lo comercialmente sem
autorização. Texto completo em [LICENSE](./LICENSE).

Feedback é bem-vindo: [abra uma issue](https://github.com/emanuel-frs/KAMI/issues/new/choose) contando o
que funcionou, o que travou e em que sistema. Pull requests podem ser recusados, e o
[LICENSE](./LICENSE) explica o que acontece com contribuições. Problemas de segurança:
[SECURITY.md](./SECURITY.md).

## Para desenvolvedores

<details>
<summary>Rodar a partir do código-fonte, testes e build</summary>

### Requisitos

- Python 3.14 (`.python-version`; é o que o CI usa e o que vai dentro do backend empacotado)
- Node.js 24 (`.nvmrc`; só para os testes do frontend)
- Rust na versão de `rust-toolchain.toml` (o `rustup` instala sozinho) e a Tauri CLI
  (`cargo install tauri-cli --version "^2" --locked`), só para o modo desktop
- Dependências de sistema do Tauri no Linux: veja [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

Voltando ao projeto depois de muito tempo (versões, runners do CI, dependências, soltar uma correção):
[docs/MANUTENCAO.md](./docs/MANUTENCAO.md).

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Cria `backend/kami.db` na primeira execução. Documentação interativa em `http://127.0.0.1:8000/docs`.
Neste modo não há token de sessão; ele só existe no backend empacotado.

### Frontend

Desktop, com o backend rodando (`KAMI_DEV_NO_SIDECAR=1` evita subir o sidecar empacotado):

```bash
cd src-tauri
KAMI_DEV_NO_SIDECAR=1 cargo tauri dev
```

Web, servindo os módulos ES (não abra o arquivo direto):

```bash
cd frontend
python3 -m http.server 5500
```

Atenção: `cargo tauri dev` sem essa variável usa o binário do sidecar que já está em
`src-tauri/binaries/`. Se ele for antigo, o app mostra erro ao iniciar. Reconstrua com `./build.sh`.

### Modo demo (dados fictícios)

Para gravar telas ou testar sem tocar nos seus dados:

```bash
cd backend
KAMI_DATA_DIR=/tmp/kami-demo uvicorn app.main:app --port 8000

# em outro terminal, na raiz do repositório
python3 scripts/seed_demo.py
```

O seed se recusa a rodar numa instância que já tem dados. E-mail e GitHub ficam vazios no demo, porque
dependem de credenciais.

### Testes

```bash
cd backend && pytest     # backend
npm install && npm test  # frontend (runner nativo do Node)
```

O CI roda essas duas suítes no Linux e no Windows em todo PR.

**Teste ponta a ponta** (`tests/e2e/kami-e2e.mjs`): abre o app compilado
com dados fictícios, passa pelas 8 telas em 3 tamanhos de janela e tira
prints. Também registra uma ação pela interface, derruba o backend para
conferir que ele volta sozinho e verifica que o log terminou sem erros. No
CI ele roda em PRs para `main`, em `release/**` e no disparo manual, e os
prints viram artefato do workflow. Para rodar no Linux, é preciso o
`WebKitWebDriver` (pacote `webkit2gtk-driver`/`webkit2gtk4.1`) e o
`tauri-driver` (`cargo install tauri-driver --locked`):

```bash
./scripts/build_sidecar.sh && (cd src-tauri && cargo tauri build --debug --no-bundle)
KAMI_E2E_APP=src-tauri/target/debug/kami KAMI_E2E_PYTHON=backend/.venv/bin/python node tests/e2e/kami-e2e.mjs
```

### Build de produção

```bash
cd backend && source .venv/bin/activate && pip install pyinstaller
./build.sh               # na raiz: sidecar + instaladores em src-tauri/target/release/bundle/
```

No Windows o build precisa rodar numa máquina Windows (sem cross-compile) com Python, Rust, a Tauri CLI
e Git Bash. A versão vive em `VERSION`; use `scripts/bump-version.sh` em vez de editá-la à mão.

### Publicar uma release

A versão vive em `VERSION`. O workflow
[`release.yml`](./.github/workflows/release.yml) gera os instaladores para Windows e
Linux, publica os checksums e cria a GitHub Release quando recebe uma tag `v*.*.*`.

### Estrutura

```
backend/      FastAPI, SQLite, testes e entrypoint do sidecar (run_server.py)
frontend/     HTML, CSS e JS puro: pages/, widgets/, modals/, api/
src-tauri/    casca desktop (Rust, Tauri v2)
scripts/      instalação, versão, seed do modo demo e testes de CI
docs/         guia de instalação, roadmap e página de download
```

</details>

---

<div align="center">

Feito por **Emanuel** ([@emanuel-frs](https://github.com/emanuel-frs)) · ([LinkedIn](https://www.linkedin.com/in/emanuel-f-2565181b6/))

</div>
