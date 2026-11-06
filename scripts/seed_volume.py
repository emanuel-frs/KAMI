#!/usr/bin/env python3
"""
EST-04: base grande, como ~5 anos de uso, pra medir o Kami com volume
(P-182). Dados 100% fictícios. Roda DEPOIS do scripts/seed_demo.py, na
mesma pasta de dados, com o backend PARADO — escreve direto no SQLite
(pela API levaria horas):

    KAMI_DATA_DIR=<pasta> backend/.venv/bin/python scripts/seed_volume.py [--anos 5]

Gera por ano ~4 mil lançamentos (com o registro de xp de cada um), 60
notas com tags, 400 eventos, as marcas dos hábitos e aportes nas metas.
Saldo de conta não fecha com os lançamentos — é volume, não contabilidade.
"""
import argparse
import datetime
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import database  # noqa: E402

GASTOS = [("Mercado", "Mercado da semana", 80, 420), ("Transporte", "Transporte por app", 12, 60),
          ("Restaurantes", "Almoço", 25, 120), ("Lazer", "Cinema", 30, 90), ("Saúde", "Farmácia", 15, 200),
          ("Educação", "Curso online", 40, 300), ("Moradia", "Material de casa", 20, 250), ("Assinaturas", "Aplicativo", 10, 40)]
ENTRADAS = [("Freelance", "Projeto freelance", 300, 2500), ("Outros", "Venda de usado", 50, 600)]
PALAVRAS = ("planejamento estudo viagem ideia reunião receita livro projeto treino orçamento lista compras "
            "rotina leitura revisão anotação filme série música casa trabalho").split()


def _texto(r: random.Random, n: int) -> str:
    return " ".join(r.choice(PALAVRAS) for _ in range(n)).capitalize() + "."


def gerar(conn, anos: int, semente: int = 7) -> dict:
    r = random.Random(semente)
    hoje = datetime.date.today()
    inicio = hoje - datetime.timedelta(days=365 * anos)
    dias = [inicio + datetime.timedelta(days=i) for i in range((hoje - inicio).days)]
    contas = [row["id"] for row in conn.execute("SELECT id FROM wallet_accounts WHERE possui_saldo = 1")]
    attr = {row["name"]: row["id"] for row in conn.execute("SELECT id, name FROM attributes")}
    novo, agora = database.new_id, database.now_iso()
    contagem = {}

    tx, logs, log_attr = [], [], []
    for dia in dias:
        for _ in range(r.randint(8, 14)):
            entrada = r.random() < 0.06
            cat, desc, lo, hi = r.choice(ENTRADAS if entrada else GASTOS)
            tid, lid = novo(), novo()
            tipo = "entrada" if entrada else "saida"
            tx.append((tid, desc, round(r.uniform(lo, hi), 2), tipo, cat, r.choice(contas), "debito", dia.isoformat()))
            quando = f"{dia.isoformat()}T{r.randint(7, 22):02d}:{r.randint(0, 59):02d}:00-03:00"
            logs.append((lid, f"lançou {tipo}: {desc}", 2, quando, "transacao", tid,
                         f"log.lancamento.{tipo}", json.dumps({"descricao": desc})))
            log_attr.append((lid, attr["financas"]))
    conn.executemany("INSERT INTO transactions (id, description, amount, type, category, conta_id, forma_pagamento, date) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", tx)
    conn.executemany("INSERT INTO action_logs (id, description, xp_gained, source, created_at, referencia_tipo, referencia_id, "
                     "descricao_chave, descricao_vars) VALUES (?, ?, ?, 'financas', ?, ?, ?, ?, ?)", logs)
    conn.executemany("INSERT INTO action_log_attributes (action_log_id, attribute_id) VALUES (?, ?)", log_attr)
    contagem["lancamentos"] = len(tx)

    notas, tags = [], []
    for _ in range(60 * anos):
        nid = novo()
        criada = r.choice(dias).isoformat() + "T12:00:00-03:00"
        notas.append((nid, _texto(r, r.randint(2, 6)), "\n\n".join(_texto(r, r.randint(20, 80)) for _ in range(r.randint(1, 5))),
                      criada, criada))
        for tag in r.sample(PALAVRAS[:8], r.randint(0, 3)):
            tags.append((nid, tag))
    conn.executemany("INSERT INTO notas (id, titulo, conteudo, criada_em, atualizada_em) VALUES (?, ?, ?, ?, ?)", notas)
    conn.executemany("INSERT INTO notas_tags (nota_id, tag) VALUES (?, ?)", tags)
    contagem["notas"] = len(notas)

    eventos = [(novo(), _texto(r, 3), r.choice(dias).isoformat(), f"{r.randint(8, 20):02d}:00", agora, agora)
               for _ in range(400 * anos)]
    conn.executemany("INSERT INTO calendar_events (id, title, date, time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", eventos)
    contagem["eventos"] = len(eventos)

    habitos = []
    for i, nome in enumerate(("ler 20 páginas", "correr", "meditar", "inglês", "beber água")):
        hid = novo()
        habitos.append(hid)
        conn.execute("INSERT INTO habitos (id, nome, frequencia, atributo, posicao, criado_em, atualizado_em) "
                     "VALUES (?, ?, 'diario', 'organizacao', ?, ?, ?)", (hid, nome, 100 + i, inicio.isoformat(), agora))
    marcas = [(novo(), h, d.isoformat(), agora) for h in habitos for d in dias if r.random() < 0.7]
    conn.executemany("INSERT INTO habitos_marcas (id, habito_id, dia, criada_em) VALUES (?, ?, ?, ?)", marcas)
    contagem["marcas_de_habito"] = len(marcas)

    metas = [row["id"] for row in conn.execute("SELECT id FROM goals")]
    aportes = [(novo(), r.choice(metas), round(r.uniform(20, 300), 2), r.choice(dias).isoformat())
               for _ in range(40 * anos)] if metas else []
    conn.executemany("INSERT INTO goal_contributions (id, goal_id, amount, date) VALUES (?, ?, ?, ?)", aportes)
    contagem["aportes"] = len(aportes)
    conn.commit()
    return contagem


def main() -> int:
    p = argparse.ArgumentParser(description="Base grande de dados fictícios (EST-04)")
    p.add_argument("--anos", type=int, default=5)
    args = p.parse_args()
    conn = database.get_connection()
    try:
        if not conn.execute("SELECT 1 FROM wallet_accounts LIMIT 1").fetchone():
            print("rode o scripts/seed_demo.py antes (precisa das contas e metas do demo)")
            return 1
        print(json.dumps(gerar(conn, args.anos), ensure_ascii=False))
    finally:
        conn.close()
    print(f"banco: {database.DB_PATH} ({database.DB_PATH.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
