<div align="center">

``` text
██╗  ██╗ █████╗ ███╗   ███╗ ██╗
██║ ██╔╝██╔══██╗████╗ ████║ ██║
█████╔╝ ███████║██╔████╔██║ ██║
██╔═██╗ ██╔══██║██║╚██╔╝██║ ██║
██║  ██╗██║  ██║██║ ╚═╝ ██║ ██║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═╝
```

**Sistema pessoal de organização gamificada — 100% local**

Carreira, finanças, aprendizado, metas e organização do dia a dia,
centralizados em um só lugar, com XP, níveis e conquistas.

`Python` · `FastAPI` · `SQLite` · `HTML/CSS/JS puro` · `Tauri`

</div>

---

## Sobre o projeto

Kami nasceu de um problema bem concreto: informação pessoal espalhada
em anotações soltas, planilhas, e-mails e memória mesmo — sem nenhuma
visão consolidada de carreira, finanças, aprendizado e metas. Kami
resolve isso transformando organização de vida em um "jogo": cada
ação registrada (um gasto lançado, um módulo de estudo concluído, uma
meta que avançou) gera XP num dos 5 atributos de vida do sistema, sobe
de nível e desbloqueia conquistas — um pouco no espírito da tela de
conquistas da Steam.

Todo o app roda localmente na máquina do usuário: nenhum dado sai da
sua máquina, nenhum serviço pago é necessário. O visual é uma
homenagem a terminais antigos — paleta preto/branco/cinza com uma
única cor de destaque, configurável.

