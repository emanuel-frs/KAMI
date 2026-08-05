"""
Testes do router app/routers/organizacao.py.

Chamadas reais de rede (GitHub via urllib, e-mail via imaplib) são sempre
mockadas — ver fixtures `mock_github_urlopen` e `mock_imap` no conftest.py.
"""
import datetime
from email.message import EmailMessage


def _raw_email(subject, sender, date=None):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["Date"] = date or "Tue, 10 Mar 2026 10:00:00 +0000"
    msg.set_content("corpo do e-mail")
    return msg.as_bytes()


# ==================== links ====================


def test_create_link_credits_xp(client):
    resp = client.post(
        "/api/organizacao/links",
        json={"title": "docs FastAPI", "url": "https://fastapi.tiangolo.com", "category": "dev"},
    )
    assert resp.status_code == 201

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["organizacao"]["current_xp"] == 2  # XP_LINK_ADD


def test_list_links_filters_by_category(client):
    client.post("/api/organizacao/links", json={"title": "a", "url": "https://a.com", "category": "dev"})
    client.post("/api/organizacao/links", json={"title": "b", "url": "https://b.com", "category": "lazer"})

    resp = client.get("/api/organizacao/links", params={"category": "dev"})
    body = resp.json()
    assert len(body) == 1
    assert body[0]["title"] == "a"


def test_delete_link_not_found_returns_404(client):
    resp = client.delete("/api/organizacao/links/inexistente")
    assert resp.status_code == 404


# ==================== github ====================


def test_create_github_repo_success_credits_xp_and_caches_status(client, mock_github_urlopen):
    mock_github_urlopen(
        json_body={
            "full_name": "emanuel/kami",
            "description": "app pessoal",
            "stargazers_count": 3,
            "open_issues_count": 1,
            "default_branch": "main",
            "pushed_at": "2026-03-01T10:00:00Z",
            "html_url": "https://github.com/emanuel/kami",
        }
    )

    resp = client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/kami"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["cached_status"]["stargazers_count"] == 3
    assert body["sync_error"] is None
    assert body["last_synced_at"] is not None

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["organizacao"]["current_xp"] == 2  # XP_GITHUB_SYNC


def test_create_github_repo_not_found_404_from_github_does_not_credit_xp(client, mock_github_urlopen):
    mock_github_urlopen(http_error_code=404)

    resp = client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/naoexiste"})
    assert resp.status_code == 201  # o recurso é criado mesmo com erro de sync
    body = resp.json()
    assert body["cached_status"] is None
    assert "não encontrado" in body["sync_error"]
    assert body["last_synced_at"] is None

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["organizacao"]["current_xp"] == 0


def test_create_github_repo_rate_limited_403(client, mock_github_urlopen):
    mock_github_urlopen(http_error_code=403)

    resp = client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/kami"})
    assert resp.status_code == 201
    assert "rate limit" in resp.json()["sync_error"]


def test_create_github_repo_network_failure(client, mock_github_urlopen):
    mock_github_urlopen(url_error=True)

    resp = client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/kami"})
    assert resp.status_code == 201
    assert "sem conexão" in resp.json()["sync_error"]


def test_create_duplicate_github_repo_returns_422(client, mock_github_urlopen):
    mock_github_urlopen(json_body={"full_name": "emanuel/kami"})
    client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/kami"})

    resp = client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/kami"})
    assert resp.status_code == 422


def test_sync_github_repo_success_updates_cache_and_credits_xp(client, mock_github_urlopen):
    mock_github_urlopen(json_body={"full_name": "emanuel/kami", "stargazers_count": 1})
    repo = client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/kami"}).json()

    mock_github_urlopen(json_body={"full_name": "emanuel/kami", "stargazers_count": 5})
    resp = client.put(f"/api/organizacao/github-repos/{repo['id']}/sync")
    assert resp.status_code == 200
    assert resp.json()["cached_status"]["stargazers_count"] == 5

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["organizacao"]["current_xp"] == 4  # 2 (create) + 2 (sync)


def test_sync_github_repo_error_keeps_previous_cache(client, mock_github_urlopen):
    mock_github_urlopen(json_body={"full_name": "emanuel/kami", "stargazers_count": 1})
    repo = client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/kami"}).json()

    mock_github_urlopen(url_error=True)
    resp = client.put(f"/api/organizacao/github-repos/{repo['id']}/sync")
    assert resp.status_code == 200
    body = resp.json()
    assert body["cached_status"]["stargazers_count"] == 1  # cache antigo preservado
    assert body["sync_error"] is not None

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["organizacao"]["current_xp"] == 2  # não creditou de novo


def test_sync_github_repo_not_found_returns_404(client):
    resp = client.put("/api/organizacao/github-repos/inexistente/sync")
    assert resp.status_code == 404


def test_delete_github_repo(client, mock_github_urlopen):
    mock_github_urlopen(json_body={"full_name": "emanuel/kami"})
    repo = client.post("/api/organizacao/github-repos", json={"repo_full_name": "emanuel/kami"}).json()

    resp = client.delete(f"/api/organizacao/github-repos/{repo['id']}")
    assert resp.status_code == 204
    assert client.get("/api/organizacao/github-repos").json() == []


