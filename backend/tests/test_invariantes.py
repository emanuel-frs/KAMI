"""
Invariantes das regras de negócio (CONF-04, docs/REGRAS-DE-NEGOCIO.md seção INV).

Em vez de um cenário por vez, cada teste aqui roda uma SEQUÊNCIA
ALEATÓRIA (com semente fixa — o mesmo resultado em toda execução) de
ações reais pela API, misturando módulos: registrar ação, lançar entrada e
saída, pagar e desfazer conta fixa, concluir e reabrir marco, contribuir
em meta, quitar e desquitar dívida, salvar e apagar link. Depois de CADA
passo, confere o que nunca pode quebrar, não importa a ordem:

  INV-01  o xp de cada atributo é a soma do xp do log daquele atributo
  INV-02  o nível de cada atributo é o que a curva dá pra aquele xp
  INV-03  o saldo da conta = saldo inicial + entradas − saídas lançadas nela
  INV-04  toda conquista desbloqueada continua cumprindo o critério
  INV-05  fazer e desfazer volta xp e saldo exatamente ao estado de antes

Rodam com missões e bônus LIGADOS (fixtures), que é o caso real e o que
mais mexe no xp por baixo.
"""
import random

import pytest

from app.achievements import achievement_progress
from app.xp import level_from_xp

SEEDS = [1, 7, 42, 2026, 31337]
STEPS = 45
SALDO_INICIAL = 100_000.0
MONTH = "2026-03"


def _attrs(client):
    return {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}


def _saldo(client, conta_id):
    for bank in client.get("/api/carteira/banks").json():
        for acc in bank["accounts"]:
            if acc["id"] == conta_id:
                return acc["saldo_atual"]
    raise AssertionError("conta sumiu")


def _check_invariants(client, db, conta_id, step):
    # INV-01 + INV-02
    rows = db.execute(
        "SELECT a.name, a.current_xp, a.current_level, "
        "COALESCE((SELECT SUM(l.xp_gained) FROM action_log_attributes ala "
        "          JOIN action_logs l ON l.id = ala.action_log_id WHERE ala.attribute_id = a.id), 0) AS soma "
        "FROM attributes a"
    ).fetchall()
    for r in rows:
        assert r["current_xp"] == r["soma"], f"{step}: INV-01 {r['name']} xp={r['current_xp']} log={r['soma']}"
        assert r["current_level"] == level_from_xp(r["current_xp"])["level"], f"{step}: INV-02 {r['name']}"

    # INV-03 (só lançamentos em saldo nesta conta; nada de crédito/transferência aqui)
    mov = db.execute(
        "SELECT COALESCE(SUM(CASE WHEN type = 'entrada' THEN amount ELSE -amount END), 0) AS s "
        "FROM transactions WHERE conta_id = ?",
        (conta_id,),
    ).fetchone()["s"]
    assert round(_saldo(client, conta_id), 2) == round(SALDO_INICIAL + mov, 2), f"{step}: INV-03"

    # INV-04 — inclusive "mês no azul" com lançamento retroativo (P-17)
    import json

    for a in db.execute("SELECT title, criteria_json FROM achievements WHERE unlocked_at IS NOT NULL").fetchall():
        criteria = json.loads(a["criteria_json"])
        current, target = achievement_progress(db, criteria)
        assert current >= target, f"{step}: INV-04 '{a['title']}' desbloqueada com {current}/{target}"


