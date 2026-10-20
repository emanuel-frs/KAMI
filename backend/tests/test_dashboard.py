"""Testes do router app/routers/dashboard.py (layout de widgets, decisão 17).

Todas as telas ('perfil', 'nucleo', 'carreira' e 'financas') vêm com
layout default seedado por init_db(),
que é o LAYOUT_PADRAO de app/widgets.py (LAY-02).
"""
from app.widgets import LAYOUT_PADRAO


def test_get_layout_seeds_default_for_financas(client):
    resp = client.get("/api/dashboard/financas")
    assert resp.status_code == 200
    body = resp.json()
    assert [w["widget_type"] for w in body] == [w for w, _l, _a in LAYOUT_PADRAO["financas"]]


def test_get_layout_seeds_default_for_nucleo(client):
    resp = client.get("/api/dashboard/nucleo")
    assert resp.status_code == 200
    body = resp.json()
    assert [w["widget_type"] for w in body] == [w for w, _l, _a in LAYOUT_PADRAO["nucleo"]]


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
    # 'carteira' só é permitido em 'financas', não em 'nucleo'
    resp = client.put(
        "/api/dashboard/nucleo",
        json={"widgets": [{"widget_type": "carteira", "width": 2}]},
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
    # financas tem layout padrão próprio (seedado, não vazio) — o que
    # importa aqui é que ele não foi afetado pelo PUT em nucleo.
    assert [w["widget_type"] for w in resp.json()] == [w for w, _l, _a in LAYOUT_PADRAO["financas"]]


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

# ── layout padrão e aviso de layout novo (LAY-02/05, P-23) ──────────────

from app.widgets import LAYOUT_PADRAO_VERSAO, layout_padrao  # noqa: E402


def _esquecer_que_viu(db_conn):
    """Simula um banco de antes da 1.12: sem o registro da versão vista."""
    db_conn.execute("DELETE FROM sistema_info WHERE chave = 'layout_padrao_versao'")
    db_conn.commit()


def test_lay_02_default_layout_respects_the_catalog(client):
    # todo widget do padrão é da tela, aparece uma vez, com largura dentro do
    # mínimo/máximo do catálogo; e os obrigatórios estão lá
    from app.widgets import WIDGET_CATALOG, screens_for

    for tela, itens in LAYOUT_PADRAO.items():
        tipos = [w for w, _l, _a in itens]
        assert len(tipos) == len(set(tipos)), tela
        for w, largura, _a in itens:
            d = WIDGET_CATALOG[w]
            assert tela in screens_for(w), (tela, w)
            assert d["min_span"] <= largura <= d["max_span"], (tela, w, largura)
        obrigatorios = {w for w, d in WIDGET_CATALOG.items() if d.get("removable") is False and tela in screens_for(w)}
        assert obrigatorios <= set(tipos), tela
        assert client.put(f"/api/dashboard/{tela}", json={"widgets": layout_padrao(tela)}).status_code == 200


def test_lay_05_default_layout_of_a_screen_is_available(client):
    resp = client.get("/api/dashboard/financas/padrao")
    assert resp.status_code == 200
    assert resp.json() == layout_padrao("financas")
    assert client.get("/api/dashboard/inexistente/padrao").status_code == 422


def test_lay_05_fresh_install_does_not_get_the_new_layout_notice(client):
    assert client.get("/api/dashboard/novidade").json() == {"versao": LAYOUT_PADRAO_VERSAO, "telas": []}


def test_lay_05_old_layout_gets_the_notice_only_for_screens_that_differ(client, db_conn):
    _esquecer_que_viu(db_conn)
    client.put("/api/dashboard/nucleo", json={"widgets": [{"widget_type": "log", "width": 4}]})
    assert client.get("/api/dashboard/novidade").json()["telas"] == ["nucleo"]


def test_lay_05_applying_the_new_layout_returns_the_old_one_for_undo(client, db_conn):
    _esquecer_que_viu(db_conn)
    antigo = [{"widget_type": "log", "width": 4}, {"widget_type": "attributes", "width": 2}]
    client.put("/api/dashboard/nucleo", json={"widgets": antigo})

    resp = client.post("/api/dashboard/novidade", json={"aplicar": True}).json()
    assert resp["aplicadas"] == ["nucleo"]
    assert [(w["widget_type"], w["width"]) for w in resp["anteriores"]["nucleo"]] == [("log", 4), ("attributes", 2)]
    assert [w["widget_type"] for w in client.get("/api/dashboard/nucleo").json()] == [w for w, _l, _a in LAYOUT_PADRAO["nucleo"]]
    assert client.get("/api/dashboard/novidade").json()["telas"] == []

    # desfazer = mandar o anterior de volta pelo PUT de sempre
    client.put("/api/dashboard/nucleo", json={"widgets": resp["anteriores"]["nucleo"]})
    assert [w["widget_type"] for w in client.get("/api/dashboard/nucleo").json()] == ["log", "attributes"]


def test_lay_05_dismissing_keeps_the_layout_and_stops_asking(client, db_conn):
    _esquecer_que_viu(db_conn)
    client.put("/api/dashboard/nucleo", json={"widgets": [{"widget_type": "log", "width": 4}]})
    resp = client.post("/api/dashboard/novidade", json={"aplicar": False}).json()
    assert resp["aplicadas"] == []
    assert [w["widget_type"] for w in client.get("/api/dashboard/nucleo").json()] == ["log"]
    assert client.get("/api/dashboard/novidade").json()["telas"] == []
