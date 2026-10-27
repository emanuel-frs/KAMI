"""
IA-02: chat do assistente — resposta em streaming (SSE), conversa nova e
continuada (histórico só da própria conversa, princípio 1), parar no
meio, teto e PIN no meio, registro do que foi enviado (princípio 3),
"não guardar conversas" e "apagar tudo" (P-105). Provedor falso de
verdade (provedor_falso.py).
"""
import json
import threading
import time

import pytest

from app import database, pin
from app.assistente import chat, conversas, instrucoes
from app.assistente import provedores as prov_mod
from provedor_falso import ProvedorFalso, anthropic_texto, openai_texto


@pytest.fixture()
def falso():
    f = ProvedorFalso()
    yield f
    f.fechar()


@pytest.fixture(autouse=True)
def _memoria_limpa():
    conversas._resetar_para_testes()
    yield
    conversas._resetar_para_testes()


def _ligar(client, falso, catalogo="ollama", **extra):
    corpo = {"catalogo": catalogo, "url_base": falso.url, "modelo": "m1", **extra}
    p = client.post("/api/assistente/provedores", json=corpo).json()
    assert client.put("/api/assistente/config", json={"ativo": True}).json()["pronto"] is True
    return p


def _enviar(client, texto, **extra):
    """Manda uma mensagem e devolve a lista de eventos SSE (ou a resposta, se não for SSE)."""
    with client.stream("POST", "/api/assistente/mensagens", json={"texto": texto, "idioma": "pt", **extra}) as r:
        if r.headers.get("content-type", "").startswith("application/json"):
            r.read()
            return r
        eventos, nome = [], None
        for linha in r.iter_lines():
            if linha.startswith("event: "):
                nome = linha[7:]
            elif linha.startswith("data: "):
                ev = json.loads(linha[6:])
                assert ev["tipo"] == nome
                eventos.append(ev)
        return eventos


def _texto(eventos):
    return "".join(e["delta"] for e in eventos if e["tipo"] == "texto")


def _pedidos_chat(falso):
    return [r["json"] for r in falso.recebidas if r["caminho"].endswith(("/chat/completions", "/messages"))]


# ── recusas antes do streaming ───────────────────────────────────────────

def test_desligado_ou_sem_provedor_e_4xx_comum(client, falso):
    r = _enviar(client, "oi")
    assert r.status_code == 422 and r.json()["chave"] == "erro.assistente.falta.provedor"
    client.post("/api/assistente/provedores", json={"catalogo": "ollama", "url_base": falso.url, "modelo": "m"})
    r = _enviar(client, "oi")
    assert r.status_code == 409 and r.json()["chave"] == "erro.assistente.desligado"
    assert _pedidos_chat(falso) == []


def test_texto_vazio_e_conversa_inexistente(client, falso):
    _ligar(client, falso)
    assert _enviar(client, "   ").json()["chave"] == "erro.assistente.texto_vazio"
    r = _enviar(client, "oi", conversa_id="nao-existe")
    assert r.status_code == 404 and r.json()["chave"] == "erro.assistente.conversa_inexistente"


# ── conversa ────────────────────────────────────────────────────────────

def test_resposta_em_streaming_e_conversa_guardada(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("Oi", ", posso", " ajudar."))
    ev = _enviar(client, "olá kami", tela="financas")
    assert ev[0]["tipo"] == "inicio" and ev[0]["provedor"] == "Ollama" and ev[0]["modelo"] == "m1" and ev[0]["local"] is True
    assert [e["delta"] for e in ev if e["tipo"] == "texto"] == ["Oi", ", posso", " ajudar."]
    assert ev[-1]["tipo"] == "fim" and ev[-1]["motivo"] == "fim" and ev[-1]["uso_hoje"]["chamadas"] == 1
    cid = ev[0]["conversa_id"]
    c = client.get(f"/api/assistente/conversas/{cid}").json()
    assert c["titulo"] == "olá kami" and c["tela"] == "financas" and c["guardada"] is True
    assert [(m["papel"], m["texto"]) for m in c["mensagens"]] == [("usuario", "olá kami"), ("assistente", "Oi, posso ajudar.")]
    # o que foi pro provedor: instruções + a mensagem, no idioma pedido e com a tela
    enviado = _pedidos_chat(falso)[0]["messages"]
    assert enviado[0]["role"] == "system" and "Brazilian Portuguese" in enviado[0]["content"] and "finances" in enviado[0]["content"]
    assert enviado[1:] == [{"role": "user", "content": "olá kami"}]