class _World:
    """Estado mínimo pra escolher ações possíveis e desfazê-las."""

    def __init__(self, client, rng):
        self.c = client
        self.rng = rng
        bank = client.post("/api/carteira/banks", json={"nome": "banco"}).json()
        self.conta = client.post(
            f"/api/carteira/banks/{bank['id']}/accounts",
            json={"nome": "corrente", "possui_saldo": True, "saldo_atual": SALDO_INICIAL, "possui_credito": False},
        ).json()
        track = client.post("/api/aprendizado/tracks", json={"name": "trilha"}).json()
        self.marcos = [
            client.post(f"/api/aprendizado/tracks/{track['id']}/milestones", json={"title": f"m{i}"}).json()["id"]
            for i in range(4)
        ]
        self.marcos_ok: set = set()
        client.post(
            "/api/financas/fixed-bills",
            json={"name": "luz", "amount": 80, "due_day": 5, "conta_id": self.conta["id"]},
        )
        self.periodo = client.get("/api/financas/fixed-bills/periods", params={"month": MONTH}).json()[0]["id"]
        self.periodo_pago = False
        self.meta = client.post("/api/metas", json={"title": "meta", "type": "livre", "target_value": 1000}).json()["id"]
        self.dividas = [
            client.post("/api/financas/debts", json={"description": f"d{i}", "amount": 50}).json()["id"]
            for i in range(2)
        ]
        self.dividas_pagas: set = set()
        self.links: list = []
        self.lancamentos: list = []  # ids de lançamentos avulsos (CONF-07: apagar/corrigir)

    # cada ação devolve uma função que a desfaz (ou None se não há desfazer)
    def acao_manual(self):
        cat = self.rng.choice(["financas", "aprendizado", "carreira", "metas", "organizacao"])
        r = self.c.post("/api/nucleo/actions", json={"description": "x", "categories": [cat], "xp": self.rng.randint(1, 50)})
        assert r.status_code == 200, r.text

    def lancamento(self):
        r = self.c.post("/api/financas/transactions", json=self._tx_body())
        assert r.status_code == 200, r.text
        self.lancamentos.append(r.json()["id"])

    def _tx_body(self):
        return {
            "description": "t", "amount": round(self.rng.uniform(1, 500), 2),
            "type": self.rng.choice(["entrada", "saida"]),
            "category": "outros", "date": f"{MONTH}-{self.rng.randint(1, 28):02d}", "conta_id": self.conta["id"],
        }

    def apagar_lancamento(self):
        if not self.lancamentos:
            return self.lancamento()
        tx_id = self.lancamentos.pop(self.rng.randrange(len(self.lancamentos)))
        assert self.c.delete(f"/api/financas/transactions/{tx_id}").status_code == 204

    def corrigir_lancamento(self):
        if not self.lancamentos:
            return self.lancamento()
        i = self.rng.randrange(len(self.lancamentos))
        r = self.c.put(f"/api/financas/transactions/{self.lancamentos[i]}", json=self._tx_body())
        assert r.status_code == 200, r.text
        self.lancamentos[i] = r.json()["id"]

    def conta_fixa(self):
        acao = "unpay" if self.periodo_pago else "pay"
        r = self.c.put(f"/api/financas/fixed-bills/periods/{self.periodo}/{acao}", json={})
        assert r.status_code == 200, r.text
        self.periodo_pago = not self.periodo_pago

    def marco(self):
        mid = self.rng.choice(self.marcos)
        status = "pendente" if mid in self.marcos_ok else "concluido"
        r = self.c.put(f"/api/aprendizado/milestones/{mid}", json={"status": status})
        assert r.status_code == 200, r.text
        (self.marcos_ok.discard if status == "pendente" else self.marcos_ok.add)(mid)

    def contribuicao(self):
        r = self.c.post(f"/api/metas/{self.meta}/contribute", json={"amount": self.rng.randint(1, 50)})
        assert r.status_code in (200, 422), r.text  # 422 = meta já concluída

    def divida(self):
        did = self.rng.choice(self.dividas)
        if did in self.dividas_pagas:
            r = self.c.put(f"/api/financas/debts/{did}/unpay")
            self.dividas_pagas.discard(did)
        else:
            body = {"conta_id": self.conta["id"]} if self.rng.random() < 0.5 else {}
            r = self.c.put(f"/api/financas/debts/{did}/pay", json=body)
            self.dividas_pagas.add(did)
        assert r.status_code == 200, r.text

    def link(self):
        if self.links and self.rng.random() < 0.4:
            r = self.c.delete(f"/api/organizacao/links/{self.links.pop()}")
        else:
            r = self.c.post("/api/organizacao/links", json={"title": "l", "url": f"https://exemplo.com/{self.rng.random()}", "category": "estudo"})
            if r.status_code == 201:
                self.links.append(r.json()["id"])
        assert r.status_code < 300, r.text

    ACOES = ["acao_manual", "lancamento", "apagar_lancamento", "corrigir_lancamento",
             "conta_fixa", "marco", "contribuicao", "divida", "link"]


