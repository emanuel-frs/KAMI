# Kami — base do projeto (v1)

Esqueleto inicial do backend, testado e funcionando. A partir daqui
seguimos módulo por módulo (finanças, núcleo, aprendizado, etc.),
sempre entregando um arquivo/conjunto de arquivos por vez.

## O que já existe

```
kami/
├── backend/
│   ├── app/
│   │   ├── main.py            # app FastAPI, monta os routers
│   │   ├── database.py        # conexão sqlite3 + init/seed do schema
│   │   ├── schema.sql         # DDL de todas as 21 tabelas do v1
│   │   ├── widgets.py         # catálogo fixo de widgets (decisão 17)
│   │   ├── xp.py              # fórmula de XP/nível (100 * nível^1.3)
│   │   ├── achievements.py    # seed + engine de conquistas por regra fixa
│   │   ├── actions.py         # lógica compartilhada de "registrar ação"
│   │   ├── business_days.py   # dia útil real via workalendar (decisão 06)
│   │   └── routers/
│   │       ├── perfil.py      # GET/PUT perfil, PUT avatar
│   │       ├── nucleo.py      # atributos, registrar ação, log, conquistas
│   │       └── financas.py    # renda, cartões, contas, dívidas, transações
│   ├── requirements.txt
│   └── .gitignore
└── README.md
```

Frontend ainda não entrou nesta entrega — o próximo passo natural é
pegar o `kami_telas_final.html` (protótipo com dados mockados) e ir
trocando o `state` em memória por chamadas reais pra essa API,
módulo por módulo, começando por Perfil (que já tem backend pronto).

## Decisão tomada nesta etapa: chave primária

Todas as tabelas usam **`id TEXT PRIMARY KEY`** com UUID v4 gerado em
Python (`database.new_id()`), não `INTEGER AUTOINCREMENT`. Isso
resolve o risco técnico que estava registrado em aberto no roadmap
(item 13, seção "risco técnico a considerar antes do v1"): mobile
sync (13.6) e multi-perfil com PIN (13.4) são os itens mais prováveis
do roadmap futuro, e ambos ficam muito mais caros de resolver depois
se as PKs forem inteiros sequenciais. O custo de usar UUID desde já é
baixo (string de 36 caracteres em vez de inteiro).

Se você preferir reverter isso antes de irmos pros outros módulos, é
só avisar — ainda dá tempo, já que só Perfil está implementado.

## Nota: `ModuleNotFoundError: No module named 'app'`

Esse erro acontece se o `uvicorn app.main:app` for rodado de fora da
pasta `backend/` (o pacote `app/` precisa estar ao lado de onde você
executa o comando). Cuidado especial se o navegador salvar downloads
repetidos como `kami_base_v1(1).zip`, `kami_base_v1(2).zip` etc — fica
fácil abrir/rodar de dentro da pasta errada sem perceber. Confirme
com `pwd` que você está em `.../kami/backend` antes de rodar o
`uvicorn`, e considere apagar zips/pastas antigos antes de extrair
um novo, pra não acumular versões duplicadas.

## Nota: por que não usamos `uvicorn[standard]`

O `requirements.txt` pede só `uvicorn` puro, não `uvicorn[standard]`.
O extra `[standard]` traz `uvloop` e `httptools` — duas extensões em
C que só existem pra ganhar performance, e que em distros com Python
muito recente (ex: Fedora 45 com Python 3.15 ainda beta) costumam não
ter wheel pré-compilada disponível ainda. Nesse caso o pip tenta
compilar na hora e falha por falta do header `Python.h`
(pacote `python3-devel`) — e mesmo instalando isso, compilar extensão
nativa contra uma versão beta do Python é terreno instável.

Pra um app pessoal, single-user, essa otimização de performance é
irrelevante. `uvicorn` puro usa `asyncio` + `h11` (implementação em
Python) e funciona igual, sem precisar compilar nada. Se um dia
quiser a versão otimizada — por exemplo depois que o Fedora
estabilizar numa versão de Python com wheels prontas — é só trocar
pra `uvicorn[standard]` no `requirements.txt` e reinstalar.