def test_continuar_manda_so_o_historico_desta_conversa(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("resposta"))
    outra = _enviar(client, "conversa antiga")[0]["conversa_id"]
    cid = _enviar(client, "primeira")[0]["conversa_id"]
    assert cid != outra
    _enviar(client, "segunda", conversa_id=cid)
    ultima = _pedidos_chat(falso)[-1]["messages"]
    assert [m["content"] for m in ultima[1:]] == ["primeira", "resposta", "segunda"]
    assert all("antiga" not in m["content"] for m in ultima)  # princípio 1


def test_historico_longo_e_cortado_pelo_comeco(client, falso, monkeypatch):
    monkeypatch.setattr(chat, "HISTORICO_MAX_CARACTERES", 30)
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("r" * 10))
    cid = _enviar(client, "a" * 10)[0]["conversa_id"]
    _enviar(client, "b" * 10, conversa_id=cid)
    _enviar(client, "c" * 10, conversa_id=cid)
    ultima = _pedidos_chat(falso)[-1]["messages"]
    assert [m["content"] for m in ultima[1:]] == ["b" * 10, "r" * 10, "c" * 10]


def test_responde_no_idioma_da_interface(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    _enviar(client, "hi", idioma="ja")
    _enviar(client, "hi", idioma="xx")  # desconhecido → português
    sistemas = [p["messages"][0]["content"] for p in _pedidos_chat(falso)]
    assert "Japanese" in sistemas[0] and "Brazilian Portuguese" in sistemas[1]


def test_anthropic_tambem(client, falso):
    _ligar(client, falso, catalogo="anthropic", api_key="sk-ant-x")
    falso.responder("/v1/messages", sse=anthropic_texto("Olá", "!"))
    ev = _enviar(client, "oi")
    assert _texto(ev) == "Olá!" and ev[-1]["uso_hoje"]["tokens"] == 19
    assert _pedidos_chat(falso)[0]["system"].startswith("You are the assistant inside Kami")


# ── erros e interrupções ─────────────────────────────────────────────────

def test_erro_do_provedor_vira_evento_e_resposta_fica_interrompida(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", status=404, json={"error": {"message": "model 'm1' not found"}})
    ev = _enviar(client, "oi")
    assert ev[-1]["tipo"] == "falha" and ev[-1]["chave"] == "erro.assistente.provedor.modelo_indisponivel"
    c = client.get(f"/api/assistente/conversas/{ev[0]['conversa_id']}").json()
    assert c["mensagens"][-1]["interrompida"] is True
    assert c["mensagens"][-1]["erro_chave"] == "erro.assistente.provedor.modelo_indisponivel"


@pytest.fixture()
def servidor(client):
    """O app num uvicorn de verdade: o TestClient junta o corpo inteiro antes
    de devolver, então com ele a tela nunca "fecha a conexão no meio"."""
    import uvicorn

    from app.main import app

    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(200):
        if srv.started:
            break
        time.sleep(0.01)
    porta = srv.servers[0].sockets[0].getsockname()[1]
    yield porta
    srv.should_exit = True
    t.join(5)


def test_parar_no_meio_fecha_a_conexao_e_guarda_o_parcial(client, falso, servidor):
    import http.client

    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto(*[f"p{i} " for i in range(200)]), atraso_pedaco=0.02)
    recebidos = []
    conexao = http.client.HTTPConnection("127.0.0.1", servidor, timeout=10)
    conexao.request("POST", "/api/assistente/mensagens", body=json.dumps({"texto": "conta uma história"}),
                    headers={"Content-Type": "application/json"})
    r = conexao.getresponse()
    while sum(1 for e in recebidos if e["tipo"] == "texto") < 3:
        linha = r.fp.readline().decode()
        if linha.startswith("data: "):
            recebidos.append(json.loads(linha[6:]))
    conexao.sock.shutdown(2)  # a tela fechou a conexão (botão parar)
    conexao.close()
    cid = recebidos[0]["conversa_id"]
    for _ in range(100):  # a thread do chat termina e guarda o parcial
        c = client.get(f"/api/assistente/conversas/{cid}").json()
        if len(c["mensagens"]) == 2:
            break
        time.sleep(0.05)
    resposta = c["mensagens"][-1]
    assert resposta["interrompida"] is True and resposta["erro_chave"] is None
    assert resposta["texto"].startswith("p0 p1 p2") and len(resposta["texto"]) < len("".join(f"p{i} " for i in range(200)))
    # a parte gerada antes do parar também é cobrada: conta (estimada)
    for _ in range(50):
        u = client.get("/api/assistente").json()["uso_hoje"]
        if u["chamadas"] == 1:
            break
        time.sleep(0.05)
    assert u["chamadas"] == 1 and u["estimado"] is True and u["tokens"] > 0
    assert client.get("/api/assistente/envios").json()[0]["tokens_saida"] > 0


def test_pin_bloqueado_no_meio_para_antes_de_chamar(client, falso, monkeypatch):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("x"))
    monkeypatch.setattr(pin, "bloqueado", lambda: True)
    eventos = list(chat.turno(database.get_connection(), None, "oi", "pt", None, chat.transporte.Cancelamento()))
    assert eventos[-1] == {"tipo": "fim", "motivo": "parado", "uso_hoje": eventos[-1]["uso_hoje"]}
    assert _pedidos_chat(falso) == []


