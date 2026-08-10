"""Testes do router app/routers/widgets.py (ALINHAMENTO.md 2.6)."""
from app.widgets import WIDGET_CATALOG


def test_get_catalog_returns_full_dict(client):
    resp = client.get("/api/widgets/catalog")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == set(WIDGET_CATALOG.keys())


def test_get_catalog_matches_backend_source_of_truth(client):
    resp = client.get("/api/widgets/catalog")
    body = resp.json()
    assert body == WIDGET_CATALOG


def test_get_catalog_entry_shape(client):
    resp = client.get("/api/widgets/catalog")
    body = resp.json()
    entry = body["attributes"]
    assert entry["label"]
    assert "nucleo" in entry["screens"]
    assert entry["removable"] is True
    assert isinstance(entry["min_span"], int)
    assert isinstance(entry["max_span"], int)
    assert isinstance(entry["default_span"], int)


def test_get_catalog_pinned_widget_not_removable(client):
    resp = client.get("/api/widgets/catalog")
    body = resp.json()
    assert body["profile"]["removable"] is False