# ==================== e-mail / imap ====================


def test_create_email_account_never_returns_password(client, isolated_fernet_key):
    resp = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail pessoal",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "senha-de-app-secreta",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "app_password" not in body
    assert "app_password_enc" not in body


def test_list_email_accounts_never_returns_password(client, isolated_fernet_key):
    client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "secreta",
        },
    )
    resp = client.get("/api/organizacao/email-accounts")
    assert resp.status_code == 200
    for account in resp.json():
        assert "app_password" not in account
        assert "app_password_enc" not in account


def test_sync_email_account_success_caches_new_messages_and_credits_xp(
    client, isolated_fernet_key, mock_imap
):
    account = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "secreta",
        },
    ).json()

    mock_imap(
        messages=[
            _raw_email("Fatura de março", "banco@exemplo.com"),
            _raw_email("Newsletter", "news@exemplo.com"),
        ]
    )

    resp = client.post(f"/api/organizacao/email-accounts/{account['id']}/sync")
    assert resp.status_code == 200
    body = resp.json()
    assert body["new_messages"] == 2

    cached = client.get("/api/organizacao/email-cache").json()
    assert len(cached) == 2
    subjects = {e["subject"] for e in cached}
    assert subjects == {"Fatura de março", "Newsletter"}
    assert all(e["is_read"] is False for e in cached)

    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["organizacao"]["current_xp"] == 3  # XP_EMAIL_SYNC


def test_sync_email_account_dedupes_already_cached_messages(client, isolated_fernet_key, mock_imap):
    account = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "secreta",
        },
    ).json()

    same_email = _raw_email("Mesmo assunto", "remetente@exemplo.com", date="Tue, 10 Mar 2026 10:00:00 +0000")

    mock_imap(messages=[same_email])
    first_sync = client.post(f"/api/organizacao/email-accounts/{account['id']}/sync").json()
    assert first_sync["new_messages"] == 1

    # segunda sincronização traz a MESMA mensagem (mesmo assunto/remetente/data) — deve deduplicar
    mock_imap(messages=[same_email])
    second_sync = client.post(f"/api/organizacao/email-accounts/{account['id']}/sync").json()
    assert second_sync["new_messages"] == 0

    cached = client.get("/api/organizacao/email-cache").json()
    assert len(cached) == 1


def test_sync_email_account_login_error_returns_422(client, isolated_fernet_key, mock_imap):
    account = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "senha-errada",
        },
    ).json()

    mock_imap(login_error=True)
    resp = client.post(f"/api/organizacao/email-accounts/{account['id']}/sync")
    assert resp.status_code == 422
    assert "autenticar" in resp.json()["detail"]

    # não deve creditar XP em falha de autenticação
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    assert attrs["organizacao"]["current_xp"] == 0


def test_sync_email_account_connection_error_returns_422(client, isolated_fernet_key, mock_imap):
    account = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.host.invalido",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "secreta",
        },
    ).json()

    mock_imap(connect_error=True)
    resp = client.post(f"/api/organizacao/email-accounts/{account['id']}/sync")
    assert resp.status_code == 422
    assert "conectar" in resp.json()["detail"]


def test_sync_email_account_not_found_returns_404(client):
    resp = client.post("/api/organizacao/email-accounts/inexistente/sync")
    assert resp.status_code == 404


def test_sync_email_with_corrupted_password_returns_422(client, isolated_fernet_key, db_conn):
    # cria a conta com senha válida, depois corrompe app_password_enc direto no banco
    account = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "secreta",
        },
    ).json()
    db_conn.execute(
        "UPDATE email_accounts SET app_password_enc = 'token-corrompido' WHERE id = ?",
        (account["id"],),
    )
    db_conn.commit()

    resp = client.post(f"/api/organizacao/email-accounts/{account['id']}/sync")
    assert resp.status_code == 422
    assert "decriptar" in resp.json()["detail"]


def test_delete_email_account_cascades_cache(client, isolated_fernet_key, mock_imap):
    account = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "secreta",
        },
    ).json()
    mock_imap(messages=[_raw_email("assunto", "remetente@exemplo.com")])
    client.post(f"/api/organizacao/email-accounts/{account['id']}/sync")

    resp = client.delete(f"/api/organizacao/email-accounts/{account['id']}")
    assert resp.status_code == 204

    cached = client.get("/api/organizacao/email-cache").json()
    assert cached == []


def test_mark_email_read(client, isolated_fernet_key, mock_imap):
    account = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "secreta",
        },
    ).json()
    mock_imap(messages=[_raw_email("assunto", "remetente@exemplo.com")])
    client.post(f"/api/organizacao/email-accounts/{account['id']}/sync")

    email_entry = client.get("/api/organizacao/email-cache").json()[0]
    resp = client.put(f"/api/organizacao/email-cache/{email_entry['id']}/read")
    assert resp.status_code == 200
    assert resp.json()["is_read"] is True


