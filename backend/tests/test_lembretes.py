"""Lembretes (ORG-05) — regra em app/lembretes.py, rotas em app/routers/lembretes.py."""
import datetime

import pytest

from app import lembretes as regra_mod
from app.routers import lembretes as rota

BASE = "/api/lembretes"
T0 = datetime.datetime(2026, 10, 20, 8, 0)  # terça


@pytest.fixture()
def relogio(monkeypatch):
    """Relógio controlado: relogio.agora = datetime(...)."""
    class R:
        agora = T0
    monkeypatch.setattr(rota, "_agora", lambda: R.agora)
    return R


def _r(**kw):
    base = {"data": "2026-10-20", "hora": "09:00", "repeticao": "nao", "dias_semana": ""}
    base.update(kw)
    return base


# ---------------- regra ----------------

def test_next_occurrence_for_each_repetition():
    p = regra_mod.proxima_desde
    assert p(_r(), T0) == datetime.datetime(2026, 10, 20, 9, 0)
    assert p(_r(), datetime.datetime(2026, 10, 20, 9, 1)) is None
    assert p(_r(repeticao="diario"), datetime.datetime(2026, 10, 20, 9, 1)) == datetime.datetime(2026, 10, 21, 9, 0)
    # seg e sex (0, 4) a partir de terça -> sexta
    assert p(_r(repeticao="dias", dias_semana="0,4"), T0).date() == datetime.date(2026, 10, 23)
    # todo dia 31: em novembro cai no dia 30
    assert p(_r(data="2026-10-31", repeticao="mensal"), datetime.datetime(2026, 11, 1)).date() == datetime.date(2026, 11, 30)
    # 29/02 vira 28/02 em ano comum
    assert p(_r(data="2028-02-29", repeticao="anual"), datetime.datetime(2029, 1, 1)).date() == datetime.date(2029, 2, 28)


def test_occurrences_in_a_month():
    oc = regra_mod.ocorrencias(_r(data="2026-10-01", repeticao="dias", dias_semana="6"),
                               datetime.date(2026, 10, 1), datetime.date(2026, 10, 31))
    assert [d.day for d in oc] == [4, 11, 18, 25]


# ---------------- rotas ----------------

def test_create_validation(client, relogio):
    ok = client.post(BASE, json={"titulo": "ligar pro banco", "data": "2026-10-20", "hora": "10:30"})
    assert ok.status_code == 201 and ok.json()["proxima"] == "2026-10-20T10:30"
    assert client.post(BASE, json={"titulo": "x", "data": "2026-10-19", "hora": "10:00"}).status_code == 422  # passou
    assert client.post(BASE, json={"titulo": "x", "data": "2026-10-20", "repeticao": "dias", "dias_semana": []}).status_code == 422
    assert client.post(BASE, json={"titulo": "x", "data": "2026-10-20", "repeticao": "semanal"}).status_code == 422
    assert client.post(BASE, json={"titulo": "x", "data": "2026-10-20", "hora": "25:00"}).status_code == 422
    assert client.post(BASE, json={"titulo": "x", "data": "2026-10-20", "vinculo_tipo": "meta", "vinculo_id": "nada"}).status_code == 422


def test_fires_once_goes_pending_and_dismisses(client, relogio):
    lid = client.post(BASE, json={"titulo": "remédio", "data": "2026-10-20", "hora": "09:00", "repeticao": "diario"}).json()["id"]
    assert client.post(f"{BASE}/disparar").json() == []
    relogio.agora = datetime.datetime(2026, 10, 20, 9, 0)
    fired = client.post(f"{BASE}/disparar").json()
    assert [f["id"] for f in fired] == [lid] and not fired[0]["atrasado"]
    assert fired[0]["proxima"] == "2026-10-21T09:00"
    assert client.post(f"{BASE}/disparar").json() == []  # não repete
    assert [p["id"] for p in client.get(f"{BASE}/pendentes").json()] == [lid]
    client.post(f"{BASE}/{lid}/dispensar")
    assert client.get(f"{BASE}/pendentes").json() == []


def test_app_closed_for_days_gives_one_late_notice(client, relogio):
    client.post(BASE, json={"titulo": "remédio", "data": "2026-10-20", "hora": "09:00", "repeticao": "diario"})
    relogio.agora = datetime.datetime(2026, 10, 23, 14, 0)
    fired = client.post(f"{BASE}/disparar").json()
    assert len(fired) == 1 and fired[0]["atrasado"]
    assert fired[0]["proxima"] == "2026-10-24T09:00"