def test_teto_na_nuvem_antes_de_abrir(client, falso, monkeypatch):
    original = prov_mod.normalizar_url
    monkeypatch.setattr(prov_mod, "normalizar_url", lambda url: (original(url)[0], False))
    _ligar(client, falso, catalogo="groq", api_key="gsk")
    client.put("/api/assistente/config", json={"teto_chamadas": 1})
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    assert _enviar(client, "um")[-1]["tipo"] == "fim"
    r = _enviar(client, "dois")
    assert r.status_code == 429 and r.json()["chave"] == "erro.assistente.teto.chamadas"
    assert len(_pedidos_chat(falso)) == 1


# ── o que foi enviado (princípio 3) ──────────────────────────────────────

def test_registro_do_que_foi_enviado(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("r1", uso=(30, 4)))
    cid = _enviar(client, "minha pergunta")[0]["conversa_id"]
    _enviar(client, "outra", conversa_id=cid)
    envios = client.get("/api/assistente/envios").json()
    assert len(envios) == 2
    ultimo = envios[0]
    assert ultimo["destino"] == "127.0.0.1" and ultimo["local"] is True and ultimo["modelo"] == "m1"
    assert ultimo["tokens_entrada"] == 30 and ultimo["tokens_saida"] == 4
    assert ultimo["itens"] == [
        {"tipo": "instrucoes", "versao": instrucoes.VERSAO, "idioma": "pt", "tela": None},
        {"tipo": "historico", "mensagens": 2},  # o histórico repetido entra só como contagem
        {"tipo": "mensagem", "texto": "outra"},
    ]
    assert client.delete("/api/assistente/envios").status_code == 204
    assert client.get("/api/assistente/envios").json() == []
    assert client.get(f"/api/assistente/conversas/{cid}").status_code == 200  # conversa fica


def test_chave_da_api_nunca_aparece_no_registro(client, falso, monkeypatch):
    original = prov_mod.normalizar_url
    monkeypatch.setattr(prov_mod, "normalizar_url", lambda url: (original(url)[0], False))
    _ligar(client, falso, catalogo="groq", api_key="gsk-segredo-777")
    falso.responder("/v1/chat/completions", sse=openai_texto("ok"))
    cid = _enviar(client, "oi")[0]["conversa_id"]
    for url in ("/api/assistente/envios", "/api/assistente/conversas", f"/api/assistente/conversas/{cid}"):
        assert "gsk-segredo-777" not in client.get(url).text


