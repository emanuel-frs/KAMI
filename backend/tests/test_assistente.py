"""
IA-01: rotas do assistente — estado, catálogo, provedores salvos, chave
da API (nunca volta pra tela, P-109), teto de uso (P-104), testar
conexão, e a chave da IA seguindo as regras dos outros segredos (backup
com senha, redefinir a chave, apagar tudo). O provedor é o falso de
provedor_falso.py (servidor de verdade em 127.0.0.1 — conta como local,
então os testes de teto usam um provedor "de nuvem" fingido).
"""
import json

import pytest
from cryptography.fernet import Fernet

from app import crypto, database
from app.assistente import provedores as prov_mod
from provedor_falso import ProvedorFalso, openai_texto

CHAVE = "gsk-chave-secreta-987654"


@pytest.fixture()
def falso():
    f = ProvedorFalso()
    yield f
    f.fechar()


def _criar(client, falso, catalogo="groq", chave=CHAVE, modelo="m1", **extra):
    corpo = {"catalogo": catalogo, "url_base": falso.url, "modelo": modelo, **extra}
    if chave is not None:
        corpo["api_key"] = chave
    r = client.post("/api/assistente/provedores", json=corpo)
    assert r.status_code == 201, r.text
    return r.json()


def _ferramenta_ok(falso):
    falso.responder("/v1/chat/completions", sse=[
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c", "function": {"name": "confirmar_conexao", "arguments": '{"ok": true}'}}]}}]},
        {"choices": [], "usage": {"prompt_tokens": 40, "completion_tokens": 8}},
        "[DONE]"])


# ── estado inicial / catálogo ────────────────────────────────────────────

def test_comeca_desligado_e_sem_provedor(client):
    e = client.get("/api/assistente").json()
    assert e["pronto"] is False and e["falta"] == "provedor" and e["provedor"] is None
    assert e["config"] == {"ativo": False, "escondido": False, "provedor_id": None, "teto_chamadas": 150,
                           "teto_tokens": 200000, "max_rodadas": 6, "guardar_conversas": True, "dias_historico": 30}
    assert e["uso_hoje"]["chamadas"] == 0


def test_catalogo_cobre_os_caminhos_do_passo_a_passo(client):
    """IA-04 (P-117): cada caminho tem provedores de verdade + "outro";
    local não pede chave e tem link pra baixar; todo link é https."""
    cat = client.get("/api/assistente/catalogo").json()
    por = {c: [p["id"] for p in cat if c in p.get("caminhos", [])] for c in ("paga", "gratuita", "local")}
    assert por == {"paga": ["gemini", "openrouter", "openai", "anthropic", "outro"],
                   "gratuita": ["gemini", "groq", "openrouter", "outro"],
                   "local": ["ollama", "lmstudio", "outro"]}
    for p in cat:
        assert all(u.startswith("https://") for u in p["links"].values()), p["id"]
        if p["local"]:
            assert p["chave"] == "nenhuma" and p["links"].get("baixar")
        elif p["id"] != "outro":
            assert p["links"].get("chave") and p["links"].get("privacidade") and p["links"].get("docs")


def test_catalogo_sem_lista_de_modelos(client):
    cat = client.get("/api/assistente/catalogo").json()
    ids = [p["id"] for p in cat]
    assert ids == ["gemini", "groq", "openrouter", "openai", "anthropic", "ollama", "lmstudio", "outro"]
    for p in cat:
        assert "modelos" not in p and "modelo" not in p  # princípio 8
        assert p["tipo"] in ("openai", "anthropic")
        if p["url_base"]:
            prov_mod.normalizar_url(p["url_base"])  # todo endereço do catálogo passa na própria regra
        for link in p["links"].values():
            assert link.startswith("https://")


# ── provedores salvos e a chave ───────────────────────────────────────────

