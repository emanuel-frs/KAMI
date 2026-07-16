"""
Testes do router app/routers/metas.py.

Contrato coberto (ver app/routers/metas.py pro detalhe de cada regra):
  GET    /api/metas
  POST   /api/metas
  PUT    /api/metas/{id}
  DELETE /api/metas/{id}
  POST   /api/metas/{id}/contribute
  GET    /api/metas/{id}/contributions

Pontos que DIVERGEM de uma primeira versao deste arquivo de teste (rascunho
anterior, nunca commitado — descartado a favor do contrato real do router):
  - rotas sao /api/metas, nao /api/metas/goals
  - "unit" nao e' campo de entrada — e' sempre DERIVADO do "type"
    (financeira -> money, livre -> count)
  - contribuicao nao aceita "date" manual (o servidor carimba o timestamp)
    nem tem endpoint de exclusao individual de contribuicao
  - XP de conclusao e' XP_GOAL_COMPLETED_BONUS = 30 (nao 50)
  - PUT de meta nao aceita "status" diretamente, e mudar o alvo (target_value)
    NAO recalcula/dispara conclusao automatica — status so muda via /contribute
  - GET /api/metas nao tem filtros de query (?type=/?status=) — a separacao
    ativas/concluidas e' feita no frontend (pages/metas.js), o backend so
    devolve tudo já ordenado (ativas primeiro, por prazo)
"""


def _create_goal(client, title="viagem", type_="financeira", target_value=100, deadline=None):
    payload = {"title": title, "type": type_, "target_value": target_value}
    if deadline is not None:
        payload["deadline"] = deadline
    resp = client.post("/api/metas", json=payload)
    assert resp.status_code == 201
    return resp.json()


def _get_goal(client, goal_id):
    goals = client.get("/api/metas").json()
    return next(g for g in goals if g["id"] == goal_id)


def _metas_xp(client):
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    return attrs["metas"]["current_xp"]


# ── criação ──────────────────────────────────────────────────────────────────

def test_create_goal_starts_ativa_with_zero_progress(client):
    goal = _create_goal(client)
    assert goal["status"] == "ativa"
    assert goal["current_value"] == 0
    assert goal["progress_pct"] == 0
    assert goal["completed_at"] is None


def test_create_goal_derives_unit_from_type(client):
    financeira = _create_goal(client, type_="financeira")
    livre = _create_goal(client, title="leitura", type_="livre", target_value=5)
    assert financeira["unit"] == "money"
    assert livre["unit"] == "count"


def test_create_goal_rejects_academica_type(client):
    resp = client.post(
        "/api/metas", json={"title": "certificado", "type": "academica", "target_value": 1}
    )
    assert resp.status_code == 422


def test_create_goal_rejects_invalid_type(client):
    resp = client.post("/api/metas", json={"title": "x", "type": "invalido", "target_value": 1})
    assert resp.status_code == 422


def test_create_goal_rejects_empty_title(client):
    resp = client.post("/api/metas", json={"title": "   ", "type": "livre", "target_value": 1})
    assert resp.status_code == 422


def test_create_goal_rejects_non_positive_target(client):
    resp = client.post("/api/metas", json={"title": "x", "type": "livre", "target_value": 0})
    assert resp.status_code == 422


def test_create_goal_accepts_optional_deadline(client):
    goal = _create_goal(client, deadline="2027-06-01")
    assert goal["deadline"] == "2027-06-01"


# ── contribuição ─────────────────────────────────────────────────────────────

def test_contribution_updates_current_value_as_sum(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 30})
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 20})

    updated = _get_goal(client, goal["id"])
    assert updated["current_value"] == 50
    assert updated["progress_pct"] == 50
    assert updated["status"] == "ativa"


def test_partial_contribution_credits_normal_xp(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 10, "note": "sobrou do mes"})
    assert _metas_xp(client) == 3  # XP_PER_CONTRIBUTION


def test_reaching_target_marks_goal_as_concluida_and_credits_bonus_xp(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 100})

    updated = _get_goal(client, goal["id"])
    assert updated["status"] == "concluida"
    assert updated["progress_pct"] == 100
    assert updated["completed_at"] is not None
    assert _metas_xp(client) == 30  # XP_GOAL_COMPLETED_BONUS, nao soma com XP_PER_CONTRIBUTION


def test_exceeding_target_still_marks_concluida_with_current_value_capped(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 150})

    updated = _get_goal(client, goal["id"])
    assert updated["status"] == "concluida"
    assert updated["progress_pct"] == 100
    assert updated["current_value"] == 100  # nunca passa do target_value


def test_multiple_contributions_only_last_one_credits_completion_bonus(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 60})  # normal: +3
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 40})  # completa: +30 (nao +3)
    assert _metas_xp(client) == 33


def test_cannot_contribute_to_completed_goal(client):
    goal = _create_goal(client, target_value=50)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 50})

    resp = client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 10})
    assert resp.status_code == 422


def test_contribute_rejects_non_positive_amount(client):
    goal = _create_goal(client, target_value=100)
    resp = client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 0})
    assert resp.status_code == 422


