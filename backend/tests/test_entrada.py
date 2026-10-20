"""Caixa de entrada da captura rápida (ORG-02) — app/routers/entrada.py."""
BASE = "/api/organizacao/entrada"


def test_capture_list_and_discard(client):
    a = client.post(BASE, json={"texto": "  ligar pro banco  "}).json()
    b = client.post(BASE, json={"texto": "ideia de app"}).json()
    assert a["texto"] == "ligar pro banco"
    assert [i["id"] for i in client.get(BASE).json()] == [b["id"], a["id"]]
    assert client.delete(f"{BASE}/{a['id']}").status_code == 204
    assert [i["id"] for i in client.get(BASE).json()] == [b["id"]]
    assert client.delete(f"{BASE}/{a['id']}").status_code == 404


def test_empty_text_is_rejected(client):
    assert client.post(BASE, json={"texto": "   "}).status_code == 422
    assert client.post(BASE, json={"texto": ""}).status_code == 422


def test_task_goes_to_the_tasks_note_creating_it_once(client):
    a = client.post(BASE, json={"texto": "comprar café"}).json()
    b = client.post(BASE, json={"texto": "pagar  luz"}).json()
    nota_id = client.post(f"{BASE}/{a['id']}/tarefa").json()["nota_id"]
    assert client.post(f"{BASE}/{b['id']}/tarefa").json()["nota_id"] == nota_id
    nota = client.get(f"/api/organizacao/notas/{nota_id}").json()
    assert nota["titulo"] == "tarefas" and nota["fixada"] is True
    assert nota["conteudo"] == "- [ ] comprar café\n- [ ] pagar luz"
    assert client.get(BASE).json() == []
    assert client.post(f"{BASE}/x/tarefa").status_code == 404


def test_capturing_gives_no_xp(client):
    antes = {a["name"]: a["current_xp"] for a in client.get("/api/nucleo/attributes").json()}
    client.post(BASE, json={"texto": "qualquer coisa"})
    depois = {a["name"]: a["current_xp"] for a in client.get("/api/nucleo/attributes").json()}
    assert antes == depois