def test_criar_nunca_devolve_a_chave_e_o_primeiro_fica_em_uso(client, falso, db_conn):
    p = _criar(client, falso)
    assert p["tem_chave"] is True and p["local"] is True and p["chave_exigida"] is True
    assert CHAVE not in json.dumps(p) and "chave_enc" not in p
    assert CHAVE not in client.get("/api/assistente/provedores").text
    assert CHAVE not in client.get("/api/assistente").text
    enc = db_conn.execute("SELECT chave_enc FROM assistente_provedores").fetchone()[0]
    assert enc and CHAVE not in enc and crypto.decrypt_password(enc) == CHAVE
    e = client.get("/api/assistente").json()
    assert e["config"]["provedor_id"] == p["id"] and e["falta"] == "desligado"
    outro = _criar(client, falso, catalogo="ollama", chave=None)
    assert client.get("/api/assistente").json()["config"]["provedor_id"] == p["id"]  # o segundo não toma o lugar
    assert outro["tem_chave"] is False and outro["chave_exigida"] is False


def test_criar_sem_url_usa_a_do_catalogo(client):
    r = client.post("/api/assistente/provedores", json={"catalogo": "gemini", "api_key": "x"})
    assert r.json()["url_base"] == "https://generativelanguage.googleapis.com/v1beta/openai"
    assert r.json()["nome"] == "Google Gemini" and r.json()["tipo"] == "openai"


@pytest.mark.parametrize("url,chave", [
    ("http://api.groq.com/openai/v1", "erro.assistente.url.http_fora_da_rede"),
    ("https://u:s@api.groq.com/v1", "erro.assistente.url.credenciais"),
    ("https://api.groq.com/v1?k=1", "erro.assistente.url.consulta"),
    ("groq.com", "erro.assistente.url.esquema"),
])
def test_url_invalida(client, url, chave):
    r = client.post("/api/assistente/provedores", json={"catalogo": "groq", "url_base": url})
    assert r.status_code == 422 and r.json()["chave"] == chave


def test_catalogo_desconhecido(client):
    r = client.post("/api/assistente/provedores", json={"catalogo": "skynet"})
    assert r.status_code == 422 and r.json()["chave"] == "erro.assistente.catalogo_desconhecido"


def test_p109_trocar_endereco_apaga_a_chave(client, falso):
    p = _criar(client, falso)
    r = client.put(f"/api/assistente/provedores/{p['id']}", json={"url_base": falso.url + "/"})
    assert r.json()["tem_chave"] is True  # mesmo endereço (só a barra) — mantém
    r = client.put(f"/api/assistente/provedores/{p['id']}", json={"url_base": "https://outro.exemplo.invalid/v1"})
    assert r.json()["tem_chave"] is False and r.json()["url_base"] == "https://outro.exemplo.invalid/v1"
    r = client.put(f"/api/assistente/provedores/{p['id']}", json={"url_base": falso.url, "api_key": "nova"})
    assert r.json()["tem_chave"] is True


def test_editar_modelo_e_apagar_chave(client, falso):
    p = _criar(client, falso)
    r = client.put(f"/api/assistente/provedores/{p['id']}", json={"modelo": "m2", "nome": "meu groq"})
    assert r.json()["modelo"] == "m2" and r.json()["nome"] == "meu groq" and r.json()["tem_chave"] is True
    r = client.put(f"/api/assistente/provedores/{p['id']}", json={"apagar_chave": True})
    assert r.json()["tem_chave"] is False
    assert client.get("/api/assistente").json()["falta"] == "chave"


def test_provedor_inexistente(client):
    assert client.put("/api/assistente/provedores/nada", json={}).status_code == 404
    assert client.delete("/api/assistente/provedores/nada").status_code == 404
    assert client.post("/api/assistente/provedores/nada/testar").status_code == 404
    assert client.post("/api/assistente/provedores/nada/usar").status_code == 404


# ── ligar / pronto ────────────────────────────────────────────────────────

