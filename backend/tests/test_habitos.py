"""Hábitos (ORG-04) — regras em app/habitos.py, rotas em app/routers/habitos.py."""
import datetime

from app import missoes
from app.habitos import Habito

BASE = "/api/habitos"
HOJE = datetime.date.today()


def _d(n):
    """n dias atrás, em ISO."""
    return (HOJE - datetime.timedelta(days=n)).isoformat()


def _h(frequencia="diario", criado=None, marcas=(), pausas=(), dias="", vezes=3):
    row = {
        "frequencia": frequencia, "dias_semana": dias, "vezes_semana": vezes,
        "criado_em": criado or "2026-01-05T08:00:00",
    }
    return Habito(row, marcas, pausas)


def _xp(client, atributo):
    return next(a["current_xp"] for a in client.get("/api/nucleo/attributes").json() if a["name"] == atributo)


# ---------------- regras ----------------

def test_daily_streak_counts_back_and_today_unmarked_does_not_break():
    seg = datetime.date(2026, 10, 19)  # segunda
    h = _h(marcas=["2026-10-16", "2026-10-17", "2026-10-18"], criado="2026-10-10")
    assert h.sequencias(seg) == {"sequencia": 3, "recorde": 3}
    h = _h(marcas=["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"], criado="2026-10-10")
    assert h.sequencias(seg)["sequencia"] == 4
    # buraco ontem quebra
    h = _h(marcas=["2026-10-15", "2026-10-16", "2026-10-17"], criado="2026-10-10")
    assert h.sequencias(seg) == {"sequencia": 0, "recorde": 3}


def test_fixed_days_skip_the_days_off():
    # seg, qua, sex (0, 2, 4)
    h = _h("dias", dias="0,2,4", criado="2026-10-05", marcas=["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19"])
    assert h.sequencias(datetime.date(2026, 10, 20))["sequencia"] == 4
    assert not h.vale(datetime.date(2026, 10, 20))  # terça
    assert h.vale(datetime.date(2026, 10, 21))


def test_paused_days_neither_count_nor_break():
    h = _h(criado="2026-10-01", marcas=["2026-10-08", "2026-10-09", "2026-10-15"],
           pausas=[("2026-10-10", "2026-10-14")])
    assert h.sequencias(datetime.date(2026, 10, 15))["sequencia"] == 3
    estados = h.grade(datetime.date(2026, 10, 15))
    inicio = datetime.date.fromisoformat(estados["inicio"])
    assert estados["estados"][(datetime.date(2026, 10, 12) - inicio).days] == "fora"