# ── guardar ou não (P-105) ───────────────────────────────────────────────

def test_nao_guardar_mantem_so_na_memoria(client, falso, db_conn):
    _ligar(client, falso)
    client.put("/api/assistente/config", json={"guardar_conversas": False})
    falso.responder("/v1/chat/completions", sse=openai_texto("resp"))
    cid = _enviar(client, "segredo meu")[0]["conversa_id"]
    _enviar(client, "de novo", conversa_id=cid)
    assert [m["content"] for m in _pedidos_chat(falso)[-1]["messages"][1:]] == ["segredo meu", "resp", "de novo"]
    lista = client.get("/api/assistente/conversas").json()
    assert [(c["id"], c["guardada"], c["n"]) for c in lista] == [(cid, False, 4)]
    assert len(client.get("/api/assistente/envios").json()) == 2
    for tabela in ("assistente_conversas", "assistente_mensagens", "assistente_envios"):
        assert db_conn.execute(f"SELECT COUNT(*) FROM {tabela}").fetchone()[0] == 0  # nada no disco


def test_apagar_uma_e_apagar_tudo(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("r"))
    a = _enviar(client, "a")[0]["conversa_id"]
    _enviar(client, "b")
    client.put("/api/assistente/config", json={"guardar_conversas": False})
    _enviar(client, "c (memória)")
    assert len(client.get("/api/assistente/conversas").json()) == 3
    assert client.delete(f"/api/assistente/conversas/{a}").status_code == 204
    assert client.delete(f"/api/assistente/conversas/{a}").status_code == 404
    assert len(client.get("/api/assistente/conversas").json()) == 2
    assert client.delete("/api/assistente/conversas").status_code == 204
    assert client.get("/api/assistente/conversas").json() == [] and client.get("/api/assistente/envios").json() == []


def test_conversas_antigas_somem_sozinhas(client, falso, db_conn):
    _ligar(client, falso)
    client.put("/api/assistente/config", json={"dias_historico": 30})
    falso.responder("/v1/chat/completions", sse=openai_texto("r"))
    velha = _enviar(client, "velha")[0]["conversa_id"]
    nova = _enviar(client, "nova")[0]["conversa_id"]
    db_conn.execute("UPDATE assistente_conversas SET updated_at = '2020-01-01T10:00:00-03:00' WHERE id = ?", (velha,))
    db_conn.execute("UPDATE assistente_envios SET created_at = '2020-01-01T10:00:00-03:00' WHERE conversa_id = ?", (velha,))
    db_conn.commit()
    assert [c["id"] for c in client.get("/api/assistente/conversas").json()] == [nova]
    assert db_conn.execute("SELECT COUNT(*) FROM assistente_mensagens WHERE conversa_id = ?", (velha,)).fetchone()[0] == 0
    assert all(e["conversa_id"] == nova for e in client.get("/api/assistente/envios").json())


def test_reset_esquece_tambem_a_memoria(client, falso):
    _ligar(client, falso)
    client.put("/api/assistente/config", json={"guardar_conversas": False})
    falso.responder("/v1/chat/completions", sse=openai_texto("r"))
    _enviar(client, "só na memória")
    assert client.post("/api/sistema/reset", json={"confirmation": "excluir"}).status_code == 200
    assert client.get("/api/assistente/conversas").json() == []


# ── continuar / refazer (retorno do teste da F3) ─────────────────────────