## Sem ORM, de propósito

`sqlite3` puro da biblioteca padrão, com `row_factory = sqlite3.Row`
(dá pra tratar como dict). Nada de SQLAlchemy — mantém a pegada leve
do projeto (Fedora, 16GB RAM, sem framework pesado nem dependência
grande).

## Módulo Núcleo (implementado nesta etapa)

- `GET /api/nucleo/attributes` — os 5 atributos com nível/% calculados
  em cima do `current_xp` guardado (fórmula: `100 * nível^1.3`, a
  mesma do design). Nível e % nunca são armazenados "confiando" no
  cliente — sempre recalculados no backend a partir do XP.
- `POST /api/nucleo/actions` — registra uma ação (formulário
  genérico, decisão 13): `description`, `categories` (lista de nomes
  de atributo — pode afetar mais de um ao mesmo tempo),
  `xp` (obrigatório, > 0), `impact` (1-5, opcional). Grava em
  `action_logs` + `action_log_attributes`, credita XP nos atributos
  afetados, e roda a checagem de conquistas na mesma chamada — a
  resposta já vem com `newly_unlocked_achievements` se alguma
  disparou.
- `GET /api/nucleo/log?attribute=aprendizado&period_days=7` — log
  cronológico, filtro opcional por atributo e/ou janela de dias.
- `GET /api/nucleo/achievements` — galeria completa (desbloqueadas
  e bloqueadas), pronta pro layout "estilo Steam" do design.

### Conquistas automáticas (regra fixa, decisão do design)

`app/achievements.py` semeia 6 conquistas na primeira execução,
mesmas do protótipo de telas. Duas famílias de critério já são
checadas de verdade:

- `count_by_attribute` — N ações num atributo (ex: 10 em aprendizado).
- `streak_days` — dias seguidos com pelo menos 1 registro.

As outras duas (`goal_completed`, `milestone_completed`) já estão
registradas no banco mas só vão disparar quando os módulos Metas
Pessoais e Aprendizado existirem — ficam "adormecidas" até lá, sem
gerar erro.

Exemplo rápido pra testar:

```bash
curl -X POST http://127.0.0.1:8000/api/nucleo/actions \
  -H "Content-Type: application/json" \
  -d '{"description":"terminei capítulo 5 de rust","categories":["aprendizado"],"xp":15,"impact":4}'

curl http://127.0.0.1:8000/api/nucleo/attributes
curl http://127.0.0.1:8000/api/nucleo/log
curl http://127.0.0.1:8000/api/nucleo/achievements
```

## Módulo Finanças (implementado nesta etapa)

Nova dependência: `workalendar` (calendário nacional BR, decisão 06,
100% offline — os feriados vêm embutidos na lib, sem chamar API
nenhuma).

- **Renda recorrente** — `GET /api/financas/income-entries?month=YYYY-MM`
  garante (gera se não existir) e devolve as entradas de parte 1 e
  parte 2 do mês pedido. Parte 1 = 5º dia útil real do mês; parte 2 =
  15 dias úteis reais depois da parte 1 (usando a data paga, se já
  confirmada, senão a data prevista). `PUT .../confirm` marca como
  paga e **recalcula automaticamente** a previsão da parte 2; `PUT
  .../revert` desfaz. Testei com o calendário de julho/2026: 5º dia
  útil cai em 07/07 (terça), e confirmando a parte 1 em 08/07, a
  parte 2 recalcula pra 29/07 — bate certinho com a regra do design.
- **Cadastros simples** — CRUD básico pra `credit-cards`,
  `fixed-bills`, `debts` (com `PUT` pra mudar status) e
  `subscriptions`.
- **Transações** — `GET/POST /api/financas/transactions?month=YYYY-MM`.
  Cada transação criada credita **+2xp em finanças automaticamente**
  (via `app/actions.py`, o mesmo motor de registro de ação do
  Núcleo) — replica o comportamento que já existia no protótipo de
  telas, só que de verdade no backend agora.