def test_mark_email_read_not_found_returns_404(client):
    resp = client.put("/api/organizacao/email-cache/inexistente/read")
    assert resp.status_code == 404


def test_list_email_cache_filters_by_is_read(client, isolated_fernet_key, mock_imap):
    account = client.post(
        "/api/organizacao/email-accounts",
        json={
            "label": "gmail",
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "username": "eu@gmail.com",
            "app_password": "secreta",
        },
    ).json()
    mock_imap(
        messages=[
            _raw_email("lido", "a@exemplo.com"),
            _raw_email("não lido", "b@exemplo.com"),
        ]
    )
    client.post(f"/api/organizacao/email-accounts/{account['id']}/sync")

    cached = client.get("/api/organizacao/email-cache").json()
    lido = next(e for e in cached if e["subject"] == "lido")
    client.put(f"/api/organizacao/email-cache/{lido['id']}/read")

    unread = client.get("/api/organizacao/email-cache", params={"is_read": False}).json()
    assert len(unread) == 1
    assert unread[0]["subject"] == "não lido"


# ==================== busca (tavily) ====================
# reaproveita mock_github_urlopen: ele mocka
# app.routers.organizacao.urllib.request.urlopen, que é exatamente o
# que _tavily_request usa também — não precisa de um fixture próprio.


def test_search_key_status_defaults_to_not_configured(client):
    resp = client.get("/api/organizacao/search-key")
    assert resp.status_code == 200
    assert resp.json() == {"configured": False}


def test_save_search_key_validates_against_api_before_saving(
    client, isolated_fernet_key, mock_github_urlopen
):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    resp = client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc123"})
    assert resp.status_code == 200
    assert resp.json() == {"configured": True}
    assert client.get("/api/organizacao/search-key").json() == {"configured": True}


def test_save_search_key_invalid_key_returns_422_and_does_not_save(
    client, isolated_fernet_key, mock_github_urlopen
):
    mock_github_urlopen(http_error_code=401)
    resp = client.put("/api/organizacao/search-key", json={"api_key": "chave-ruim"})
    assert resp.status_code == 422
    assert client.get("/api/organizacao/search-key").json() == {"configured": False}


def test_save_search_key_empty_returns_422(client):
    resp = client.put("/api/organizacao/search-key", json={"api_key": "   "})
    assert resp.status_code == 422


def test_delete_search_key(client, isolated_fernet_key, mock_github_urlopen):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc123"})
    resp = client.delete("/api/organizacao/search-key")
    assert resp.status_code == 204
    assert client.get("/api/organizacao/search-key").json() == {"configured": False}


def test_search_without_key_configured_returns_422(client):
    resp = client.get("/api/organizacao/search", params={"q": "python"})
    assert resp.status_code == 422


def test_search_returns_answer_and_results(client, isolated_fernet_key, mock_github_urlopen):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})  # validação da chave
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc123"})

    mock_github_urlopen(
        json_body={
            "answer": "python é uma linguagem de programação.",
            "results": [
                {"title": "Python", "url": "https://python.org", "content": "site oficial"},
                {"title": "", "url": "https://exemplo.com/py", "content": None},
            ],
        }
    )
    resp = client.get("/api/organizacao/search", params={"q": "python"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["query"] == "python"
    assert body["answer"] == "python é uma linguagem de programação."
    assert len(body["results"]) == 2
    assert body["results"][0] == {
        "title": "Python", "url": "https://python.org", "snippet": "site oficial",
    }
    # sem título vindo da api: cai pra própria url
    assert body["results"][1]["title"] == "https://exemplo.com/py"


def test_search_empty_query_returns_422(client, isolated_fernet_key, mock_github_urlopen):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc123"})

    resp = client.get("/api/organizacao/search", params={"q": "   "})
    assert resp.status_code == 422


def test_search_invalid_key_returns_422(client, isolated_fernet_key, mock_github_urlopen):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc123"})

    mock_github_urlopen(http_error_code=401)
    resp = client.get("/api/organizacao/search", params={"q": "python"})
    assert resp.status_code == 422


def test_search_rate_limited_returns_422(client, isolated_fernet_key, mock_github_urlopen):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc123"})

    mock_github_urlopen(http_error_code=432)
    resp = client.get("/api/organizacao/search", params={"q": "python"})
    assert resp.status_code == 422


def test_search_network_failure_returns_502(client, isolated_fernet_key, mock_github_urlopen):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc123"})

    mock_github_urlopen(url_error=True)
    resp = client.get("/api/organizacao/search", params={"q": "python"})
    assert resp.status_code == 502


def test_search_corrupted_key_returns_422(client, isolated_fernet_key, mock_github_urlopen, db_conn):
    mock_github_urlopen(json_body={"answer": "ok", "results": []})
    client.put("/api/organizacao/search-key", json={"api_key": "tvly-abc123"})

    db_conn.execute("UPDATE search_settings SET api_key_enc = 'lixo-corrompido'")
    db_conn.commit()

    resp = client.get("/api/organizacao/search", params={"q": "python"})
    assert resp.status_code == 422