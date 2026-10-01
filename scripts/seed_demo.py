#!/usr/bin/env python3
"""
Popula uma instância NOVA do Kami com dados 100% fictícios, para gravar
screenshots/GIF/vídeo sem expor dados pessoais ("modo demo").

Como usar (dados reais nunca são tocados, porque a pasta é outra):

    # 1) backend apontando pra uma pasta de dados descartável
    cd backend
    KAMI_DATA_DIR=/tmp/kami-demo uvicorn app.main:app --port 8000

    # 2) em outro terminal, na raiz do repositório
    python3 scripts/seed_demo.py

    # 3) abrir o app apontando pra mesma pasta (Tauri lê KAMI_DATA_DIR)
    KAMI_DATA_DIR=/tmp/kami-demo KAMI_DEV_NO_SIDECAR=1 cargo tauri dev
    #    ou o frontend web: cd frontend && python3 -m http.server 5500

No Windows (PowerShell): `$env:KAMI_DATA_DIR="$env:TEMP\\kami-demo"` antes
de iniciar o backend/app.

Por que via API e não escrevendo no SQLite: assim os dados passam pelas
mesmas validações e regras (XP, conquistas, dias úteis) que o app usa de
verdade, e o seed continua válido quando o schema mudar.

Limitações conhecidas (de propósito):
  - e-mail (IMAP) e GitHub ficam vazios: exigem credenciais e rede;
  - o log de atividades nasce com a data de hoje (a API não permite
    retroagir), então o heatmap/streak aparecem "novos".

Segurança: o script se recusa a rodar se a instância já tiver dados, pra
você não misturar dados fictícios com os seus por engano. Só depende da
biblioteca `httpx`, que já está em backend/requirements.txt.
"""
import argparse
import datetime as dt
import sys

try:
    import httpx
except ImportError:  # pragma: no cover - mensagem amigável
    sys.exit("erro: instale o httpx (pip install httpx) — já vem em backend/requirements.txt")

TIPS_SCREENS = [
    "nucleo", "perfil", "financas", "carteira", "aprendizado",
    "metas", "organizacao", "calendario", "carreira",
]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Popula o Kami com dados fictícios (modo demo).")
    p.add_argument("--base-url", default="http://127.0.0.1:8000", help="URL do backend (padrão: %(default)s)")
    p.add_argument("--token", default="", help="token de sessão, se o backend exigir (arquivo backend_token.txt)")
    p.add_argument(
        "--mostrar-onboarding",
        action="store_true",
        help="não marca o tour e as dicas como vistos (útil pra gravar o primeiro uso)",
    )
    p.add_argument("--force", action="store_true", help="roda mesmo se a instância já tiver dados (não recomendado)")
    return p