def test_so_liga_quando_pronto(client, falso):
    assert client.put("/api/assistente/config", json={"ativo": True}).json()["chave"] == "erro.assistente.falta.provedor"
    p = _criar(client, falso, modelo=None)
    assert client.put("/api/assistente/config", json={"ativo": True}).json()["chave"] == "erro.assistente.falta.modelo"
    client.put(f"/api/assistente/provedores/{p['id']}", json={"modelo": "m1", "apagar_chave": True})
    assert client.put("/api/assistente/config", json={"ativo": True}).json()["chave"] == "erro.assistente.falta.chave"
    client.put(f"/api/assistente/provedores/{p['id']}", json={"api_key": CHAVE})
    e = client.put("/api/assistente/config", json={"ativo": True}).json()
    assert e["pronto"] is True and e["falta"] is None and e["config"]["ativo"] is True
    # desligar sempre pode
    assert client.put("/api/assistente/config", json={"ativo": False}).json()["falta"] == "desligado"


def test_local_sem_chave_fica_pronto(client, falso):
    _criar(client, falso, catalogo="ollama", chave=None)
    assert client.put("/api/assistente/config", json={"ativo": True}).json()["pronto"] is True


def test_apagar_o_provedor_em_uso_desliga(client, falso):
    p = _criar(client, falso)
    client.put("/api/assistente/config", json={"ativo": True})
    assert client.delete(f"/api/assistente/provedores/{p['id']}").status_code == 204
    e = client.get("/api/assistente").json()
    assert e["config"]["ativo"] is False and e["config"]["provedor_id"] is None and e["falta"] == "provedor"


def test_usar_outro_provedor(client, falso):
    _criar(client, falso)
    b = _criar(client, falso, catalogo="ollama", chave=None)
    e = client.post(f"/api/assistente/provedores/{b['id']}/usar").json()
    assert e["config"]["provedor_id"] == b["id"] and e["provedor"]["nome"] == "Ollama"


@pytest.mark.parametrize("campo,valor", [("teto_chamadas", 0), ("teto_tokens", 10), ("max_rodadas", 21), ("dias_historico", 0)])
def test_config_fora_do_limite(client, campo, valor):
    r = client.put("/api/assistente/config", json={campo: valor})
    assert r.status_code == 422 and r.json()["chave"] == "erro.assistente.fora_do_limite"


def test_config_salva(client):
    e = client.put("/api/assistente/config", json={"escondido": True, "teto_chamadas": 20, "guardar_conversas": False}).json()
    assert e["config"]["escondido"] is True and e["config"]["teto_chamadas"] == 20 and e["config"]["guardar_conversas"] is False


# ── modelos ──────────────────────────────────────────────────────────────

def test_modelos_com_a_chave_digitada_sem_salvar(client, falso, db_conn):
    falso.responder("/v1/models", json={"data": [{"id": "b"}, {"id": "a"}]})
    r = client.post("/api/assistente/modelos", json={"catalogo": "groq", "url_base": falso.url, "api_key": "digitada"})
    assert r.json() == {"modelos": ["a", "b"]}
    assert falso.recebidas[0]["headers"]["authorization"] == "Bearer digitada"
    assert db_conn.execute("SELECT COUNT(*) FROM assistente_provedores").fetchone()[0] == 0


def test_modelos_usa_a_chave_salva_so_no_mesmo_endereco(client, falso):
    p = _criar(client, falso)
    falso.responder("/v1/models", json={"data": [{"id": "a"}]})
    r = client.post("/api/assistente/modelos", json={"catalogo": "groq", "url_base": falso.url, "provedor_id": p["id"]})
    assert r.status_code == 200 and falso.recebidas[-1]["headers"]["authorization"] == f"Bearer {CHAVE}"
    outro = ProvedorFalso()
    try:
        outro.responder("/v1/models", json={"data": [{"id": "a"}]})
        r = client.post("/api/assistente/modelos", json={"catalogo": "groq", "url_base": outro.url, "provedor_id": p["id"]})
        assert r.status_code == 422 and r.json()["chave"] == "erro.assistente.falta.chave"
        assert outro.recebidas == []  # P-109: a chave salva não foi pro outro endereço
    finally:
        outro.fechar()