def test_snooze_minutes_and_tomorrow_keep_the_rule(client, relogio):
    lid = client.post(BASE, json={"titulo": "água", "data": "2026-10-20", "hora": "09:00", "repeticao": "diario"}).json()["id"]
    relogio.agora = datetime.datetime(2026, 10, 20, 9, 0)
    client.post(f"{BASE}/disparar")
    a = client.post(f"{BASE}/{lid}/adiar", json={"minutos": 10}).json()
    assert a["adiado_para"] == "2026-10-20T09:10" and not a["pendente"]
    assert a["proxima"] == "2026-10-21T09:00"
    relogio.agora = datetime.datetime(2026, 10, 20, 9, 10)
    fired = client.post(f"{BASE}/disparar").json()
    assert fired and fired[0]["adiado_para"] is None and fired[0]["proxima"] == "2026-10-21T09:00"
    b = client.post(f"{BASE}/{lid}/adiar", json={"amanha": True}).json()
    assert b["adiado_para"] == "2026-10-21T09:00"
    assert client.post(f"{BASE}/{lid}/adiar", json={}).status_code == 422


def test_habit_reminder_skips_when_already_done(client, relogio, monkeypatch):
    hoje = datetime.date.today()  # a marca do hábito usa o dia real
    relogio.agora = datetime.datetime(hoje.year, hoje.month, hoje.day, 8, 0)
    h = client.post("/api/habitos", json={"nome": "água"}).json()
    client.post(BASE, json={"titulo": "beber água", "data": hoje.isoformat(), "hora": "20:00", "repeticao": "diario",
                            "vinculo_tipo": "habito", "vinculo_id": h["id"]})
    client.post(f"/api/habitos/{h['id']}/marcar", json={})
    relogio.agora = datetime.datetime(hoje.year, hoje.month, hoje.day, 20, 0)
    assert client.post(f"{BASE}/disparar").json() == []
    assert client.get(f"{BASE}/pendentes").json() == []


def test_link_name_and_deleted_link(client, relogio):
    meta = client.post("/api/metas", json={"title": "viagem", "type": "financeira", "target_value": 100, "weight": "medio"}).json()
    lid = client.post(BASE, json={"titulo": "guardar", "data": "2026-10-20", "vinculo_tipo": "meta", "vinculo_id": meta["id"]}).json()["id"]
    assert client.get(BASE).json()[0]["vinculo"] == {"tipo": "meta", "id": meta["id"], "nome": "viagem"}
    client.delete(f"/api/metas/{meta['id']}")
    assert client.get(BASE).json()[0]["vinculo"] is None
    assert client.delete(f"{BASE}/{lid}").status_code == 204
    assert client.delete(f"{BASE}/{lid}").status_code == 404


def test_reminders_show_in_the_calendar(client, relogio):
    client.post(BASE, json={"titulo": "faxina", "data": "2026-10-20", "hora": "10:00", "repeticao": "dias", "dias_semana": [5]})
    ev = [e for e in client.get("/api/calendario/events", params={"month": "2026-10"}).json() if e["type"] == "lembrete"]
    assert [e["date"] for e in ev] == ["2026-10-24", "2026-10-31"]
    assert ev[0]["time"] == "10:00" and ev[0]["module"] == "lembretes"


def test_enabling_pin_hides_notification_text_by_default(client):
    assert client.get("/api/perfil").json()["notif_ocultar_texto"] is False
    client.post("/api/seguranca/pin", json={"pin": "4821"})
    assert client.get("/api/perfil").json()["notif_ocultar_texto"] is True
    assert client.put("/api/perfil", json={"notif_ocultar_texto": False}).json()["notif_ocultar_texto"] is False


def test_notification_preferences(client):
    p = client.put("/api/perfil", json={"notif_fora_eventos": False, "avisos_hora": "07:30"}).json()
    assert p["notif_fora_eventos"] is False and p["avisos_hora"] == "07:30" and p["notif_fora_lembretes"] is True
    assert client.put("/api/perfil", json={"avisos_hora": "7h"}).status_code == 422


def test_dismissing_a_finished_one_off_reminder_deletes_it(client, relogio):
    once = client.post(BASE, json={"titulo": "ligar", "data": "2026-10-20", "hora": "09:00"}).json()["id"]
    daily = client.post(BASE, json={"titulo": "água", "data": "2026-10-20", "hora": "09:00", "repeticao": "diario"}).json()["id"]
    relogio.agora = datetime.datetime(2026, 10, 20, 9, 0)
    client.post(f"{BASE}/disparar")
    client.post(f"{BASE}/{once}/dispensar")
    client.post(f"{BASE}/{daily}/dispensar")
    assert [l["id"] for l in client.get(BASE).json()] == [daily]
