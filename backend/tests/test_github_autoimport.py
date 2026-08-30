"""
Testes da importação automática de repositórios do GitHub, disparada ao
salvar o token (PUT /api/organizacao/github-token) — ver
_auto_import_repos em app/routers/organizacao.py.

Cobre os três requisitos:
  1. conectar o token pela primeira vez importa todos os repositórios
     da conta (GET /user/repos), marcados como source='auto' com o
     owner_login da conta dona do token.
  2. trocar o token remove só os repositórios 'auto' da conta anterior
     (repos 'manual' nunca são tocados) e importa os da conta nova.
  3. um repositório já cadastrado manualmente com o mesmo
     repo_full_name nunca é duplicado pela importação automática.

Reaproveita o padrão de mock de urllib.request.urlopen já usado em
test_organizacao.py (ver mock_github_urlopen no conftest.py), só que
com um mock próprio aqui porque a importação faz várias chamadas
diferentes (rate_limit, /user, /user/repos paginado) na mesma
requisição, e cada uma precisa de um corpo de resposta diferente.
"""
import json
import re
import urllib.error
from unittest.mock import MagicMock, patch

URLOPEN_TARGET = "app.routers.organizacao.urllib.request.urlopen"


def _mock_urlopen_factory(login, repos_by_page):
    """
    Mocka urllib.request.urlopen despachando pela URL chamada:
      - .../rate_limit           -> corpo vazio (só a validação do token)
      - .../user                 -> {"login": login}
      - .../user/repos?...page=N -> repos_by_page[N] (lista de repos "crus" da api)
      - qualquer outra (GET /repos/{full_name}, status de repo manual) -> um repo genérico
    """
    def fake_urlopen(req, timeout=8):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if "rate_limit" in url:
            body = {}
        elif url.endswith("/user"):
            body = {"login": login}
        elif "/user/repos" in url:
            m = re.search(r"[?&]page=(\d+)", url)
            page = int(m.group(1)) if m else 1
            body = repos_by_page.get(page, [])
        else:
            body = {"full_name": "unused", "private": False}

        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(body).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = False
        return mock_resp

    return fake_urlopen


def test_connect_token_imports_all_account_repos_as_auto(client):
    with patch(URLOPEN_TARGET, _mock_urlopen_factory("alice", {1: [
        {"full_name": "alice/repo1", "private": False, "language": "Python"},
        {"full_name": "alice/repo2", "private": True},
    ]})):
        resp = client.put("/api/organizacao/github-token", json={"token": "ghp_test"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is True
    assert body["imported_count"] == 2
    assert body["owner_login"] == "alice"
    assert body["import_error"] is None

    repos = client.get("/api/organizacao/github-repos").json()
    by_name = {r["repo_full_name"]: r for r in repos}
    assert by_name["alice/repo1"]["source"] == "auto"
    assert by_name["alice/repo1"]["owner_login"] == "alice"
    assert by_name["alice/repo2"]["source"] == "auto"


def test_switch_token_removes_only_auto_repos_from_previous_account(client):
    # repo manual, cadastrado antes de qualquer token existir
    with patch(URLOPEN_TARGET, _mock_urlopen_factory("alice", {1: []})):
        r = client.post("/api/organizacao/github-repos", json={"repo_full_name": "alice/manual-repo"})
        assert r.status_code == 201

    # conecta token da alice -> importa 2 repos automáticos
    with patch(URLOPEN_TARGET, _mock_urlopen_factory("alice", {1: [
        {"full_name": "alice/repo1", "private": False},
        {"full_name": "alice/repo2", "private": False},
    ]})):
        client.put("/api/organizacao/github-token", json={"token": "ghp_alice"})

    # troca pro token do bob -> repos 'auto' da alice somem, manual permanece
    with patch(URLOPEN_TARGET, _mock_urlopen_factory("bob", {1: [
        {"full_name": "bob/reposb", "private": False},
    ]})):
        resp = client.put("/api/organizacao/github-token", json={"token": "ghp_bob"})

    body = resp.json()
    assert body["imported_count"] == 1
    assert body["removed_count"] == 2
    assert body["owner_login"] == "bob"

    repos = client.get("/api/organizacao/github-repos").json()
    names = {r["repo_full_name"] for r in repos}
    assert names == {"alice/manual-repo", "bob/reposb"}
    by_name = {r["repo_full_name"]: r for r in repos}
    assert by_name["alice/manual-repo"]["source"] == "manual"
    assert by_name["bob/reposb"]["source"] == "auto"


def test_autoimport_never_duplicates_or_overwrites_manual_repo(client):
    with patch(URLOPEN_TARGET, _mock_urlopen_factory("alice", {1: []})):
        r = client.post("/api/organizacao/github-repos", json={"repo_full_name": "alice/kami"})
        assert r.status_code == 201

    with patch(URLOPEN_TARGET, _mock_urlopen_factory("alice", {1: [
        {"full_name": "alice/kami", "private": False},   # mesmo nome do repo manual
        {"full_name": "alice/other", "private": False},
    ]})):
        resp = client.put("/api/organizacao/github-token", json={"token": "ghp_test"})

    body = resp.json()
    assert body["imported_count"] == 1  # só alice/other — alice/kami já existia manual

    repos = client.get("/api/organizacao/github-repos").json()
    assert len(repos) == 2
    by_name = {r["repo_full_name"]: r for r in repos}
    assert by_name["alice/kami"]["source"] == "manual"
    assert by_name["alice/other"]["source"] == "auto"


def test_autoimport_network_failure_still_saves_token_and_keeps_existing_repos(client):
    with patch(URLOPEN_TARGET, _mock_urlopen_factory("alice", {1: [
        {"full_name": "alice/repo1", "private": False},
    ]})):
        client.put("/api/organizacao/github-token", json={"token": "ghp_ok"})

    def flaky(req, timeout=8):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if "rate_limit" in url:
            mock_resp = MagicMock()
            mock_resp.read.return_value = b"{}"
            mock_resp.__enter__.return_value = mock_resp
            mock_resp.__exit__.return_value = False
            return mock_resp
        raise urllib.error.URLError("sem rede")

    with patch(URLOPEN_TARGET, side_effect=flaky):
        resp = client.put("/api/organizacao/github-token", json={"token": "ghp_new"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is True  # token novo foi salvo mesmo com a importação falhando
    assert body["import_error"] is not None

    # repo 'auto' antigo (da conta anterior) preservado — a falha de rede
    # aconteceu ANTES da remoção/reimportação, então nada foi tocado
    repos = client.get("/api/organizacao/github-repos").json()
    names = {r["repo_full_name"] for r in repos}
    assert "alice/repo1" in names


def test_autoimport_token_without_repo_permission_returns_informative_error(client):
    def forbidden(req, timeout=8):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if "rate_limit" in url:
            mock_resp = MagicMock()
            mock_resp.read.return_value = b"{}"
            mock_resp.__enter__.return_value = mock_resp
            mock_resp.__exit__.return_value = False
            return mock_resp
        raise urllib.error.HTTPError(url="x", code=403, msg="forbidden", hdrs=None, fp=None)

    with patch(URLOPEN_TARGET, side_effect=forbidden):
        resp = client.put("/api/organizacao/github-token", json={"token": "ghp_no_repo_scope"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is True
    assert body["imported_count"] is None or body["imported_count"] == 0
    assert "permissão" in body["import_error"]