def test_modelos_local_sem_chave(client, falso):
    falso.responder("/v1/models", json={"data": [{"id": "qwen"}]})
    r = client.post("/api/assistente/modelos", json={"catalogo": "ollama", "url_base": falso.url})
    assert r.json() == {"modelos": ["qwen"]}


def test_erro_do_provedor_e_4xx_com_detalhe_sem_a_chave(client, falso):
    falso.responder("/v1/models", status=401, json={"error": {"message": f"Invalid API Key {CHAVE}"}})
    r = client.post("/api/assistente/modelos", json={"catalogo": "groq", "url_base": falso.url, "api_key": CHAVE})
    assert r.status_code == 422
    corpo = r.json()
    assert corpo["chave"] == "erro.assistente.provedor.chave_invalida" and corpo["vars"]["http"] == 401
    assert CHAVE not in r.text and "***" in corpo["vars"]["detalhe"]


def test_sem_conexao_e_424_nao_5xx(client):
    f = ProvedorFalso()
    url = f.url
    f.fechar()
    r = client.post("/api/assistente/modelos", json={"catalogo": "ollama", "url_base": url})
    assert r.status_code == 424 and r.json()["chave"] == "erro.assistente.provedor.sem_conexao"


# ── testar conexão e teto ────────────────────────────────────────────────

def test_testar_registra_resultado_e_uso(client, falso):
    p = _criar(client, falso)
    _ferramenta_ok(falso)
    r = client.post(f"/api/assistente/provedores/{p['id']}/testar").json()
    assert r["ok"] is True and r["ferramentas"] is True
    assert r["provedor"]["teste_ok"] is True and r["provedor"]["ferramentas_ok"] is True and r["provedor"]["teste_em"]
    assert r["uso_hoje"]["chamadas"] == 1 and r["uso_hoje"]["tokens"] == 48 and r["uso_hoje"]["estimado"] is False
    # mudar o modelo invalida o teste anterior
    p2 = client.put(f"/api/assistente/provedores/{p['id']}", json={"modelo": "m9"}).json()
    assert p2["teste_ok"] is None and p2["ferramentas_ok"] is None


def test_testar_sem_uso_informado_estima(client, falso):
    p = _criar(client, falso, catalogo="ollama", chave=None)
    falso.responder("/v1/chat/completions", sse=openai_texto("ok", uso=None))
    r = client.post(f"/api/assistente/provedores/{p['id']}/testar").json()
    assert r["ferramentas"] is False and r["uso_hoje"]["estimado"] is True and r["uso_hoje"]["tokens"] > 0


def test_testar_falha_marca_teste_ok_falso(client, falso):
    p = _criar(client, falso)
    falso.responder("/v1/chat/completions", status=401, json={"error": {"message": "bad key"}})
    r = client.post(f"/api/assistente/provedores/{p['id']}/testar")
    assert r.status_code == 422 and r.json()["chave"] == "erro.assistente.provedor.chave_invalida"
    assert client.get("/api/assistente/provedores").json()[0]["teste_ok"] is False


def test_testar_sem_modelo_ou_sem_chave(client, falso):
    p = _criar(client, falso, modelo=None)
    assert client.post(f"/api/assistente/provedores/{p['id']}/testar").json()["chave"] == "erro.assistente.falta.modelo"
    client.put(f"/api/assistente/provedores/{p['id']}", json={"modelo": "m", "apagar_chave": True})
    assert client.post(f"/api/assistente/provedores/{p['id']}/testar").json()["chave"] == "erro.assistente.falta.chave"


def _como_nuvem(monkeypatch):
    """O falso roda em 127.0.0.1 (local); finge nuvem pra o teto valer."""
    original = prov_mod.normalizar_url
    monkeypatch.setattr(prov_mod, "normalizar_url", lambda url: (original(url)[0], False))


