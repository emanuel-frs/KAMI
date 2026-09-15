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
    (financeira -> money, todo o resto -> count)
  - contribuicao nao aceita "date" manual (o servidor carimba o timestamp)
    nem tem endpoint de exclusao individual de contribuicao
  - XP de conclusao e' XP_GOAL_COMPLETED_BONUS = 30 (nao 50), multiplicado
    pelo peso (GOAL_WEIGHTS) — 30 na maioria dos testes aqui porque o peso
    default e' 'medio' (1x)
  - PUT de meta nao aceita "status" diretamente, e mudar o alvo (target_value)
    NAO recalcula/dispara conclusao automatica — status so muda via /contribute
  - GET /api/metas nao tem filtros de query (?type=/?status=) — a separacao
    ativas/concluidas e' feita no frontend (pages/metas.js), o backend so
    devolve tudo já ordenado (ativas primeiro, por prazo)

v2 — tipos novos, peso, vínculo com Finanças/Aprendizado (ver docstring do
router pro contrato completo). O default de `_create_goal` mudou de
'financeira' pra 'livre': testes genéricos de contribuição não precisam mais
lidar com a exigência de `origem` que só se aplica a metas financeiras — os
testes que testam especificamente 'financeira' continuam passando o tipo
explícito.
"""


def _create_goal(client, title="viagem", type_="livre", target_value=100, deadline=None, **extra):
    payload = {"title": title, "type": type_, "target_value": target_value, **extra}
    if deadline is not None:
        payload["deadline"] = deadline
    resp = client.post("/api/metas", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get_goal(client, goal_id):
    goals = client.get("/api/metas").json()
    return next(g for g in goals if g["id"] == goal_id)


def _metas_xp(client):
    attrs = {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}
    return attrs["metas"]["current_xp"]


def _create_account(client, nome="conta teste", saldo_atual=100):
    """Cria um banco novo + uma conta com saldo, pros testes de conexão com Finanças."""
    bank = client.post("/api/carteira/banks", json={"nome": f"banco {nome}"}).json()
    resp = client.post(
        f"/api/carteira/banks/{bank['id']}/accounts",
        json={"nome": nome, "possui_saldo": True, "saldo_atual": saldo_atual, "possui_credito": False},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_track(client, name="Rust"):
    resp = client.post("/api/aprendizado/tracks", json={"name": name})
    assert resp.status_code == 201
    return resp.json()


def _create_milestone(client, track_id, title="ler o livro"):
    resp = client.post(f"/api/aprendizado/tracks/{track_id}/milestones", json={"title": title})
    assert resp.status_code == 201
    return resp.json()


def _complete_milestone(client, milestone_id):
    resp = client.put(f"/api/aprendizado/milestones/{milestone_id}", json={"status": "concluido"})
    assert resp.status_code == 200
    return resp.json()


def _create_education(client, curso="ciência da computação", instituicao="USP", nivel="graduacao", **extra):
    payload = {"curso": curso, "instituicao": instituicao, "nivel": nivel, **extra}
    resp = client.post("/api/carreira/formacoes", json=payload)
    assert resp.status_code == 201
    return resp.json()


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


def test_completing_five_goals_unlocks_colecionador_de_metas(client):
    for i in range(5):
        goal = _create_goal(client, title=f"meta {i}", target_value=10)
        client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 10})

    achievements = client.get("/api/nucleo/achievements").json()
    unlocked_titles = {a["title"] for a in achievements if a["unlocked"]}
    assert "colecionador de metas" in unlocked_titles


# ── tipos novos (v2) ─────────────────────────────────────────────────────────

def test_create_goal_accepts_new_types_with_unit_label(client):
    for type_ in ("saude", "leitura", "habito"):
        goal = _create_goal(client, title=type_, type_=type_, target_value=10, unit_label="unidades")
        assert goal["unit"] == "count"
        assert goal["unit_label"] == "unidades"


def test_financeira_ignores_unit_label(client):
    goal = _create_goal(client, type_="financeira", target_value=100, unit_label="kg")
    assert goal["unit_label"] is None


def test_new_type_contribution_works_like_livre(client):
    goal = _create_goal(client, type_="habito", target_value=3, unit_label="vezes")
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 1})
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 2})
    updated = _get_goal(client, goal["id"])
    assert updated["current_value"] == 3
    assert updated["status"] == "concluida"


# ── peso / multiplicador de xp (v2) ─────────────────────────────────────────

def test_create_goal_defaults_to_medio_weight(client):
    goal = _create_goal(client)
    assert goal["weight"] == "medio"


def test_create_goal_rejects_invalid_weight(client):
    resp = client.post(
        "/api/metas", json={"title": "x", "type": "livre", "target_value": 1, "weight": "invalido"}
    )
    assert resp.status_code == 422


def test_weight_multiplies_contribution_and_completion_xp(client):
    goal = _create_goal(client, target_value=100, weight="epico")  # 3x
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 40})  # 3 * 3 = 9
    assert _metas_xp(client) == 9
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 60})  # completa: 30 * 3 = 90
    assert _metas_xp(client) == 99


def test_low_weight_rounds_xp(client):
    goal = _create_goal(client, target_value=10, weight="baixo")  # 0.5x
    client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 10})  # completa: round(30*0.5) = 15
    assert _metas_xp(client) == 15


# ── conexão com Finanças (v2) ────────────────────────────────────────────────

def test_financeira_contribute_requires_origem(client):
    goal = _create_goal(client, type_="financeira", target_value=100)
    resp = client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 10})
    assert resp.status_code == 422


def test_financeira_contribute_externo_does_not_touch_account(client):
    account = _create_account(client, saldo_atual=500)
    goal = _create_goal(client, type_="financeira", target_value=100, linked_conta_id=account["id"])
    resp = client.post(
        f"/api/metas/{goal['id']}/contribute", json={"amount": 50, "origem": "externo"}
    )
    assert resp.status_code == 200

    account_after = client.get("/api/carteira/banks").json()[0]["accounts"][0]
    assert account_after["saldo_atual"] == 500  # não mexeu

    contributions = client.get(f"/api/metas/{goal['id']}/contributions").json()
    assert contributions[0]["origem"] == "externo"
    assert contributions[0]["transaction_id"] is None


def test_financeira_contribute_conta_creates_real_transaction(client):
    account = _create_account(client, saldo_atual=500)
    goal = _create_goal(client, type_="financeira", target_value=100)
    resp = client.post(
        f"/api/metas/{goal['id']}/contribute",
        json={"amount": 50, "origem": "conta", "conta_id": account["id"]},
    )
    assert resp.status_code == 200

    account_after = client.get("/api/carteira/banks").json()[0]["accounts"][0]
    assert account_after["saldo_atual"] == 450  # debitou

    contributions = client.get(f"/api/metas/{goal['id']}/contributions").json()
    assert contributions[0]["origem"] == "conta"
    assert contributions[0]["transaction_id"] is not None

    month = contributions[0]["date"][:7]
    transactions = client.get(f"/api/financas/transactions?month={month}").json()
    tx = next(t for t in transactions if t["id"] == contributions[0]["transaction_id"])
    assert tx["type"] == "saida"
    assert tx["category"] == "metas"
    assert tx["conta_id"] == account["id"]


def test_financeira_contribute_conta_falls_back_to_linked_conta(client):
    account = _create_account(client, saldo_atual=500)
    goal = _create_goal(client, type_="financeira", target_value=100, linked_conta_id=account["id"])
    resp = client.post(
        f"/api/metas/{goal['id']}/contribute", json={"amount": 50, "origem": "conta"}
    )
    assert resp.status_code == 200
    account_after = client.get("/api/carteira/banks").json()[0]["accounts"][0]
    assert account_after["saldo_atual"] == 450


def test_financeira_contribute_conta_rejects_insufficient_balance(client):
    account = _create_account(client, saldo_atual=10)
    goal = _create_goal(client, type_="financeira", target_value=100)
    resp = client.post(
        f"/api/metas/{goal['id']}/contribute",
        json={"amount": 50, "origem": "conta", "conta_id": account["id"]},
    )
    assert resp.status_code == 422


def test_financeira_contribute_conta_without_any_account_returns_422(client):
    goal = _create_goal(client, type_="financeira", target_value=100)
    resp = client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 10, "origem": "conta"})
    assert resp.status_code == 422


def test_deleting_goal_keeps_real_transaction_in_financas(client):
    account = _create_account(client, saldo_atual=500)
    goal = _create_goal(client, type_="financeira", target_value=100)
    client.post(
        f"/api/metas/{goal['id']}/contribute",
        json={"amount": 50, "origem": "conta", "conta_id": account["id"]},
    )
    month = __import__("datetime").date.today().isoformat()[:7]
    tx_before = client.get(f"/api/financas/transactions?month={month}").json()
    assert len(tx_before) == 1

    client.delete(f"/api/metas/{goal['id']}")

    tx_after = client.get(f"/api/financas/transactions?month={month}").json()
    assert len(tx_after) == 1  # a transação real continua existindo


# ── conexão com Aprendizado (v2) ─────────────────────────────────────────────

def test_aprendizado_goal_requires_linked_track(client):
    resp = client.post(
        "/api/metas", json={"title": "terminar rust", "type": "aprendizado", "target_value": 3}
    )
    assert resp.status_code == 422


def test_aprendizado_goal_backfills_progress_from_existing_milestones(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])
    _create_milestone(client, track["id"], title="segundo marco")
    _complete_milestone(client, m1["id"])

    goal = _create_goal(client, type_="aprendizado", target_value=2, linked_track_id=track["id"])
    assert goal["current_value"] == 1
    assert goal["status"] == "ativa"


def test_aprendizado_goal_progresses_automatically_and_completes(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])
    m2 = _create_milestone(client, track["id"], title="segundo marco")
    goal = _create_goal(client, type_="aprendizado", target_value=2, linked_track_id=track["id"])

    _complete_milestone(client, m1["id"])
    assert _get_goal(client, goal["id"])["current_value"] == 1
    assert _get_goal(client, goal["id"])["status"] == "ativa"

    _complete_milestone(client, m2["id"])
    updated = _get_goal(client, goal["id"])
    assert updated["current_value"] == 2
    assert updated["status"] == "concluida"
    assert _metas_xp(client) == 30  # bônus de conclusão, peso medio


def test_aprendizado_goal_does_not_uncomplete_when_milestone_reopened(client):
    track = _create_track(client)
    m1 = _create_milestone(client, track["id"])
    goal = _create_goal(client, type_="aprendizado", target_value=1, linked_track_id=track["id"])
    _complete_milestone(client, m1["id"])
    assert _get_goal(client, goal["id"])["status"] == "concluida"

    client.put(f"/api/aprendizado/milestones/{m1['id']}", json={"status": "pendente"})
    assert _get_goal(client, goal["id"])["status"] == "concluida"


def test_aprendizado_goal_rejects_manual_contribution(client):
    track = _create_track(client)
    goal = _create_goal(client, type_="aprendizado", target_value=1, linked_track_id=track["id"])
    resp = client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 1})
    assert resp.status_code == 422


# ── conexão com Carreira (v3 — Parte 3) ──────────────────────────────────────

def test_academica_goal_requires_linked_education(client):
    resp = client.post(
        "/api/metas", json={"title": "terminar mestrado", "type": "academica", "target_value": 1}
    )
    assert resp.status_code == 422


def test_academica_goal_rejects_unknown_education(client):
    resp = client.post(
        "/api/metas",
        json={"title": "x", "type": "academica", "target_value": 1, "linked_education_id": "does-not-exist"},
    )
    assert resp.status_code == 422


def test_academica_goal_backfills_progress_when_education_already_concluded(client):
    education = _create_education(client, status="concluido")

    goal = _create_goal(client, type_="academica", target_value=1, linked_education_id=education["id"])
    assert goal["current_value"] == 1
    assert goal["status"] == "concluida"


def test_academica_goal_stays_at_zero_while_education_in_progress(client):
    education = _create_education(client)  # em_andamento
    goal = _create_goal(client, type_="academica", target_value=1, linked_education_id=education["id"])
    assert goal["current_value"] == 0
    assert goal["status"] == "ativa"


def test_academica_goal_completes_when_education_concludes(client):
    education = _create_education(client)
    goal = _create_goal(client, type_="academica", target_value=1, linked_education_id=education["id"])

    client.put(f"/api/carreira/formacoes/{education['id']}", json={"status": "concluido"})

    updated = _get_goal(client, goal["id"])
    assert updated["current_value"] == 1
    assert updated["status"] == "concluida"
    assert _metas_xp(client) == 30  # bônus de conclusão, peso medio


def test_academica_goal_does_not_uncomplete_when_education_reopened(client):
    education = _create_education(client)
    goal = _create_goal(client, type_="academica", target_value=1, linked_education_id=education["id"])
    client.put(f"/api/carreira/formacoes/{education['id']}", json={"status": "concluido"})
    assert _get_goal(client, goal["id"])["status"] == "concluida"

    client.put(f"/api/carreira/formacoes/{education['id']}", json={"status": "em_andamento"})
    assert _get_goal(client, goal["id"])["status"] == "concluida"


def test_academica_goal_rejects_manual_contribution(client):
    education = _create_education(client)
    goal = _create_goal(client, type_="academica", target_value=1, linked_education_id=education["id"])
    resp = client.post(f"/api/metas/{goal['id']}/contribute", json={"amount": 1})
    assert resp.status_code == 422


def test_academica_goal_shows_linked_education_name(client):
    education = _create_education(client, curso="mestrado em IA")
    goal = _create_goal(client, type_="academica", target_value=1, linked_education_id=education["id"])
    assert goal["linked_education_name"] == "mestrado em IA"


def test_deleting_education_sets_linked_goal_education_id_to_null(client):
    education = _create_education(client)
    goal = _create_goal(client, type_="academica", target_value=1, linked_education_id=education["id"])

    client.delete(f"/api/carreira/formacoes/{education['id']}")

    updated = _get_goal(client, goal["id"])
    assert updated["linked_education_id"] is None
    assert updated["linked_education_name"] is None