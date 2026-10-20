"""
Limites e validação de entrada (SEG-05, docs/REGRAS-DE-NEGOCIO.md SEG-06..09).

Varre o OpenAPI: toda rota de escrita recebe corpos montados a partir do
próprio schema com valores extremos (texto gigante, números enormes,
negativos, tipos errados) e toda rota com parâmetro de busca recebe
valores absurdos. Nada disso pode virar 500 — erro de entrada é 4xx, com
mensagem. Rota nova entra no teste sozinha.
"""
import uuid

import pytest

from app.main import app
from app.limites import CORPO_MAX_BYTES, CORPO_MAX_BYTES_IMPORT, TEXTO_CURTO_MAX, TEXTO_LONGO_MAX, NUMERO_MAX

SPEC = app.openapi()
SCHEMAS = SPEC["components"]["schemas"]
GIGANTE = "x" * (TEXTO_LONGO_MAX + 1)


def _resolve(schema):
    while "$ref" in schema:
        schema = SCHEMAS[schema["$ref"].split("/")[-1]]
    if "anyOf" in schema:
        options = [s for s in schema["anyOf"] if s.get("type") != "null"]
        return _resolve(options[0]) if options else schema
    return schema


def _value(schema, mode):
    schema = _resolve(schema)
    kind = schema.get("type")
    if "enum" in schema:
        return schema["enum"][0]
    if kind == "string":
        return {"texto": GIGANTE, "numero": "1", "negativo": "-1", "tipo": 123}[mode]
    if kind == "integer":
        return {"texto": 1, "numero": 10**20, "negativo": -(10**20), "tipo": "abc"}[mode]
    if kind == "number":
        return {"texto": 1.5, "numero": 1e308, "negativo": -1e308, "tipo": "abc"}[mode]
    if kind == "boolean":
        return {"tipo": "talvez"}.get(mode, True)
    if kind == "array":
        item = schema.get("items", {})
        return [_value(item, mode)] if mode != "tipo" else "não é lista"
    if kind == "object" or "properties" in schema:
        return {name: _value(prop, mode) for name, prop in schema.get("properties", {}).items()}
    return GIGANTE


def _write_routes():
    for path, ops in SPEC["paths"].items():
        for method, op in ops.items():
            if method not in ("post", "put", "patch"):
                continue
            body = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
            if body:
                yield method, path, body


def _url(path):
    # parâmetro de caminho = um id que não existe; a rota tem que responder 4xx
    out = path
    while "{" in out:
        start = out.index("{")
        out = out[:start] + str(uuid.uuid4()) + out[out.index("}") + 1:]
    return out


WRITE_ROUTES = sorted(_write_routes(), key=lambda r: (r[1], r[0]))


@pytest.mark.parametrize("mode", ["texto", "numero", "negativo", "tipo"])
@pytest.mark.parametrize("method,path,body", WRITE_ROUTES, ids=[f"{m.upper()} {p}" for m, p, _ in WRITE_ROUTES])
def test_seg_06_extreme_bodies_never_cause_500(client, method, path, body, mode):
    resp = client.request(method, _url(path), json=_value(body, mode))
    assert resp.status_code < 500, (resp.status_code, resp.text[:300])


@pytest.mark.parametrize("raw", ["[]", '"texto"', "null", "{", "1e999999"])
@pytest.mark.parametrize("method,path,body", WRITE_ROUTES, ids=[f"{m.upper()} {p}" for m, p, _ in WRITE_ROUTES])
def test_seg_06_malformed_json_never_causes_500(client, method, path, body, raw):
    resp = client.request(method, _url(path), content=raw, headers={"Content-Type": "application/json"})
    assert resp.status_code < 500, (resp.status_code, resp.text[:300])


def _query_routes():
    for path, ops in SPEC["paths"].items():
        for method, op in ops.items():
            params = [p for p in op.get("parameters", []) if p["in"] == "query"]
            if params:
                yield method, path, params


QUERY_ROUTES = sorted(_query_routes(), key=lambda r: (r[1], r[0]))


@pytest.mark.parametrize("mode", ["texto", "numero", "negativo", "tipo"])
@pytest.mark.parametrize("method,path,params", QUERY_ROUTES, ids=[f"{m.upper()} {p}" for m, p, _ in QUERY_ROUTES])
def test_seg_06_extreme_query_params_never_cause_500(client, method, path, params, mode):
    query = {p["name"]: _value(p["schema"], mode) for p in params}
    url = _url(path)
    resp = client.request(method, url, params=query)
    assert resp.status_code < 500, (resp.status_code, resp.text[:300])


# ── limites específicos ──────────────────────────────────────────────────

