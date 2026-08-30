"""Testes do router app/routers/dashboard.py (layout de widgets, decisão 17).

'perfil' e 'nucleo' vêm com layout default seedado por init_db()
(ver database.py DEFAULT_LAYOUTS) — só 'financas' nasce vazia, então
é a tela usada aqui pra testar o caso "sem layout salvo ainda".
"""


def test_get_layout_empty_screen_returns_empty_list(client):
    resp = client.get("/api/dashboard/financas")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_layout_seeds_default_for_nucleo(client):
    resp = client.get("/api/dashboard/nucleo")
    assert resp.status_code == 200
    body = resp.json()
    assert [w["widget_type"] for w in body] == [
        "attributes", "priorities", "log", "registrar", "achievements",
    ]


def test_get_layout_invalid_screen_returns_422(client):
    resp = client.get("/api/dashboard/tela-que-nao-existe")
    assert resp.status_code == 422


def test_put_layout_persists_order_and_width(client):
    payload = {
        "widgets": [
            {"widget_type": "attributes", "width": 2},
            {"widget_type": "log", "width": 4, "height": 3},
        ]
    }
    resp = client.put("/api/dashboard/nucleo", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert [w["widget_type"] for w in body] == ["attributes", "log"]
    assert [w["position"] for w in body] == [0, 1]
    assert body[1]["height"] == 3

    # confirma persistência num GET separado
    resp2 = client.get("/api/dashboard/nucleo")
    body2 = resp2.json()
    assert [w["widget_type"] for w in body2] == ["attributes", "log"]


def test_put_layout_replaces_completely(client):
    """Um segundo PUT substitui o layout inteiro, não faz merge com o anterior."""
    client.put(
        "/api/dashboard/nucleo",
        json={"widgets": [{"widget_type": "attributes", "width": 2}]},
    )
    resp = client.put(
        "/api/dashboard/nucleo",
        json={"widgets": [{"widget_type": "log", "width": 4}]},
    )
    body = resp.json()
    assert len(body) == 1
    assert body[0]["widget_type"] == "log"


def test_put_layout_reorder_updates_position(client):
    client.put(
        "/api/dashboard/nucleo",
        json={
            "widgets": [
                {"widget_type": "attributes", "width": 2},
                {"widget_type": "log", "width": 4},
            ]
        },
    )
    resp = client.put(
        "/api/dashboard/nucleo",
        json={
            "widgets": [
                {"widget_type": "log", "width": 4},
                {"widget_type": "attributes", "width": 2},
            ]
        },
    )
    body = resp.json()
    assert [w["widget_type"] for w in body] == ["log", "attributes"]
    assert [w["position"] for w in body] == [0, 1]


def test_put_layout_rejects_unknown_widget_type(client):
    resp = client.put(
        "/api/dashboard/nucleo",
        json={"widgets": [{"widget_type": "widget-inventado", "width": 2}]},
    )
    assert resp.status_code == 422


def test_put_layout_rejects_widget_not_allowed_on_screen(client):
    # 'wallet' só é permitido em 'financas', não em 'nucleo'
    resp = client.put(
        "/api/dashboard/nucleo",
        json={"widgets": [{"widget_type": "wallet", "width": 2}]},
    )
    assert resp.status_code == 422


def test_put_layout_accepts_width_at_min_span_one(client):
    # todo widget do catálogo tem min_span=1 (qualquer widget pode ser
    # redimensionado pro tamanho mínimo da grade) — 'log' aqui só como
    # representante, não é especial em relação aos demais tipos
    resp = client.put(
        "/api/dashboard/nucleo",
        json={"widgets": [{"widget_type": "log", "width": 1}]},
    )
    assert resp.status_code == 200


def test_put_layout_rejects_width_below_one(client):
    # width=0 nem chega a bater o min_span=1 do catálogo — barrado antes
    # disso pela validação de campo (Field(ge=1)) em WidgetLayoutItem
    resp = client.put(
        "/api/dashboard/nucleo",
        json={"widgets": [{"widget_type": "log", "width": 0}]},
    )
    assert resp.status_code == 422


def test_put_layout_rejects_width_above_max_span(client):
    # 'financas_resumo' tem max_span=4
    resp = client.put(
        "/api/dashboard/financas",
        json={"widgets": [{"widget_type": "financas_resumo", "width": 6}]},
    )
    assert resp.status_code == 422


def test_put_layout_requires_non_removable_widget_present(client):
    # 'profile' é removable=False no catálogo — layout de 'perfil' sem
    # ele deve ser rejeitado
    resp = client.put(
        "/api/dashboard/perfil",
        json={"widgets": [{"widget_type": "attributes", "width": 2}]},
    )
    assert resp.status_code == 422


def test_put_layout_accepts_non_removable_widget_present(client):
    resp = client.put(
        "/api/dashboard/perfil",
        json={
            "widgets": [
                {"widget_type": "profile", "width": 4},
                {"widget_type": "attributes", "width": 2},
            ]
        },
    )
    assert resp.status_code == 200
    assert [w["widget_type"] for w in resp.json()] == ["profile", "attributes"]


def test_put_layout_screens_are_independent(client):
    """Layout de uma tela não deve vazar/afetar o de outra."""
    client.put(
        "/api/dashboard/nucleo",
        json={"widgets": [{"widget_type": "log", "width": 4}]},
    )
    resp = client.get("/api/dashboard/financas")
    assert resp.json() == []


def test_put_layout_persists_config_json(client):
    resp = client.put(
        "/api/dashboard/nucleo",
        json={
            "widgets": [
                {"widget_type": "log", "width": 4, "config_json": '{"filtro": "financas"}'}
            ]
        },
    )
    assert resp.json()[0]["config_json"] == '{"filtro": "financas"}'