"""
Busca global (ORG-03) — app/busca.py e GET /api/busca.
"""
import time

from app.busca import palavras, sem_acento

BASE = "/api/busca"


def _busca(client, q, **extra):
    resp = client.get(BASE, params={"q": q, **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _titulos(client, q, tipo=None):
    return [(r["tipo"], r["titulo"]) for r in _busca(client, q) if tipo is None or r["tipo"] == tipo]


def test_sem_acento_and_words():
    assert sem_acento("Ação ÚNICA çÃo") == "acao unica cao"
    assert sem_acento(None) == ""
    assert palavras("  Conta   de LUZ ") == ["conta", "de", "luz"]


def test_accent_and_case_insensitive_both_ways(client, db_conn):
    db_conn.execute("INSERT INTO goals (id, title, type, target_value) VALUES ('g1', 'Reserva de Emergência', 'livre', 1)")
    db_conn.commit()
    assert ("meta", "Reserva de Emergência") in _titulos(client, "emergencia")
    assert ("meta", "Reserva de Emergência") in _titulos(client, "EMERGÊNCIA")


def test_every_word_must_match_somewhere(client, db_conn):
    db_conn.execute("INSERT INTO fixed_bills (id, name, amount, due_day, categoria) VALUES ('f1', 'Luz', 180, 10, 'casa')")
    db_conn.commit()
    assert ("conta_fixa", "Luz") in _titulos(client, "luz casa")
    assert _titulos(client, "luz carro", "conta_fixa") == []


def test_ranking_title_start_beats_match_in_other_fields(client):
    client.post("/api/organizacao/notas", json={"titulo": "Outra coisa", "conteudo": "falar sobre viagem"})
    client.post("/api/organizacao/notas", json={"titulo": "Viagem pra praia", "conteudo": ""})
    notas = [r for r in _busca(client, "viagem") if r["tipo"] == "nota"]
    assert [n["titulo"] for n in notas] == ["Viagem pra praia", "Outra coisa"]
    assert notas[0]["pontos"] > notas[1]["pontos"]
    assert "viagem" in notas[1]["detalhe"]  # trecho do texto onde achou


def test_note_tags_are_searched_and_markdown_is_plain_in_detail(client):
    client.post("/api/organizacao/notas", json={"titulo": "Pauta", "conteudo": "**importante** e `x`", "tags": ["trabalho"]})
    r = [x for x in _busca(client, "trabalho") if x["tipo"] == "nota"][0]
    assert r["titulo"] == "Pauta" and r["detalhe"] == "importante e x"


def test_locked_note_is_found_by_title_only(client):
    assert client.post("/api/seguranca/pin", json={"pin": "4821"}).status_code == 201
    n = client.post("/api/organizacao/notas", json={"titulo": "Cofre", "conteudo": "senha secreta"}).json()
    client.post(f"/api/organizacao/notas/{n['id']}/trancar")
    assert _titulos(client, "secreta", "nota") == []
    achado = [r for r in _busca(client, "cofre") if r["tipo"] == "nota"][0]
    assert achado["detalhe"] == "" and achado["ref"] == "1"


def test_archived_notes_are_left_out(client):
    n = client.post("/api/organizacao/notas", json={"titulo": "Arquivada velha"}).json()
    client.put(f"/api/organizacao/notas/{n['id']}", json={"arquivada": True})
    assert _titulos(client, "arquivada", "nota") == []


def test_many_sources_and_type_filter(client, db_conn):
    db_conn.executescript("""
        INSERT INTO tracks (id, name, created_at) VALUES ('t1', 'Python avançado', '2026-01-01');
        INSERT INTO milestones (id, track_id, title, status, position) VALUES ('m1', 't1', 'Decorators em Python', 'pendente', 0);
        INSERT INTO links (id, title, url, category) VALUES ('l1', 'Docs Python', 'https://docs.python.org', 'dev');
        INSERT INTO calendar_events (id, title, date, created_at, updated_at) VALUES ('e1', 'Meetup Python', '2026-11-03', '2026-01-01', '2026-01-01');
    """)
    db_conn.commit()
    tipos = {r["tipo"] for r in _busca(client, "python")}
    assert {"trilha", "marco", "link", "evento"} <= tipos
    marco = [r for r in _busca(client, "decorators") if r["tipo"] == "marco"][0]
    assert marco["ref"] == "t1" and marco["detalhe"] == "trilha Python avançado"
    assert {r["tipo"] for r in _busca(client, "python", tipos="link,evento")} == {"link", "evento"}


def test_like_wildcards_are_literal(client, db_conn):
    db_conn.execute("INSERT INTO links (id, title, url, category) VALUES ('l1', 'cem por cento', 'https://a.com', 'x')")
    db_conn.execute("INSERT INTO links (id, title, url, category) VALUES ('l2', '100% garantido', 'https://b.com', 'x')")
    db_conn.commit()
    assert _titulos(client, "%", "link") == [("link", "100% garantido")]
    assert _titulos(client, "_", "link") == []


def test_empty_query_returns_nothing(client):
    assert _busca(client, "   ") == []


def test_limits_per_type(client):
    for i in range(10):
        client.post("/api/organizacao/notas", json={"titulo": f"repetida {i}"})
    assert len([r for r in _busca(client, "repetida") if r["tipo"] == "nota"]) == 6


def test_fast_enough_with_a_big_database(client, db_conn):
    """20 mil lançamentos + 2 mil e-mails: a busca continua instantânea."""
    db_conn.execute("INSERT INTO email_accounts (id, label, imap_host, imap_port, username, app_password_enc) VALUES ('a', 'g', 'h', 993, 'u', 'x')")
    db_conn.executemany(
        "INSERT INTO transactions (id, description, amount, type, category, date) VALUES (?, ?, 10, 'saida', 'mercado', '2026-01-01')",
        [(f"t{i}", f"compra número {i} no mercado") for i in range(20_000)],
    )
    db_conn.executemany(
        "INSERT INTO email_cache (id, account_id, subject, sender, received_at) VALUES (?, 'a', ?, 'loja@x.com', '2026-01-01')",
        [(f"e{i}", f"promoção imperdível {i}") for i in range(2_000)],
    )
    db_conn.commit()
    inicio = time.perf_counter()
    resultado = _busca(client, "promocao")
    tempo = time.perf_counter() - inicio
    assert any(r["tipo"] == "email" for r in resultado)
    assert tempo < 1.0, f"busca levou {tempo:.2f}s"


def test_locked_secret_achievement_is_not_a_spoiler(client, db_conn):
    db_conn.execute(
        "INSERT INTO achievements (id, chave, title, description, criteria_json, secreta, rule_type) "
        "VALUES ('s1', 'teste_secreta', 'Coruja noturna', 'de madrugada', '{}', 1, 'auto')"
    )
    db_conn.commit()
    assert _titulos(client, "coruja", "conquista") == []
    db_conn.execute("UPDATE achievements SET unlocked_at = '2026-01-01' WHERE id = 's1'")
    db_conn.commit()
    assert _titulos(client, "coruja", "conquista") == [("conquista", "Coruja noturna")]


def test_email_shows_sender_name_and_transaction_type_is_readable(client, db_conn):
    db_conn.execute("INSERT INTO email_accounts (id, label, imap_host, imap_port, username, app_password_enc) VALUES ('a', 'g', 'h', 993, 'u', 'x')")
    db_conn.execute("INSERT INTO email_cache (id, account_id, subject, sender, received_at) VALUES ('e1', 'a', 'Oferta', '\"Loja X\" <loja@x.com>', '2026-01-01')")
    db_conn.execute("INSERT INTO transactions (id, description, amount, type, category, date) VALUES ('t1', 'Padaria', 12, 'saida', 'comida', '2026-01-01')")
    db_conn.commit()
    assert [r["detalhe"] for r in _busca(client, "oferta") if r["tipo"] == "email"] == ["Loja X"]
    assert [r["detalhe"] for r in _busca(client, "padaria") if r["tipo"] == "lancamento"] == ["saída · comida"]