def test_seg_07_short_text_fields_stop_at_200_characters(client):
    ok = client.post("/api/aprendizado/tracks", json={"name": "t" * 200})
    assert ok.status_code == 201
    resp = client.post("/api/aprendizado/tracks", json={"name": "t" * 201})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "name: no máximo 200 caracteres"


def test_seg_07_free_text_fields_take_5000_characters(client):
    track = client.post("/api/aprendizado/tracks", json={"name": "trilha", "general_goal": "g" * 5000})
    assert track.status_code == 201
    resp = client.post("/api/aprendizado/tracks", json={"name": "trilha", "general_goal": "g" * 5001})
    assert resp.status_code == 422
    assert "no máximo 5000 caracteres" in resp.json()["detail"]


def test_seg_07_ascii_avatar_of_120_columns_still_fits(client):
    avatar = "\n".join(["█" * 120] * 125)  # ~15 mil caracteres
    assert client.put("/api/perfil/avatar", json={"avatar_ascii": avatar}).status_code == 200


def test_seg_07_field_with_its_own_limit_keeps_it(client):
    resp = client.post("/api/sistema/erro-frontend", json={"mensagem": "erro", "pilha": "p" * 2000})
    assert resp.status_code == 204


def test_seg_07_numbers_are_bounded_and_must_be_finite(client):
    resp = client.post("/api/financas/transactions", json={"type": "saida", "amount": 10**13, "category": "outros"})
    assert resp.status_code == 422
    assert "número grande demais" in resp.json()["detail"]
    resp = client.post(
        "/api/financas/transactions",
        content='{"type": "saida", "amount": Infinity, "category": "outros"}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 422


def test_seg_08_body_over_1_mb_is_refused_before_the_route(client):
    resp = client.post("/api/nucleo/actions", content=b"{" + b" " * (1024 * 1024) + b"}",
                       headers={"Content-Type": "application/json"})
    assert resp.status_code == 413
    assert resp.json() == {"detail": "conteúdo grande demais (máximo 1 MB)", "codigo": "grande_demais"}


def test_seg_08_streamed_body_without_length_is_also_counted(client, monkeypatch):
    from app import limites

    monkeypatch.setattr(limites, "CORPO_MAX_BYTES", 1000)

    def pedacos():
        for _ in range(5):
            yield b" " * 400

    resp = client.post("/api/nucleo/actions", content=pedacos(), headers={"Content-Type": "application/json"})
    assert resp.status_code == 413


def test_seg_08_backup_import_accepts_more_than_1_mb_up_to_50(client, monkeypatch):
    from app import limites

    grande = client.post("/api/sistema/import", json={"confirmation": "nao", "tables": {"x": ["y" * (2 * 1024 * 1024)]}})
    assert grande.status_code == 422  # passou do limite de corpo e chegou na rota (confirmação errada)
    monkeypatch.setattr(limites, "CORPO_MAX_BYTES_IMPORT", 3 * 1024 * 1024)
    resp = client.post("/api/sistema/import", json={"confirmation": "nao", "tables": {"x": ["y" * (4 * 1024 * 1024)]}})
    assert resp.status_code == 413
    assert "máximo 3 MB" in resp.json()["detail"]


def _input_models():
    import inspect
    import pkgutil

    import app.routers as routers_pkg

    nomes = {body["$ref"].split("/")[-1] for _m, _p, body in WRITE_ROUTES}
    achados = {}
    for mod in pkgutil.iter_modules(routers_pkg.__path__):
        module = __import__(f"app.routers.{mod.name}", fromlist=["x"])
        for nome, obj in inspect.getmembers(module, inspect.isclass):
            if nome in nomes and obj.__module__ == module.__name__:
                achados[nome] = obj
    return nomes, achados


def test_seg_09_every_input_model_inherits_the_limits():
    from app.limites import Entrada

    nomes, achados = _input_models()
    assert nomes == set(achados), nomes ^ set(achados)
    fora = sorted(n for n, cls in achados.items() if not issubclass(cls, Entrada))
    assert fora == []


def test_seg_09_no_route_takes_a_file_path():
    # nenhuma rota recebe caminho de arquivo; se um dia receber, tem que
    # validar que fica dentro da pasta de dados — e este teste lembra disso
    suspeitos = ("path", "caminho", "pasta", "arquivo", "file", "dir")
    nomes = []
    for _path, ops in SPEC["paths"].items():
        for op in ops.values():
            nomes += [p["name"] for p in op.get("parameters", [])]
    for schema in SCHEMAS.values():
        nomes += list(schema.get("properties", {}))
    assert [n for n in nomes if any(s in n.lower() for s in suspeitos)] == []