- **Resumo mensal** — `GET /api/financas/summary?month=YYYY-MM`:
  entradas, saídas, saldo, comparação percentual com o mês anterior,
  e categorias que mais pesaram (tudo calculado via query agregada
  em cima de `transactions`, sem tabela nova — como o design previa).

### Refatoração no Núcleo

Extraí a lógica de "registrar ação" (antes só dentro do router do
Núcleo) pra `app/actions.py`, porque Finanças também precisa dela
pra creditar XP automaticamente. `POST /api/nucleo/actions` continua
funcionando exatamente igual — só chama essa função compartilhada
por baixo agora, sem duplicar código.

Exemplo rápido pra testar:

```bash
curl "http://127.0.0.1:8000/api/financas/income-entries?month=2026-07"

curl -X PUT http://127.0.0.1:8000/api/financas/income-entries/{id}/confirm \
  -H "Content-Type: application/json" \
  -d '{"paid_date": "2026-07-08"}'

curl -X POST http://127.0.0.1:8000/api/financas/transactions \
  -H "Content-Type: application/json" \
  -d '{"description":"mercado","amount":390,"type":"saida","category":"mercado","date":"2026-07-10"}'

curl "http://127.0.0.1:8000/api/financas/summary?month=2026-07"
```

## Tabelas do Assistente Kami (`conversations`/`messages`)

Ficaram de fora do `schema.sql` de propósito: são pós-mvp (decisão
14) e não bloqueiam nada do v1. Entram como módulo próprio quando
chegar a vez do Assistente.

## Como rodar

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # no Fedora: mesma coisa
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000
```

Isso cria automaticamente `backend/kami.db` (SQLite, gitignored) na
primeira execução, já com o schema completo e os 5 atributos
semeados (carreira, finanças, aprendizado, organização, metas —
decisão 13, todos `is_active=1` desde o v1).

Testar rapidamente:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/perfil
curl -X PUT http://127.0.0.1:8000/api/perfil \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Emanuel", "accent_color": "#b3a06a"}'
```

A documentação interativa (Swagger) fica em
`http://127.0.0.1:8000/docs` — útil pra testar os próximos endpoints
conforme forem entrando, sem precisar montar frontend pra cada um.

## Validado antes desta entrega

Rodei de ponta a ponta com `TestClient` do FastAPI: inicialização do
banco, criação das 21 tabelas, seed dos atributos, e o ciclo completo
`GET /api/perfil` → `PUT /api/perfil` → `PUT /api/perfil/avatar` →
`GET /api/perfil` confirmando persistência. Sem surpresas.

## Próximos passos sugeridos (nesta ordem)

1. ~~**Núcleo**~~ — feito.
2. ~~**Finanças**~~ — feito nesta etapa.
3. **Aprendizado** — trilhas + marcos, com o cálculo de % e o
   heatmap (query agregada em `action_logs`, sem tabela nova) —
   ao concluir um marco, credita XP em aprendizado chamando
   `app/actions.py` (mesmo padrão que Finanças acabou de usar).
4. **Organização** — links (CRUD simples), GitHub (proxy pra API
   pública), e-mail (IMAP real — essa é a parte mais delicada,
   merece atenção própria).
5. **Metas Pessoais** — `goals` + `goal_contributions` — ao concluir
   uma meta, credita XP bônus e finalmente destrava a conquista
   "quest concluída" que já está semeada esperando por isso.
6. **Dashboard de widgets** — `dashboard_widgets`, ligando com o
   catálogo fixo de `widgets.py`.
7. Frontend: ir substituindo o `state` mockado do
   `kami_telas_final.html` por chamadas reais à API, módulo por
   módulo, começando por Perfil, Núcleo e Finanças, que já têm
   backend pronto.

Me diga por qual desses quer seguir (ou se prefere outra ordem) e eu
já mando o próximo arquivo.