def test_contribute_to_nonexistent_goal_returns_404(client):
    resp = client.post("/api/metas/inexistente/contribute", json={"amount": 10})
    assert resp.status_code == 404


def test_list_contributions_returns_history(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 30, "note": "primeira"})
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 20})

    contributions = client.get(f"/api/metas/{goal['id']}/contributions").json()
    assert len(contributions) == 2
    amounts = sorted(c["amount"] for c in contributions)
    assert amounts == [20, 30]
    assert any(c["note"] == "primeira" for c in contributions)


def test_list_contributions_for_nonexistent_goal_returns_404(client):
    resp = client.get("/api/metas/inexistente/contributions")
    assert resp.status_code == 404


# ── edição ───────────────────────────────────────────────────────────────────

def test_update_goal_edits_title_target_and_deadline(client):
    goal = _create_goal(client, target_value=100)
    resp = client.put(
        f"/api/metas/{goal['id']}",
        json={"title": "viagem 2027", "target_value": 200, "deadline": "2027-01-01"},
    )
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["title"] == "viagem 2027"
    assert updated["target_value"] == 200
    assert updated["deadline"] == "2027-01-01"


def test_update_goal_changing_type_recomputes_unit(client):
    goal = _create_goal(client, type_="financeira", target_value=100)
    resp = client.put(f"/api/metas/{goal['id']}", json={"type": "livre"})
    assert resp.status_code == 200
    assert resp.json()["type"] == "livre"
    assert resp.json()["unit"] == "count"


def test_update_goal_clear_deadline(client):
    goal = _create_goal(client, target_value=100, deadline="2027-01-01")
    resp = client.put(f"/api/metas/{goal['id']}", json={"clear_deadline": True})
    assert resp.status_code == 200
    assert resp.json()["deadline"] is None


def test_update_goal_lowering_target_does_not_auto_complete(client):
    # mudar o alvo so muda o alvo — status so muda via /contribute
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 40})

    resp = client.put(f"/api/metas/{goal['id']}", json={"target_value": 40})
    assert resp.status_code == 200
    assert resp.json()["target_value"] == 40
    assert resp.json()["status"] == "ativa"


def test_update_goal_rejects_invalid_type(client):
    goal = _create_goal(client)
    resp = client.put(f"/api/metas/{goal['id']}", json={"type": "invalido"})
    assert resp.status_code == 422


def test_update_goal_rejects_non_positive_target(client):
    goal = _create_goal(client)
    resp = client.put(f"/api/metas/{goal['id']}", json={"target_value": 0})
    assert resp.status_code == 422


def test_update_goal_rejects_empty_title(client):
    goal = _create_goal(client)
    resp = client.put(f"/api/metas/{goal['id']}", json={"title": "   "})
    assert resp.status_code == 422


def test_update_goal_not_found_returns_404(client):
    resp = client.put("/api/metas/inexistente", json={"title": "x"})
    assert resp.status_code == 404


# ── exclusão ─────────────────────────────────────────────────────────────────

def test_delete_goal_removes_it(client):
    goal = _create_goal(client)
    resp = client.delete(f"/api/metas/{goal['id']}")
    assert resp.status_code == 204

    remaining_ids = [g["id"] for g in client.get("/api/metas").json()]
    assert goal["id"] not in remaining_ids


def test_delete_goal_cascades_contributions(client):
    goal = _create_goal(client, target_value=100)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 10})
    client.delete(f"/api/metas/{goal['id']}")

    # a própria meta sumiu, então o histórico dela vira 404 (a meta é
    # checada antes da consulta às contribuições)
    resp = client.get(f"/api/metas/{goal['id']}/contributions")
    assert resp.status_code == 404


def test_delete_goal_not_found_returns_404(client):
    resp = client.delete("/api/metas/inexistente")
    assert resp.status_code == 404


# ── listagem / ordenação ─────────────────────────────────────────────────────

def test_list_goals_orders_active_before_completed(client):
    done = _create_goal(client, title="a concluir", target_value=10)
    client.post(f"/api/metas/{done['id']}/contribute", json={"amount": 10})
    _create_goal(client, title="ainda ativa", target_value=50)

    statuses = [g["status"] for g in client.get("/api/metas").json()]
    assert statuses.index("ativa") < statuses.index("concluida")


def test_list_goals_orders_active_by_deadline_with_no_deadline_last(client):
    _create_goal(client, title="sem prazo", target_value=10)
    _create_goal(client, title="prazo proximo", target_value=10, deadline="2026-08-01")

    titles = [g["title"] for g in client.get("/api/metas").json() if g["status"] == "ativa"]
    assert titles.index("prazo proximo") < titles.index("sem prazo")


# ── integração com achievements ──────────────────────────────────────────────

def test_completing_first_goal_unlocks_quest_achievement(client):
    # NOTA: assume GET /api/nucleo/achievements (não confirmado nesta sessão,
    # já que app/routers/nucleo.py não foi compartilhado) — se o path real
    # for outro, ajuste só esta linha.
    goal = _create_goal(client, target_value=10)
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 10})

    achievements = client.get("/api/nucleo/achievements").json()
    quest = next(a for a in achievements if a["title"] == "quest concluída")
    assert quest["unlocked_at"] is not None