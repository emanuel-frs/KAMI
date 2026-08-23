<div align="center">

<pre>
██╗  ██╗ █████╗ ███╗   ███╗ ██╗
██║ ██╔╝██╔══██╗████╗ ████║ ██║
█████╔╝ ███████║██╔████╔██║ ██║
██╔═██╗ ██╔══██║██║╚██╔╝██║ ██║
██║  ██╗██║  ██║██║ ╚═╝ ██║ ██║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═╝
</pre>

**Sistema pessoal de organização gamificada — 100% local**

`v1.3.0` · `Python` · `FastAPI` · `SQLite` · `HTML/CSS/JS puro` · `Tauri`

</div>

---

## ► Sobre o projeto

Kami nasceu de um problema bem concreto: informação pessoal espalhada
em anotações soltas, planilhas, e-mails e memória mesmo — sem nenhuma
visão consolidada de carreira, finanças, aprendizado e metas. Kami
resolve isso transformando organização de vida em um "jogo": cada
ação registrada (um gasto lançado, um módulo de estudo concluído, uma
meta que avançou) gera XP num dos 5 atributos de vida do sistema, sobe
de nível e desbloqueia conquistas.

Todo o app roda localmente na máquina do usuário: nenhum dado sai da
sua máquina, nenhum serviço pago é necessário. O visual é uma
homenagem a terminais antigos — paleta preto/branco/cinza com uma
única cor de destaque, configurável.

## ► Funcionalidades

- **Perfil** — nome de exibição, cor de destaque do app e avatar
  pessoal gerado 100% no navegador (upload de foto → conversor
  imagem→ASCII via `<canvas>`, nada sai da máquina; só o resultado em
  texto é salvo, não a foto original).
- **Núcleo** — o coração da gamificação: 5 atributos de vida
  (Carreira, Finanças, Aprendizado, Organização, Metas Pessoais),
  cada um com XP e nível próprios; log cronológico e filtrável de
  tudo que foi registrado; conquistas automáticas por regra fixa
  (ex: streak de dias registrando algo); dashboard de prioridades; e
  um sistema de widgets configurável (arrastar, redimensionar,
  adicionar/remover, inclusive widgets cross-module) tanto no Núcleo
  quanto no Perfil.
- **Finanças** — renda recorrente em parcelas com cálculo de dia
  útil real (calendário nacional brasileiro), múltiplos cartões de
  crédito, contas fixas, dívidas pessoais, compras parceladas e
  assinaturas, lançamentos com categoria, visão mensal (entradas vs.
  saídas, comparação com o mês anterior, categorias que mais
  pesaram) e um módulo Wallet dedicado a contas e saldos.
- **Aprendizado** — trilhas de estudo (ex: programação, inglês,
  francês) com marcos/checklist, progresso calculado
  automaticamente, roadmap em timeline com edição inline e
  reordenação por drag-and-drop, e um heatmap de atividade estilo
  GitHub contribution graph.
- **Organização** — hub de acesso rápido: links categorizados com
  favicon público como ícone, projetos do GitHub via API pública, e
  e-mail via IMAP de verdade (múltiplas contas, sincronização sob
  demanda, texto puro sem HTML de terceiros por segurança).
- **Metas Pessoais** — seis tipos de meta (financeira, livre, saúde,
  leitura, hábito e aprendizado), cada uma com peso configurável
  (baixo/médio/alto/épico) que multiplica o XP ganho; metas
  financeiras podem contribuir a partir de uma conta real do Wallet
  (gerando uma transação de saída de verdade) ou como contribuição
  externa; metas do tipo aprendizado ficam vinculadas a uma trilha e
  progridem sozinhas conforme os módulos são concluídos; histórico de
  contribuições com gráfico de progresso.
- **Onboarding** — tour interativo em modais sequenciais na
  primeira execução, com mini-ilustrações estáticas por conceito do
  sistema; pode ser reaberto a qualquer momento pelas configurações.
- **Calendário** — agrega em visão mensal os eventos read-only de
  contas fixas, dívidas, assinaturas, parcelas, metas e ações
  registradas, com filtros por tipo e navegação por mês.
- **Notificações** — sino centralizado no lugar do widget de
  notificações do Núcleo, com sincronização automática de e-mail em
  background e silenciamento de notificações por remetente.

## ► Stack técnica

| Camada | Tecnologia | Por quê |
|---|---|---|
| Backend | Python + FastAPI | API leve, tipada, com Swagger automático |
| Banco de dados | SQLite | Arquivo local, zero servidor externo |
| Frontend | HTML/CSS/JS puro (ES Modules, sem bundler) | Evita o consumo de RAM de React/Vue |
| App desktop | Tauri | WebKitGTK nativo do Linux — muito mais leve que Electron |
| Ícones | Lucide (SVG, self-hosted) + Nerd Fonts | Sem CDN, 100% local |
| Calendário BR | `workalendar` | Feriados e dias úteis reais para os cálculos de Finanças |

## ► Como rodar

### Requisitos

- Python 3.x
- Rust + Cargo com a Tauri CLI (`cargo install tauri-cli --version "^2" --locked`) — só para o modo desktop
- Dependências de sistema do Tauri no Linux (libwebkit2gtk, libgtk-3-dev etc.) — ver [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
- Um navegador moderno — só para o modo web

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Cria automaticamente `backend/kami.db` (SQLite, gitignored) na
primeira execução. Documentação interativa em
`http://127.0.0.1:8000/docs`.

### 2. Frontend

**Desktop (Tauri, recomendado)** — com o backend rodando:

```bash
cd src-tauri
cargo tauri dev
```

**Web (mais rápido para iterar em HTML/CSS/JS)** — o frontend usa ES
Modules, então precisa ser servido, não aberto direto com duplo
clique:

```bash
cd frontend
python3 -m http.server 5500
```

Acesse `http://127.0.0.1:5500`, com o backend em
`http://127.0.0.1:8000`.

### Testes

```bash
cd backend
pytest
```

## ► Empacotar (build de produção)

O Kami roda como um binário instalável (.deb/.rpm no Linux, .exe no
Windows), sem precisar de Python nem de servidor rodando à parte.

```bash
# dependências únicas, uma vez por máquina:
cd backend && source .venv/bin/activate && pip install pyinstaller
cargo install tauri-cli --version "^2" --locked

# na raiz do repositório:
./build.sh
```

Instaladores saem em `src-tauri/target/release/bundle/`. Flags úteis:

```bash
./build.sh --skip-sidecar  # reusa o binário do backend já buildado
./build.sh --clean         # build limpo
./build.sh --dev           # atalho pra cargo tauri dev
./build.sh --help          # detalhes de cada flag
```

**Windows:** sem cross-compile — o build precisa rodar numa máquina
Windows com Python, Rust/Cargo, a Tauri CLI e Git Bash instalados. O
`.exe` (NSIS) sai em `src-tauri/target/release/bundle/nsis/`.

## ► Estrutura do projeto

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
│   │                          # aprendizado, organizacao, metas,
│   │                          # calendario, dashboard, system
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