class Seeder:
    def __init__(self, client: httpx.Client, hoje: dt.date):
        self.c = client
        self.hoje = hoje

    # ---------- helpers ----------
    def _check(self, resp: httpx.Response, method: str, path: str):
        if resp.status_code >= 300:
            raise SystemExit(f"falhou: {method} {path} -> {resp.status_code} {resp.text[:300]}")
        return resp.json() if resp.content else None

    def post(self, path, body=None):
        return self._check(self.c.post(path, json=body or {}), "POST", path)

    def put(self, path, body=None):
        return self._check(self.c.put(path, json=body or {}), "PUT", path)

    def get(self, path):
        return self._check(self.c.get(path), "GET", path)

    def dia(self, delta: int) -> str:
        return (self.hoje + dt.timedelta(days=delta)).isoformat()

    def mes(self, delta: int) -> str:
        total = self.hoje.year * 12 + (self.hoje.month - 1) + delta
        return f"{total // 12}-{total % 12 + 1:02d}"

    # ---------- guarda ----------
    def instancia_vazia(self) -> bool:
        return not any(
            self.get(caminho)
            for caminho in (
                "/api/carteira/banks",
                "/api/organizacao/links",
                "/api/metas",
                "/api/aprendizado/tracks",
            )
        )

    # ---------- blocos ----------
    def perfil(self):
        self.put("/api/perfil", {"display_name": "Demo"})

    def carteira(self):
        banco = self.post("/api/carteira/banks", {"nome": "Banco Exemplo"})
        corrente = self.post(
            f"/api/carteira/banks/{banco['id']}/accounts",
            {"nome": "Conta corrente", "possui_saldo": True, "saldo_atual": 3250.40, "possui_credito": False},
        )
        cartao = self.post(
            f"/api/carteira/banks/{banco['id']}/accounts",
            {
                "nome": "Cartão Demo", "possui_saldo": False, "possui_credito": True,
                "fatura_atual": 842.15, "limite_total": 6000, "dia_vencimento": 12,
            },
        )
        reserva = self.post(
            f"/api/carteira/banks/{banco['id']}/accounts",
            {"nome": "Reserva", "possui_saldo": True, "saldo_atual": 4800, "possui_credito": False},
        )
        self.post(
            "/api/carteira/compras-parceladas",
            {
                "nome": "Notebook", "valor_total": 3600, "num_parcelas": 12,
                "conta_id": cartao["id"], "mes_primeira_parcela": self.mes(-2),
            },
        )
        for nome, valor, dia in [
            ("Streaming de vídeo", 39.90, 8),
            ("Streaming de música", 21.90, 12),
            ("Armazenamento na nuvem", 9.90, 25),
        ]:
            self.post(
                "/api/carteira/subscriptions",
                {"nome": nome, "valor_esperado": valor, "dia_cobranca": dia, "conta_id": cartao["id"], "categoria": "Assinaturas"},
            )
        return corrente["id"], cartao["id"], reserva["id"]

    def financas(self, corrente_id, cartao_id):
        self.post(
            "/api/financas/income-sources",
            {
                "nome": "Salário", "valor": 4800, "conta_id": corrente_id, "categoria": "Salário",
                "frequencia": "mensal", "tipo_data": "dia_util", "nth_dia_util": 5, "active": True,
            },
        )
        for nome, valor, dia in [("Aluguel", 1200, 10), ("Internet", 99.90, 15), ("Energia", 180, 20)]:
            self.post(
                "/api/financas/fixed-bills",
                {"name": nome, "amount": valor, "due_day": dia, "active": True, "conta_id": corrente_id, "categoria": "Moradia"},
            )
        self.post(
            "/api/financas/debts",
            {"description": "Empréstimo de um amigo", "counterparty": "Fulano", "amount": 300, "due_date": self.dia(20)},
        )
        lancamentos = [
            (-1, "Mercado da semana", 236.80, "saida", "Mercado", corrente_id),
            (-2, "Transporte por app", 27.50, "saida", "Transporte", corrente_id),
            (-3, "Almoço com colegas", 64.00, "saida", "Restaurantes", corrente_id),
            (-5, "Projeto freelance", 900.00, "entrada", "Freelance", corrente_id),
            (-6, "Farmácia", 58.30, "saida", "Saúde", corrente_id),
            (-8, "Cinema", 48.00, "saida", "Lazer", cartao_id),
            (-10, "Livro técnico", 129.90, "saida", "Educação", cartao_id),
            (-12, "Mercado da semana", 198.45, "saida", "Mercado", corrente_id),
            (-15, "Combustível", 150.00, "saida", "Transporte", corrente_id),
            (-18, "Jantar fora", 92.00, "saida", "Restaurantes", cartao_id),
            (-22, "Curso online", 79.00, "saida", "Educação", cartao_id),
            (-26, "Mercado da semana", 221.10, "saida", "Mercado", corrente_id),
            (-33, "Projeto freelance", 650.00, "entrada", "Freelance", corrente_id),
            (-40, "Presente de aniversário", 110.00, "saida", "Lazer", cartao_id),
        ]
        for delta, desc, valor, tipo, cat, conta in lancamentos:
            self.post(
                "/api/financas/transactions",
                {"description": desc, "amount": valor, "type": tipo, "category": cat, "date": self.dia(delta), "conta_id": conta},
            )

    def aprendizado(self):
        trilhas = [
            ("Java e Spring Boot", "Construir uma API REST completa com testes", "ativa", [
                "Fundamentos da linguagem", "Orientação a objetos", "Coleções e streams",
                "Spring Boot: primeira API", "Persistência com JPA", "Testes automatizados",
            ], 4),
            ("SQL", "Consultas e modelagem com confiança", "ativa", [
                "SELECT e filtros", "JOINs", "Agregações", "Modelagem relacional",
            ], 2),
            ("Inglês", "Conversar sobre trabalho sem travar", "pausada", [
                "Vocabulário técnico", "Leitura de documentação", "Conversação básica",
            ], 1),
        ]
        ids = {}
        for nome, meta, status, marcos, concluidos in trilhas:
            trilha = self.post("/api/aprendizado/tracks", {"name": nome, "general_goal": meta, "status": status})
            ids[nome] = trilha["id"]
            criados = [
                self.post(f"/api/aprendizado/tracks/{trilha['id']}/milestones", {"title": t})
                for t in marcos
            ]
            for marco in criados[:concluidos]:
                self.put(f"/api/aprendizado/milestones/{marco['id']}", {"status": "concluido"})
        return ids

    def metas(self, reserva_id, trilha_java_id):
        reserva = self.post(
            "/api/metas",
            {
                "title": "Reserva de emergência", "type": "financeira", "target_value": 10000,
                "deadline": self.dia(240), "weight": "alto", "linked_conta_id": reserva_id,
            },
        )
        self.post(f"/api/metas/{reserva['id']}/contribute", {"amount": 4800, "origem": "externo", "note": "saldo inicial"})

        leitura = self.post(
            "/api/metas",
            {"title": "Ler 12 livros no ano", "type": "leitura", "target_value": 12, "unit_label": "livros", "weight": "medio"},
        )
        self.post(f"/api/metas/{leitura['id']}/contribute", {"amount": 5})

        habito = self.post(
            "/api/metas",
            {"title": "Treinar 100 dias", "type": "habito", "target_value": 100, "unit_label": "dias", "weight": "medio"},
        )
        self.post(f"/api/metas/{habito['id']}/contribute", {"amount": 37})

        self.post(
            "/api/metas",
            {
                "title": "Concluir a trilha de Java", "type": "aprendizado", "target_value": 6,
                "weight": "epico", "linked_track_id": trilha_java_id,
            },
        )

    def organizacao(self):
        links = [
            ("Documentação do Python", "https://docs.python.org/3/", "estudo"),
            ("MDN Web Docs", "https://developer.mozilla.org/", "estudo"),
            ("Documentação do Spring", "https://docs.spring.io/", "estudo"),
            ("SQLite", "https://www.sqlite.org/docs.html", "estudo"),
            ("Tauri", "https://tauri.app/", "ferramentas"),
            ("FastAPI", "https://fastapi.tiangolo.com/", "ferramentas"),
            ("Exemplo de portfólio", "https://example.com/", "pessoal"),
        ]
        for titulo, url, categoria in links:
            self.post("/api/organizacao/links", {"title": titulo, "url": url, "category": categoria})

    def calendario(self):
        eventos = [
            (2, "Estudar Spring Boot", "20:00", "weekly"),
            (4, "Consulta de rotina", "09:30", "none"),
            (7, "Revisar finanças do mês", "19:00", "monthly"),
            (12, "Encontro do grupo de estudos", "18:30", "none"),
        ]
        for delta, titulo, hora, recorrencia in eventos:
            self.post(
                "/api/calendario/events/evento",
                {"title": titulo, "date": self.dia(delta), "time": hora, "recurrence": recorrencia},
            )

    def carreira(self):
        self.put("/api/carreira/perfil", {"area_atual": "Desenvolvimento de software", "area_meta": "Engenharia de backend"})
        for tag in ["Java", "SQL", "Sistemas distribuídos", "Trabalho remoto"]:
            self.post("/api/carreira/interesses", {"tag": tag})
        posicao = self.post(
            "/api/carreira/posicoes",
            {
                "company": "Empresa Exemplo", "role": "Desenvolvedor Júnior", "area": "Backend",
                "employment_type": "CLT", "start_date": self.dia(-540),
            },
        )
        self.post(
            "/api/carreira/salarios",
            {"amount": 3800, "currency": "BRL", "date": self.dia(-540), "reason": "admissão", "position_id": posicao["id"]},
        )
        self.post(
            "/api/carreira/salarios",
            {"amount": 4800, "currency": "BRL", "date": self.dia(-150), "reason": "reajuste", "position_id": posicao["id"]},
        )
        self.post(
            "/api/carreira/formacoes",
            {
                "curso": "Análise e Desenvolvimento de Sistemas", "instituicao": "Faculdade Exemplo",
                "nivel": "graduacao", "status": "em_andamento", "previsao_conclusao": self.dia(400),
            },
        )

    def atividade(self):
        acoes = [
            ("Terminei o módulo de JOINs", ["aprendizado"], 30),
            ("Revisei o orçamento do mês", ["financas"], 20),
            ("Atualizei o currículo", ["carreira"], 25),
            ("Organizei a caixa de entrada", ["organizacao"], 15),
            ("Registrei o treino de hoje", ["metas"], 20),
        ]
        for descricao, categorias, xp in acoes:
            self.post("/api/nucleo/actions", {"description": descricao, "categories": categorias, "xp": xp})

    def onboarding(self, mostrar: bool):
        if mostrar:
            return
        self.put("/api/perfil/onboarding", {"completed": True})
        for tela in TIPS_SCREENS:
            self.put(f"/api/perfil/tips/{tela}")


def main() -> None:
    args = build_parser().parse_args()
    headers = {"X-Kami-Token": args.token} if args.token else {}
    with httpx.Client(base_url=args.base_url, headers=headers, timeout=30) as client:
        try:
            client.get("/health").raise_for_status()
        except httpx.HTTPError as err:
            sys.exit(f"não consegui falar com o backend em {args.base_url}: {err}")

        seeder = Seeder(client, dt.date.today())
        if not args.force and not seeder.instancia_vazia():
            sys.exit(
                "esta instância já tem dados. Rode o backend com KAMI_DATA_DIR apontando pra uma pasta nova "
                "(nunca use o seed nos seus dados reais). Use --force só se souber o que está fazendo."
            )

        seeder.perfil()
        corrente, cartao, reserva = seeder.carteira()
        seeder.financas(corrente, cartao)
        trilhas = seeder.aprendizado()
        seeder.metas(reserva, trilhas["Java e Spring Boot"])
        seeder.organizacao()
        seeder.calendario()
        seeder.carreira()
        seeder.atividade()
        seeder.onboarding(args.mostrar_onboarding)
    print("Pronto: dados fictícios criados.")


if __name__ == "__main__":
    main()