Uma assistente de IA local (a própria Kami, rodando via Ollama) que
ajuda a registrar, resumir e sugerir coisas faz parte da visão do
produto, mas é um módulo pós-MVP — ver [Roadmap](#roadmap) abaixo.

## Screenshots

<!--
Como preencher esta seção: rode o projeto localmente (veja "Como
rodar" abaixo), navegue pelas telas e salve os prints em
docs/screenshots/ com esses nomes. Substitua os placeholders pelas
tags de imagem reais, por exemplo:

![Núcleo](docs/screenshots/nucleo.png)
-->

| Tela | Descrição |
|---|---|
| `docs/screenshots/nucleo.png` | Dashboard do Núcleo — atributos, log de ações, conquistas e widgets configuráveis |
| `docs/screenshots/perfil.png` | Perfil com avatar pessoal em ASCII e seletor de cor de destaque |
| `docs/screenshots/financas.png` | Visão mensal de Finanças, cartões, contas fixas e Wallet |
| `docs/screenshots/aprendizado.png` | Trilhas de aprendizado com roadmap de timeline e heatmap de atividade |
| `docs/screenshots/organizacao.png` | Hub de Organização — links, GitHub e e-mail via IMAP |
| `docs/screenshots/onboarding.png` | Tour de onboarding em modais sequenciais |

## Funcionalidades

Cada módulo abaixo é uma tela própria na sidebar. `✅ v1` já está
implementado e em uso; `🔒 pós-MVP` está planejado e vai entrar depois
do lançamento (ver [Roadmap](#roadmap)).

- **✅ Perfil** — nome de exibição, cor de destaque do app e avatar
  pessoal gerado 100% no navegador (upload de foto → conversor
  imagem→ASCII via `<canvas>`, nada sai da máquina; só o resultado em
  texto é salvo, não a foto original).
- **✅ Núcleo** — o coração da gamificação: 5 atributos de vida
  (Carreira, Finanças, Aprendizado, Organização, Metas Pessoais),
  cada um com XP e nível própios; log cronológico e filtrável de
  tudo que foi registrado; conquistas automáticas por regra fixa
  (ex: streak de dias registrando algo); dashboard de prioridades; e
  um **sistema de widgets configurável** (arrastar, redimensionar,
  adicionar/remover, inclusive widgets cross-module) tanto no Núcleo
  quanto no Perfil.
- **✅ Finanças** — renda recorrente em parcelas com cálculo de dia
  útil real (calendário nacional brasileiro), múltiplos cartões de
  crédito, contas fixas, dívidas pessoais, compras parceladas e
  assinaturas, lançamentos com categoria, visão mensal (entradas vs.
  saídas, comparação com o mês anterior, categorias que mais
  pesaram) e um módulo **Wallet** dedicado a contas e saldos.
- **✅ Aprendizado** — trilhas de estudo (ex: programação, inglês,
  francês) com marcos/checklist, progresso calculado
  automaticamente, roadmap em timeline com edição inline e
  reordenação por drag-and-drop, e um heatmap de atividade estilo
  GitHub contribution graph.
- **✅ Organização** — hub de acesso rápido: links categorizados com
  favicon público como ícone, projetos do GitHub via API pública, e
  e-mail via IMAP de verdade (múltiplas contas, sincronização sob
  demanda, texto puro sem HTML de terceiros por segurança — sem
  resumo por IA ainda, isso é pós-MVP).
- **✅ Metas Pessoais** — metas financeiras (vinculadas a um valor
  alvo) e metas livres/personalizadas (contador simples), com
  histórico de contribuições e XP bônus ao concluir. Metas
  acadêmicas entram junto com o módulo Carreira.
- **✅ Onboarding** — tour interativo em modais sequenciais na
  primeira execução, com mini-ilustrações estáticas por conceito do
  sistema; pode ser reaberto a qualquer momento pelas configurações.
- **🔒 Carreira** — perfil profissional estilo LinkedIn: histórico de
  posições, formação, histórico e meta salarial.
- **🔒 Calendário** — agregador transversal de vencimentos, prazos de
  metas e marcos de aprendizado, sem tabela própria.
- **🔒 Assistente Kami (IA local)** — chat via Ollama para registrar
  ações por linguagem natural, resumir e-mails, apontar padrões
  financeiros e sugerir conquistas personalizadas.

## Stack técnica

| Camada | Tecnologia | Por quê |
|---|---|---|
| Backend | Python + FastAPI | API leve, tipada, com Swagger automático |
| Banco de dados | SQLite | Arquivo local, zero servidor externo |
| Frontend | HTML/CSS/JS puro (ES Modules, sem bundler) | Evita o consumo de RAM de React/Vue |
| App desktop | Tauri | Usa o WebKitGTK nativo do Linux — muito mais leve que Electron |
| IA local (pós-MVP) | Ollama | Modelo leve/médio local, sem dado saindo da máquina |
| Ícones | Lucide (SVG, self-hosted) + Nerd Fonts | Sem CDN, 100% local |
| Calendário BR | `workalendar` | Feriados e dias úteis reais para os cálculos de Finanças |

## Como rodar

Duas formas de rodar o Kami em dev: como app desktop de verdade (via
Tauri, recomendado) ou direto no navegador (mais rápido pra iterar só
no frontend, sem precisar compilar nada em Rust).

### Requisitos

- Python 3.x
- Rust + Cargo, com a Tauri CLI instalada (`cargo install tauri-cli
  --version "^2" --locked`) — necessário só pro modo desktop
- Dependências de sistema do Tauri no Linux (libwebkit2gtk,
  libgtk-3-dev etc.) — ver
  [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
- Um navegador moderno (Chrome, Firefox) — necessário só pro modo web

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Isso cria automaticamente `backend/kami.db` (SQLite, gitignored) na
primeira execução, já com o schema completo e os 5 atributos
semeados. Confira se está no ar:

```bash
curl http://127.0.0.1:8000/health
```

Documentação interativa (Swagger) em `http://127.0.0.1:8000/docs`.

### 2a. Frontend — modo desktop (Tauri, recomendado)

Com o backend já rodando (passo 1), numa janela nativa de verdade
(titlebar customizada, ícone, sem navegador):

```bash
cd src-tauri
cargo tauri dev
```

Isso sobe o Kami numa janela real do sistema, lendo o frontend
direto de `frontend/`. Pra rodar sem precisar do backend empacotado
(sidecar) — só usando o `uvicorn --reload` do passo 1 mesmo — exporte
`KAMI_DEV_NO_SIDECAR=1` antes do comando acima.

### 2b. Frontend — modo web (mais rápido pra iterar só em HTML/CSS/JS)

O frontend usa ES Modules (`<script type="module">`), então **não
abra `index.html` direto com duplo clique** — a maioria dos
navegadores bloqueia módulos carregados via `file://`. Sirva a pasta
com um servidor estático simples:

```bash
cd frontend
python3 -m http.server 5500
```

E acesse `http://127.0.0.1:5500` no navegador, com o backend já
rodando em `http://127.0.0.1:8000` (o frontend consome a API por lá).
Nesse modo a titlebar customizada não aparece (ela só faz sentido
dentro do Tauri) e os botões que abrem links externos usam
`window.open` normal do navegador.

### Testes

```bash
cd backend
pytest
```

175 testes cobrindo validações de saldo/limite em transações, compras
parceladas, e os fluxos principais de cada módulo.

## Empacotar (build de produção)

O Kami roda como um binário instalável (.deb/.rpm no Linux), sem
precisar de Python nem de servidor rodando à parte — o backend vai
embutido no app como um binário standalone (PyInstaller) que o Tauri
sobe e derruba automaticamente junto com a janela.

Pré-requisitos únicos (uma vez por máquina):

```bash
# dentro do venv do backend, além das deps normais:
cd backend && source .venv/bin/activate && pip install pyinstaller

# CLI do Tauri:
cargo install tauri-cli --version "^2" --locked
```

Com isso feito, regerar o app inteiro do zero é um único comando na
raiz do repositório:

```bash
./build.sh
```

Isso (1) reempacota o backend com o PyInstaller e coloca o binário no
lugar que o Tauri sidecar espera, (2) roda `cargo tauri build`
empacotando esse binário junto com o frontend, e (3) imprime o
caminho final dos instaladores gerados. `bundle.targets` está
configurado como `"all"`, então o Tauri gera todo instalador válido
pro sistema operacional onde o build rodou.

Variações úteis:

```bash
./build.sh --skip-sidecar  # só o frontend/Rust mudou — reusa o binário do backend já buildado
./build.sh --clean         # build limpo, apaga target/ e build/dist/ do backend antes
./build.sh --dev           # não empacota nada, só abre a janela em modo dev (atalho pra cargo tauri dev)
./build.sh --help          # detalhes de cada flag
```

### Linux (.deb / .rpm)

Rode `./build.sh` normalmente numa máquina Linux. Instaladores saem
em `src-tauri/target/release/bundle/{deb,rpm}/`.

### Windows (.exe)

Sem cross-compile (decisão do projeto): não dá pra gerar o `.exe`
rodando `./build.sh` no Linux — o build precisa rodar numa máquina
Windows de verdade. Pré-requisitos na máquina Windows:

- Python 3.x + o mesmo venv/`pip install -r requirements.txt
  pyinstaller` do passo 1 (backend)
- Rust + Cargo (via [rustup](https://rustup.rs)) e a Tauri CLI
  (`cargo install tauri-cli --version "^2" --locked`)
- Git Bash (vem com o [Git for Windows](https://git-scm.com/downloads/win))
  pra rodar o `build.sh` e o `scripts/build_sidecar.sh`, que são
  scripts bash
- O bundler NSIS do Tauri baixa o instalador do NSIS sozinho na
  primeira vez — não precisa instalar nada manualmente pra isso

Com tudo isso instalado, dentro do Git Bash:

```bash
./build.sh
```

O `.exe` (NSIS) sai em
`src-tauri/target/release/bundle/nsis/Kami_0.1.0_x64-setup.exe` — é
esse arquivo que você manda pro seu amigo; ele não precisa ter Python
nem nada instalado pra rodar, o instalador já embute tudo.

## Estrutura do projeto

```
kami/
├── build.sh                   # regera o app inteiro (sidecar + cargo tauri build)
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── widgets.py         # catálogo de widgets do dashboard
│   │   ├── schema.sql
│   │   └── routers/           # perfil, nucleo, financas, wallet,
│   │                          # aprendizado, organizacao, metas, dashboard
│   ├── tests/
│   ├── run_server.py          # entrypoint do backend empacotado (sidecar)
│   ├── kami-backend.spec      # spec do PyInstaller
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── css/
│   │   ├── tokens.css
│   │   ├── base.css
│   │   └── widgets/
│   └── js/
│       ├── api/
│       ├── pages/              # uma tela por módulo
│       ├── state/
│       ├── widgets/            # widgets de dashboard + grid/registry
│       ├── modals/
│       ├── charts/
│       └── components/
├── src-tauri/                  # wrapper desktop (Tauri v2)
│   ├── src/main.rs
│   ├── tauri.conf.json
│   ├── capabilities/
│   └── binaries/                # sidecar do backend (gitignored, gerado pelo build)
└── scripts/
    └── build_sidecar.sh         # empacota o backend com PyInstaller (chamado por build.sh)
```

## Roadmap

Fora do escopo do v1 por decisão consciente (reduzir a superfície da
primeira versão, não cortar módulos do design):

- **Assistente Kami (IA via Ollama)** — chat, registro por linguagem
  natural, resumo de e-mail, alertas financeiros e sugestão de
  conquistas.
- **Carreira** — perfil profissional, histórico salarial, metas
  acadêmicas.
- **Calendário** — agregador transversal de prazos e vencimentos.
- **Decaimento de XP por atributo** — v1 só soma XP; a regra fina de
  decaimento será definida com dados reais de uso, não adivinhada
  antes do lançamento.
- **Busca com preview estilizado** e **resumo de e-mail por IA** —
  v1 mantém as versões simples (busca abre o DuckDuckGo em nova aba;
  e-mail mostra assunto/remetente/início do corpo em texto puro).

Além disso, um app mobile (provável React Native) está registrado
como projeto futuro à parte, com sincronização direta entre
aparelhos sem depender de nuvem.