@pytest.mark.parametrize("seed", SEEDS)
def test_inv_01_a_04_sequencia_aleatoria_nunca_quebra_as_regras(client, db_conn, seed, missoes_ligadas, bonus_ligado):
    rng = random.Random(seed)
    world = _World(client, rng)
    _check_invariants(client, db_conn, world.conta["id"], "início")
    for i in range(STEPS):
        nome = rng.choice(_World.ACOES)
        getattr(world, nome)()
        _check_invariants(client, db_conn, world.conta["id"], f"passo {i} ({nome}, semente {seed})")


def _snapshot(client, conta_id):
    return {n: a["current_xp"] for n, a in _attrs(client).items()}, _saldo(client, conta_id)


@pytest.mark.parametrize("seed", SEEDS)
def test_inv_05_fazer_e_desfazer_volta_ao_estado_anterior(client, db_conn, seed, missoes_ligadas, bonus_ligado):
    """
    Cada par (fazer, desfazer) que o app oferece, sorteado e repetido: no
    fim de cada par, xp de todos os atributos e saldo da conta voltam
    exatamente ao que eram. Com missões e bônus ligados — o estorno tem
    que levar junto o bônus e a missão que a ação tinha rendido.
    """
    rng = random.Random(seed)
    world = _World(client, rng)
    for i in range(12):
        # um pouco de atividade antes, pra não testar só a partir do zero
        world.acao_manual()
        antes = _snapshot(client, world.conta["id"])
        escolha = rng.choice(["conta_fixa", "marco", "divida", "link"])
        if escolha == "conta_fixa":
            world.conta_fixa()
            world.conta_fixa()
        elif escolha == "marco":
            mid = rng.choice(world.marcos)
            ida, volta = ("concluido", "pendente") if mid not in world.marcos_ok else ("pendente", "concluido")
            for status in (ida, volta):
                assert client.put(f"/api/aprendizado/milestones/{mid}", json={"status": status}).status_code == 200
        elif escolha == "divida":
            did = rng.choice(world.dividas)
            body = {"conta_id": world.conta["id"]} if rng.random() < 0.5 else {}
            if did in world.dividas_pagas:
                # já quitada: desquita e quita de novo — o saldo volta, mas a
                # saída é lançada de novo, então compara só depois de "quitar"
                # com a mesma escolha de conta da quitação original não dá pra
                # saber; testa o par a partir de "aberta"
                assert client.put(f"/api/financas/debts/{did}/unpay").status_code == 200
                world.dividas_pagas.discard(did)
                antes = _snapshot(client, world.conta["id"])
            assert client.put(f"/api/financas/debts/{did}/pay", json=body).status_code == 200
            assert client.put(f"/api/financas/debts/{did}/unpay").status_code == 200
        else:
            r = client.post("/api/organizacao/links", json={"title": "l", "url": f"https://exemplo.com/{rng.random()}", "category": "estudo"})
            assert client.delete(f"/api/organizacao/links/{r.json()['id']}").status_code == 204
        assert _snapshot(client, world.conta["id"]) == antes, f"INV-05 par {i} ({escolha}, semente {seed})"
        _check_invariants(client, db_conn, world.conta["id"], f"INV-05 par {i} ({escolha})")
