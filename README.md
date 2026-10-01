<div align="center">

<pre>
██╗  ██╗ █████╗ ███╗   ███╗ ██╗
██║ ██╔╝██╔══██╗████╗ ████║ ██║
█████╔╝ ███████║██╔████╔██║ ██║
██╔═██╗ ██╔══██║██║╚██╔╝██║ ██║
██║  ██╗██║  ██║██║ ╚═╝ ██║ ██║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═╝
</pre>

**Sistema pessoal de organização gamificada — local-first**

`v1.7.3` · `Python` · `FastAPI` · `SQLite` · `HTML/CSS/JS puro` · `Tauri`

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

O app roda na sua máquina e os seus dados ficam num banco SQLite local.
Ele só acessa a internet quando você ativa uma integração (GitHub,
e-mail via IMAP ou busca na web) — sem isso, nada sai do computador.
Nenhum serviço pago é necessário. O visual é uma homenagem a terminais
antigos — paleta preto/branco/cinza com uma única cor de destaque,
configurável.

### O que sai da sua máquina (e quando)

| Destino | Quando | O que é enviado |
|---|---|---|
| `api.github.com` | só se você cadastrar um repositório ou token | nomes de repositórios e o token (cifrado em disco, enviado no header) |
| Seu provedor de e-mail (IMAP) | só se você cadastrar uma conta | usuário e senha de app, por conexão SSL |
| `api.tavily.com` | só se você cadastrar uma chave de busca | suas buscas e a chave |
| `duckduckgo.com` | só ao clicar em "abrir busca" | a busca, aberta no navegador |
| Microsoft (Windows) | só na instalação, se faltar o WebView2 | download do runtime |

O Kami não tem telemetria nem conta de usuário. Senhas de app e tokens
são cifrados com uma chave guardada na mesma pasta de dados do
usuário: isso evita deixar segredos em texto puro no banco, mas **não
substitui um cofre de senhas** nem protege contra outro programa
rodando com o seu usuário.

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
  favicon público como ícone, projetos do GitHub via API pública,
  e-mail via IMAP de verdade (múltiplas contas, sincronização sob
  demanda, texto puro sem HTML de terceiros por segurança), e busca
  web com resumo inline (via Tavily, chave própria do usuário).
- **Carreira** — perfil de carreira (área atual/meta), interesses,
  linha do tempo de posições/experiências, formação acadêmica e
  histórico de registros salariais, com auto-import de repositórios
  do GitHub e widgets dedicados no dashboard.
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
- **Calendário** — agrega em visão mensal os eventos de contas
  fixas, dívidas, assinaturas, parcelas, metas e ações registradas
  (esses, read-only, refletidos de outros módulos), além de eventos
  manuais próprios (criar, editar, mover entre dias e excluir), com
  filtros por tipo e navegação por mês.
- **Notificações** — sino centralizado no lugar do widget de
  notificações do Núcleo, com sincronização automática de e-mail em
  background e silenciamento de notificações por remetente.

## ► Stack técnica

| Camada | Tecnologia | Por quê |
|---|---|---|
| Backend | Python + FastAPI | API leve, tipada, com Swagger automático |
| Banco de dados | SQLite | Arquivo local, zero servidor externo |
| Frontend | HTML/CSS/JS puro (ES Modules, sem bundler) | Sem etapa de build no frontend e menos dependências |
| App desktop | Tauri | WebKitGTK nativo do Linux — muito mais leve que Electron |
| Ícones | Lucide (SVG, self-hosted) + Nerd Fonts | Sem CDN: ícones e fontes vêm junto do app |
| Calendário BR | `workalendar` | Feriados e dias úteis reais para os cálculos de Finanças |

## ► Como rodar

### Requisitos

- Python 3.10 ou superior
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

### Modo demo (dados fictícios)

Para gravar telas ou testar sem tocar nos seus dados reais, aponte o
backend para uma pasta descartável com `KAMI_DATA_DIR` e popule com o
script de exemplo:

```bash
cd backend
KAMI_DATA_DIR=/tmp/kami-demo uvicorn app.main:app --port 8000

# em outro terminal, na raiz do repositório
python3 scripts/seed_demo.py
```

O seed se recusa a rodar em uma instância que já tem dados. No app
desktop, defina a mesma variável antes de abrir
(`KAMI_DATA_DIR=/tmp/kami-demo cargo tauri dev`).

### Testes

```bash
cd backend
pytest
```

Os testes unitários e de integração leve do frontend usam o runner nativo
do Node.js e `jsdom` somente para os testes que precisam de DOM:

```bash
# na raiz do projeto, uma vez
npm install

# executa a suíte do frontend
npm test
```

## ► Instalar

Baixe o instalador para Windows ou Linux na
[página de Releases](https://github.com/emanuel-frs/KAMI/releases/latest)
ou use a [página de download](./docs/index.html). O guia com os passos
por distribuição, verificação de checksums, dados/logs e desinstalação
está em [docs/INSTALACAO.md](./docs/INSTALACAO.md).

**Limitações atuais:** o instalador do Windows **não é assinado**, então
o SmartScreen/Defender pode avisar que o app é desconhecido ou suspeito
(explicação e como conferir o arquivo em
[docs/INSTALACAO.md](./docs/INSTALACAO.md#windows-sem-assinatura)); não há
versão para macOS; não há atualização automática (baixe a nova Release);
interface em português e feriados do Brasil.

## ► Licença

Código **visível, mas não open source**: você pode ler o código, instalar
e usar o Kami para fins pessoais, mas não redistribuí-lo, publicar cópias
como outro produto nem usá-lo comercialmente sem autorização. Veja o
arquivo [LICENSE](./LICENSE). Para relatar um problema de segurança, veja
[SECURITY.md](./SECURITY.md).

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
│   │                          # calendario, carreira, dashboard,
│   │                          # system, widgets
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