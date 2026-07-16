# Kami — como rodar

Guia rápido de setup e execução local. Para decisões de arquitetura e
histórico de módulos, ver PROJECT_MASTER.md (este arquivo é só "como
rodar").

## Requisitos

- Python 3.x (backend)
- Rust + Cargo / Tauri, se for rodar o frontend como app desktop (ver
  seção Frontend)

## 1. Backend

### Setup (primeira vez)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Rodar

```bash
uvicorn app.main:app --reload --port 8000
```

Isso cria automaticamente `backend/kami.db` (SQLite, gitignored) na
primeira execução, já com o schema completo e os 5 atributos
semeados (carreira, finanças, aprendizado, organização, metas).

### Conferir se está no ar

```bash
curl http://127.0.0.1:8000/health
```

Documentação interativa (Swagger) em `http://127.0.0.1:8000/docs` —
dá pra testar qualquer endpoint por ali, sem precisar do frontend.

## 2. Frontend

Fica em `frontend/` — HTML/CSS/JS puro, sem build step nem bundler,
rodando dentro de um wrapper Tauri.

- `index.html` carrega `css/tokens.css`, `css/base.css` e os 11
  arquivos de `css/widgets/*.css` diretamente por `<link>` (não usa
  `@import` — já vimos na prática que quebra em runtime `file://`
  do Tauri/WebKitGTK).
- **Atenção:** confirme que a pasta `frontend/css/widgets/` existe de
  verdade com os 11 arquivos dentro. Se ela não existir (ex: só
  substituiu o `index.html` sem criar a pasta), os widgets ficam sem
  estilo nenhum — cards, botões e campos aparecem como texto cru,
  mesmo com `tokens.css`/`base.css` funcionando normalmente.
- Precisa do **backend rodando em `http://127.0.0.1:8000` primeiro**
  — o frontend consome a API por lá.

Rodar via Tauri (dev):

```bash
cargo tauri dev
```

(ajuste o comando conforme o `tauri.conf.json` do projeto, caso a
porta ou o alvo de build configurados sejam diferentes)

## Troubleshooting

**`ModuleNotFoundError: No module named 'app'`**
O `uvicorn app.main:app` precisa ser rodado de dentro da pasta
`backend/` (o pacote `app/` tem que estar ao lado de onde você
executa o comando). Confirme com `pwd` antes de rodar. Cuidado com
downloads duplicados tipo `kami_base_v1(1).zip`, `kami_base_v1(2).zip`
— é fácil rodar da pasta errada sem perceber.

**Widgets sem estilo no frontend**
Ver nota acima em "Frontend" — na prática, quase sempre é a pasta
`css/widgets/` faltando ou incompleta.

**Por que `requirements.txt` pede `uvicorn` puro, não
`uvicorn[standard]`**
O extra `[standard]` traz `uvloop`/`httptools` (extensões em C) que
em versões muito recentes de Python (ex: beta do Fedora) podem não
ter wheel pronta e falhar ao compilar por falta do header
`Python.h` (`python3-devel`). Pra um app pessoal single-user essa
otimização de performance não faz diferença perceptível — `uvicorn`
puro funciona igual, sem precisar compilar nada.

## Estrutura (visão geral)

```
kami/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── schema.sql
│   │   └── routers/          # perfil, nucleo, financas, aprendizado, organizacao...
│   ├── requirements.txt
│   └── .gitignore
└── frontend/
    ├── index.html
    ├── css/
    │   ├── tokens.css
    │   ├── base.css
    │   └── widgets/          # grid, card-base, forms, widget-*, tooltip...
    └── js/
        ├── api/
        ├── pages/
        ├── state/
        └── widgets/
```