def test_weekly_streak_is_in_weeks():
    # 3x por semana; semanas de 05/10 e 12/10 cumpridas, a atual (19/10) não quebra
    marcas = ["2026-10-06", "2026-10-07", "2026-10-09", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-19"]
    h = _h("semana", vezes=3, criado="2026-09-28", marcas=marcas)
    assert h.sequencias(datetime.date(2026, 10, 21)) == {"sequencia": 2, "recorde": 2}
    assert h.feitas_na_semana(datetime.date(2026, 10, 21)) == 1
    # semana passada só com 2: quebra
    h = _h("semana", vezes=3, criado="2026-09-28", marcas=marcas[:3] + marcas[3:5])
    assert h.sequencias(datetime.date(2026, 10, 21)) == {"sequencia": 0, "recorde": 1}
    assert h.grade(datetime.date(2026, 10, 21))["estados"].count("livre") > 0


def test_thirty_days_ignores_today_while_pending():
    h = _h(criado=_d(3), marcas=[_d(3), _d(2), _d(1)])
    assert h.aproveitamento_30d(HOJE) == 100
    h = _h(criado=_d(3), marcas=[_d(3), _d(1)])
    assert h.aproveitamento_30d(HOJE) == 67


def test_grid_has_twelve_weeks_from_monday():
    g = _h(criado=_d(100)).grade(HOJE)
    assert len(g["estados"]) == 84
    assert datetime.date.fromisoformat(g["inicio"]).weekday() == 0
    assert g["estados"][(HOJE - datetime.date.fromisoformat(g["inicio"])).days] == "hoje"


# ---------------- rotas ----------------

def test_create_list_edit_and_validation(client):
    h = client.post(BASE, json={"nome": " ler 20 páginas ", "frequencia": "dias", "dias_semana": [4, 0, 2], "atributo": "aprendizado"}).json()
    assert h["nome"] == "ler 20 páginas" and h["dias_semana"] == [0, 2, 4]
    assert h["vale_hoje"] == (HOJE.weekday() in (0, 2, 4))
    assert client.post(BASE, json={"nome": "x", "frequencia": "dias", "dias_semana": []}).status_code == 422
    assert client.post(BASE, json={"nome": "x", "atributo": "nada"}).status_code == 422
    assert client.post(BASE, json={"nome": "x", "frequencia": "mensal"}).status_code == 422
    e = client.put(f"{BASE}/{h['id']}", json={"frequencia": "semana", "vezes_semana": 2}).json()
    assert e["frequencia"] == "semana" and e["vezes_semana"] == 2
    assert client.put(f"{BASE}/{h['id']}", json={"frequencia": "dias", "dias_semana": []}).status_code == 422
    assert [x["id"] for x in client.get(BASE).json()] == [h["id"]]


def test_marking_gives_xp_once_and_unmarking_reverts(client):
    h = client.post(BASE, json={"nome": "água", "atributo": "organizacao"}).json()
    antes = _xp(client, "organizacao")
    r = client.post(f"{BASE}/{h['id']}/marcar", json={}).json()
    assert r["feito_hoje"] and r["sequencia"] == 1
    assert _xp(client, "organizacao") == antes + 5
    client.post(f"{BASE}/{h['id']}/marcar", json={})  # de novo: sem xp
    assert _xp(client, "organizacao") == antes + 5
    r = client.delete(f"{BASE}/{h['id']}/marcar").json()
    assert not r["feito_hoje"]
    assert _xp(client, "organizacao") == antes


def test_past_days_up_to_two_back(client):
    h = client.post(BASE, json={"nome": "água"}).json()
    assert client.post(f"{BASE}/{h['id']}/marcar", json={"dia": _d(2)}).status_code == 200
    assert client.post(f"{BASE}/{h['id']}/marcar", json={"dia": _d(3)}).status_code == 422
    amanha = (HOJE + datetime.timedelta(days=1)).isoformat()
    assert client.post(f"{BASE}/{h['id']}/marcar", json={"dia": amanha}).status_code == 422
    assert client.delete(f"{BASE}/{h['id']}/marcar", params={"dia": _d(3)}).status_code == 422
    r = client.post(f"{BASE}/{h['id']}/marcar", json={"dia": _d(1)}).json()
    assert r["sequencia"] == 2  # ontem e anteontem (hoje pendente não quebra)


def test_fixed_day_off_cannot_be_marked(client):
    folga = (HOJE.weekday() + 1) % 7
    h = client.post(BASE, json={"nome": "x", "frequencia": "dias", "dias_semana": [folga]}).json()
    assert client.post(f"{BASE}/{h['id']}/marcar", json={}).status_code == 422


def test_pause_resume_and_archive(client):
    h = client.post(BASE, json={"nome": "corrida"}).json()
    p = client.put(f"{BASE}/{h['id']}", json={"status": "pausado"}).json()
    assert p["status"] == "pausado" and not p["vale_hoje"]
    assert client.post(f"{BASE}/{h['id']}/marcar", json={}).status_code == 409
    # pausar e retomar no mesmo dia não deixa rastro
    r = client.put(f"{BASE}/{h['id']}", json={"status": "ativo"}).json()
    assert r["vale_hoje"]
    client.put(f"{BASE}/{h['id']}", json={"status": "arquivado"})
    assert client.get(BASE).json() == []
    assert [x["status"] for x in client.get(BASE, params={"arquivados": True}).json()] == ["arquivado"]


def test_delete_reverts_all_xp(client):
    h = client.post(BASE, json={"nome": "água"}).json()
    antes = _xp(client, "organizacao")
    client.post(f"{BASE}/{h['id']}/marcar", json={"dia": _d(1)})
    client.post(f"{BASE}/{h['id']}/marcar", json={})
    assert _xp(client, "organizacao") == antes + 10
    assert client.delete(f"{BASE}/{h['id']}").status_code == 204
    assert _xp(client, "organizacao") == antes
    assert client.delete(f"{BASE}/{h['id']}").status_code == 404


def test_marking_counts_for_global_streak(client):
    h = client.post(BASE, json={"nome": "água"}).json()
    client.post(f"{BASE}/{h['id']}/marcar", json={})
    assert client.get("/api/nucleo/player").json()["streak_current"] >= 1


def test_search_finds_habits(client):
    client.post(BASE, json={"nome": "Meditação", "frequencia": "semana", "vezes_semana": 2})
    r = client.get("/api/busca", params={"q": "meditacao"}).json()
    hab = [i for i in r if i["tipo"] == "habito"]
    assert hab and hab[0]["detalhe"] == "2x por semana"


# ---------------- missões (P-58) ----------------

def test_daily_mission_for_a_habit_due_today(client, db_conn, missoes_ligadas, monkeypatch):
    h = client.post(BASE, json={"nome": "água", "atributo": "organizacao"}).json()
    # só o hábito como candidato, pra missão sair certa
    monkeypatch.setattr(missoes, "_sortear_diarias", lambda c, s: [x for x in c if x[0] == "habito"])
    lista = client.get("/api/nucleo/missoes").json()
    m = next(x for x in lista["diarias"] if x["tipo"] == "habito")
    assert m["titulo"] == 'marque o hábito "água"' and not m["concluida"]
    client.post(f"{BASE}/{h['id']}/marcar", json={})
    m = next(x for x in client.get("/api/nucleo/missoes").json()["diarias"] if x["tipo"] == "habito")
    assert m["concluida"]
    client.delete(f"{BASE}/{h['id']}/marcar")
    m = next(x for x in client.get("/api/nucleo/missoes").json()["diarias"] if x["tipo"] == "habito")
    assert not m["concluida"]


def test_weekly_mission_counts_days_with_everything_done(client, db_conn):
    a = client.post(BASE, json={"nome": "a"}).json()
    b = client.post(BASE, json={"nome": "b"}).json()
    client.post(BASE, json={"nome": "c", "frequencia": "semana"})  # semanal não entra
    db_conn.execute("UPDATE habitos SET criado_em = ?", (_d(5) + "T08:00:00",))
    db_conn.commit()
    client.post(f"{BASE}/{a['id']}/marcar", json={})
    assert missoes.dias_com_tudo_feito(db_conn, HOJE, HOJE) == 0
    client.post(f"{BASE}/{b['id']}/marcar", json={})
    assert missoes.dias_com_tudo_feito(db_conn, HOJE, HOJE) == 1
    client.post(f"{BASE}/{a['id']}/marcar", json={"dia": _d(1)})
    assert missoes.dias_com_tudo_feito(db_conn, HOJE - datetime.timedelta(days=1), HOJE) == 1