def test_teto_de_chamadas_na_nuvem(client, falso, monkeypatch):
    _como_nuvem(monkeypatch)
    p = _criar(client, falso)
    client.put("/api/assistente/config", json={"teto_chamadas": 2})
    _ferramenta_ok(falso)
    for _ in range(2):
        assert client.post(f"/api/assistente/provedores/{p['id']}/testar").status_code == 200
    r = client.post(f"/api/assistente/provedores/{p['id']}/testar")
    assert r.status_code == 429 and r.json()["chave"] == "erro.assistente.teto.chamadas"
    assert r.json()["vars"] == {"usado": 2, "teto": 2}
    assert len([x for x in falso.recebidas if x["caminho"].endswith("/chat/completions")]) == 2  # a 3ª nem saiu


def test_teto_de_tokens_na_nuvem(client, falso, monkeypatch):
    _como_nuvem(monkeypatch)
    p = _criar(client, falso)
    client.put("/api/assistente/config", json={"teto_tokens": 1000})
    falso.responder("/v1/chat/completions", sse=openai_texto("ok", uso=(990, 20)))
    client.post(f"/api/assistente/provedores/{p['id']}/testar")
    r = client.post(f"/api/assistente/provedores/{p['id']}/testar")
    assert r.status_code == 429 and r.json()["chave"] == "erro.assistente.teto.tokens"


def test_local_nao_tem_teto_mas_conta(client, falso):
    p = _criar(client, falso, catalogo="ollama", chave=None)
    client.put("/api/assistente/config", json={"teto_chamadas": 1})
    _ferramenta_ok(falso)
    for _ in range(3):
        assert client.post(f"/api/assistente/provedores/{p['id']}/testar").status_code == 200
    assert client.get("/api/assistente").json()["uso_hoje"]["chamadas"] == 3


# ── a chave da IA nas regras dos outros segredos ─────────────────────────

def test_redefinir_chave_apaga_a_chave_da_ia_e_conta_como_segredo(client, falso):
    p = _criar(client, falso)
    assert client.get("/api/seguranca/chave").json()["segredos_salvos"] == 1
    r = client.post("/api/seguranca/chave/redefinir", json={"confirmation": "redefinir"}).json()
    assert r["segredos_apagados"] == 1
    depois = client.get("/api/assistente/provedores").json()[0]
    assert depois["id"] == p["id"] and depois["tem_chave"] is False and depois["modelo"] == "m1"


def test_backup_com_senha_leva_e_devolve_a_chave_da_ia(client, falso):
    _criar(client, falso)
    arq = client.post("/api/sistema/export-protegido", json={"senha": "cavalo-bateria-grampo"}).json()
    assert arq["segredos_incluidos"] == 1 and CHAVE not in json.dumps(arq)
    crypto._resetar_para_testes(Fernet(Fernet.generate_key()), {"local": "cofre", "cofre": "teste", "motivo": None})
    r = client.post("/api/sistema/import", json={"confirmation": "importar", "cifrado": arq["arquivo"], "senha": "cavalo-bateria-grampo"})
    assert r.status_code == 200, r.text
    conn = database.get_connection()
    enc = conn.execute("SELECT chave_enc FROM assistente_provedores").fetchone()[0]
    conn.close()
    assert crypto.decrypt_password(enc) == CHAVE


def test_reset_apaga_o_assistente(client, falso):
    _criar(client, falso)
    client.put("/api/assistente/config", json={"ativo": True})
    assert client.post("/api/sistema/reset", json={"confirmation": "excluir"}).status_code == 200
    e = client.get("/api/assistente").json()
    assert e["provedor"] is None and e["config"]["ativo"] is False
    assert client.get("/api/assistente/provedores").json() == []


def test_toda_tabela_entra_no_reset_e_no_import(db_conn):
    """Guarda geral: tabela nova no schema.sql que ficar fora do reset
    sobreviveria ao "apagar tudo" (e não voltaria num import)."""
    from app.routers.sistema import _TABLES_DELETE_ORDER

    tabelas = {r[0] for r in db_conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}
    assert tabelas - set(_TABLES_DELETE_ORDER) == {"sistema_info"}