def test_cortada_pelo_limite_de_tokens_fica_interrompida_e_continua_emendada(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("Primeira parte", fim="length"))
    falso.responder("/v1/chat/completions", sse=openai_texto(" e o resto."))
    ev = _enviar(client, "explica o xp")
    assert ev[-1] == {**ev[-1], "tipo": "fim", "motivo": "limite"}
    cid = ev[0]["conversa_id"]
    assert client.get(f"/api/assistente/conversas/{cid}").json()["mensagens"][-1]["interrompida"] is True

    ev = _enviar(client, "", conversa_id=cid, acao="continuar")
    assert _texto(ev) == " e o resto." and ev[-1]["motivo"] == "fim"
    msgs = client.get(f"/api/assistente/conversas/{cid}").json()["mensagens"]
    assert [(m["papel"], m["texto"], m["interrompida"]) for m in msgs] == [
        ("usuario", "explica o xp", False), ("assistente", "Primeira parte e o resto.", False)]
    # o provedor recebeu a resposta cortada + o pedido escondido (não vira mensagem da pessoa)
    ultimo = _pedidos_chat(falso)[-1]["messages"]
    assert ultimo[-2] == {"role": "assistant", "content": "Primeira parte"}
    assert ultimo[-1] == {"role": "user", "content": chat.CONTINUAR}
    envio = client.get("/api/assistente/envios").json()[0]
    assert {"tipo": "continuar"} in envio["itens"]


def test_refazer_troca_a_ultima_resposta_e_repete_a_pergunta(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("um"))
    falso.responder("/v1/chat/completions", sse=openai_texto("dois"))
    falso.responder("/v1/chat/completions", sse=openai_texto("dois, de novo"))
    cid = _enviar(client, "primeira")[0]["conversa_id"]
    _enviar(client, "segunda", conversa_id=cid)
    ev = _enviar(client, "", conversa_id=cid, acao="refazer")
    assert _texto(ev) == "dois, de novo"
    msgs = client.get(f"/api/assistente/conversas/{cid}").json()["mensagens"]
    assert [(m["papel"], m["texto"]) for m in msgs] == [
        ("usuario", "primeira"), ("assistente", "um"), ("usuario", "segunda"), ("assistente", "dois, de novo")]
    enviado = _pedidos_chat(falso)[-1]["messages"]
    assert [m["content"] for m in enviado[1:]] == ["primeira", "um", "segunda"]  # a resposta velha não vai
    assert {"tipo": "mensagem", "texto": "segunda", "refeita": True} in client.get("/api/assistente/envios").json()[0]["itens"]


def test_refazer_funciona_com_conversa_so_na_memoria(client, falso):
    _ligar(client, falso)
    client.put("/api/assistente/config", json={"guardar_conversas": False})
    falso.responder("/v1/chat/completions", sse=openai_texto("a"))
    falso.responder("/v1/chat/completions", sse=openai_texto("b"))
    cid = _enviar(client, "oi")[0]["conversa_id"]
    _enviar(client, "", conversa_id=cid, acao="refazer")
    msgs = client.get(f"/api/assistente/conversas/{cid}").json()["mensagens"]
    assert [m["texto"] for m in msgs] == ["oi", "b"]


def test_continuar_e_refazer_recusam_o_que_nao_da(client, falso):
    _ligar(client, falso)
    falso.responder("/v1/chat/completions", sse=openai_texto("completa"))
    r = _enviar(client, "", acao="refazer")
    assert r.status_code == 409 and r.json()["chave"] == "erro.assistente.nada_pra_refazer"
    cid = _enviar(client, "oi")[0]["conversa_id"]
    r = _enviar(client, "", conversa_id=cid, acao="continuar")  # a resposta não foi cortada
    assert r.status_code == 409 and r.json()["chave"] == "erro.assistente.nada_pra_continuar"
    assert _enviar(client, "", conversa_id=cid, acao="outra").status_code == 422
    assert _enviar(client, "", conversa_id=cid).status_code == 422  # sem texto e sem ação
    # pergunta que passou pelo cuidado nunca vai pro provedor — nem refeita
    cid2 = _enviar(client, "quero me matar")[0]["conversa_id"]
    r = _enviar(client, "", conversa_id=cid2, acao="refazer")
    assert r.status_code == 409
    assert len(_pedidos_chat(falso)) == 1
