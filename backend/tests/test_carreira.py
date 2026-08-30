"""Testes do router app/routers/carreira.py."""
import datetime


def _attrs(client):
    return {a["name"]: a for a in client.get("/api/nucleo/attributes").json()}


def _create_position(client, company="Acme Ltda", role="dev backend", start_date="2020-01-01", **extra):
    payload = {"company": company, "role": role, "start_date": start_date, **extra}
    resp = client.post("/api/carreira/posicoes", json=payload)
    assert resp.status_code == 201
    return resp.json()


# ---------------- perfil (área atual / área-meta) — Parte 1 ----------------

def test_get_career_profile_seeds_empty(client):
    resp = client.get("/api/carreira/perfil")
    assert resp.status_code == 200
    body = resp.json()
    assert body["area_atual"] is None
    assert body["area_meta"] is None


def test_update_career_profile_does_not_credit_xp(client):
    resp = client.put("/api/carreira/perfil", json={"area_atual": "backend", "area_meta": "arquitetura"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["area_atual"] == "backend"
    assert body["area_meta"] == "arquitetura"
    assert _attrs(client)["carreira"]["current_xp"] == 0


def test_update_career_profile_blank_string_clears_field(client):
    client.put("/api/carreira/perfil", json={"area_atual": "backend", "area_meta": "arquitetura"})
    resp = client.put("/api/carreira/perfil", json={"area_atual": "", "area_meta": "arquitetura"})
    assert resp.json()["area_atual"] is None


# ---------------- interesses profissionais — Parte 1 ----------------

def test_create_and_list_interest_without_xp(client):
    resp = client.post("/api/carreira/interesses", json={"tag": "machine learning"})
    assert resp.status_code == 201
    assert resp.json()["tag"] == "machine learning"

    resp = client.get("/api/carreira/interesses")
    assert len(resp.json()) == 1
    assert _attrs(client)["carreira"]["current_xp"] == 0


def test_create_interest_blank_tag_returns_422(client):
    resp = client.post("/api/carreira/interesses", json={"tag": "   "})
    assert resp.status_code == 422


def test_delete_interest(client):
    interest = client.post("/api/carreira/interesses", json={"tag": "rust"}).json()
    resp = client.delete(f"/api/carreira/interesses/{interest['id']}")
    assert resp.status_code == 204
    assert client.get("/api/carreira/interesses").json() == []


def test_delete_interest_not_found_returns_404(client):
    resp = client.delete("/api/carreira/interesses/does-not-exist")
    assert resp.status_code == 404


# ---------------- linha do tempo de posições — Parte 2 ----------------

def test_create_first_position_credits_milestone_xp(client):
    position = _create_position(client, start_date="2018-03-01")
    assert position["company"] == "Acme Ltda"
    assert position["end_date"] is None

    assert _attrs(client)["carreira"]["current_xp"] == 150  # XP_CAREER_FIRST_POSITION


def test_create_second_position_with_past_start_date_credits_retroactive_xp(client):
    _create_position(client, start_date="2018-03-01")  # primeira — 150
    _create_position(client, company="Beta S.A.", role="dev pleno", start_date="2020-06-01")

    assert _attrs(client)["carreira"]["current_xp"] == 150 + 20  # XP_CAREER_POSITION_RETROACTIVE


def test_create_second_position_with_todays_date_credits_realtime_xp(client):
    _create_position(client, start_date="2018-03-01")  # primeira — 150
    today = datetime.date.today().isoformat()
    _create_position(client, company="Beta S.A.", role="dev pleno", start_date=today)

    assert _attrs(client)["carreira"]["current_xp"] == 150 + 80  # XP_CAREER_POSITION_REALTIME


def test_list_positions_orders_most_recent_first(client):
    _create_position(client, company="Antiga", start_date="2015-01-01")
    _create_position(client, company="Recente", start_date="2022-01-01")

    positions = client.get("/api/carreira/posicoes").json()
    assert [p["company"] for p in positions] == ["Recente", "Antiga"]


def test_create_position_requires_company_and_role(client):
    resp = client.post("/api/carreira/posicoes", json={"company": "  ", "role": "dev", "start_date": "2020-01-01"})
    assert resp.status_code == 422


def test_multiple_open_positions_allowed_without_uniqueness_check(client):
    _create_position(client, company="A", start_date="2015-01-01", end_date=None)
    _create_position(client, company="B", start_date="2020-01-01", end_date=None)

    positions = client.get("/api/carreira/posicoes").json()
    assert sum(1 for p in positions if p["end_date"] is None) == 2


def test_update_position_does_not_credit_additional_xp(client):
    position = _create_position(client, start_date="2018-03-01")  # 150
    resp = client.put(
        f"/api/carreira/posicoes/{position['id']}",
        json={"company": "Acme Ltda", "role": "dev sênior", "start_date": "2018-03-01", "end_date": "2021-01-01"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "dev sênior"
    assert resp.json()["end_date"] == "2021-01-01"

    assert _attrs(client)["carreira"]["current_xp"] == 150  # inalterado


def test_update_position_not_found_returns_404(client):
    resp = client.put(
        "/api/carreira/posicoes/does-not-exist",
        json={"company": "A", "role": "dev", "start_date": "2020-01-01"},
    )
    assert resp.status_code == 404


def test_delete_position_does_not_refund_xp(client):
    position = _create_position(client, start_date="2018-03-01")  # 150
    resp = client.delete(f"/api/carreira/posicoes/{position['id']}")
    assert resp.status_code == 204
    assert client.get("/api/carreira/posicoes").json() == []

    # XP creditado na criação fica como histórico — mesmo tratamento de organizacao.delete_link
    assert _attrs(client)["carreira"]["current_xp"] == 150


def test_delete_position_not_found_returns_404(client):
    resp = client.delete("/api/carreira/posicoes/does-not-exist")
    assert resp.status_code == 404


def test_optional_position_fields_default_to_none(client):
    position = _create_position(client, start_date="2018-03-01")
    assert position["area"] is None
    assert position["employment_type"] is None
    assert position["expected_contract_end"] is None
    assert position["expected_salary_review"] is None


def test_position_optional_fields_roundtrip(client):
    position = _create_position(
        client,
        start_date="2018-03-01",
        area="engenharia",
        employment_type="CLT",
        expected_contract_end="2024-12-31",
        expected_salary_review="2024-06-01",
    )
    assert position["area"] == "engenharia"
    assert position["employment_type"] == "CLT"
    assert position["expected_contract_end"] == "2024-12-31"
    assert position["expected_salary_review"] == "2024-06-01"


# ---------------- formação acadêmica — Parte 3 ----------------

def _create_education(client, curso="ciência da computação", instituicao="USP", nivel="graduacao", **extra):
    payload = {"curso": curso, "instituicao": instituicao, "nivel": nivel, **extra}
    resp = client.post("/api/carreira/formacoes", json=payload)
    assert resp.status_code == 201
    return resp.json()


def test_create_education_em_andamento_does_not_credit_xp(client):
    education = _create_education(client)
    assert education["status"] == "em_andamento"
    assert _attrs(client)["carreira"]["current_xp"] == 0


def test_create_education_missing_curso_or_instituicao_returns_422(client):
    resp = client.post(
        "/api/carreira/formacoes",
        json={"curso": "  ", "instituicao": "USP", "nivel": "graduacao"},
    )
    assert resp.status_code == 422


def test_create_education_invalid_nivel_returns_422(client):
    resp = client.post(
        "/api/carreira/formacoes",
        json={"curso": "x", "instituicao": "y", "nivel": "invalido"},
    )
    assert resp.status_code == 422


def test_create_education_invalid_status_returns_422(client):
    resp = client.post(
        "/api/carreira/formacoes",
        json={"curso": "x", "instituicao": "y", "nivel": "graduacao", "status": "invalido"},
    )
    assert resp.status_code == 422


def test_create_education_already_concluido_credits_xp_immediately(client):
    education = _create_education(client, nivel="graduacao", status="concluido")
    assert education["status"] == "concluido"
    assert _attrs(client)["carreira"]["current_xp"] == 220  # NIVEL_XP["graduacao"]


def test_update_education_to_concluido_credits_escalated_xp(client):
    education = _create_education(client, nivel="mestrado")
    resp = client.put(f"/api/carreira/formacoes/{education['id']}", json={"status": "concluido"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "concluido"
    assert _attrs(client)["carreira"]["current_xp"] == 280  # NIVEL_XP["mestrado"]


def test_update_education_editing_while_em_andamento_does_not_credit_xp(client):
    education = _create_education(client, nivel="doutorado")
    resp = client.put(
        f"/api/carreira/formacoes/{education['id']}",
        json={"curso": "novo nome do curso"},
    )
    assert resp.status_code == 200
    assert _attrs(client)["carreira"]["current_xp"] == 0


def test_reopening_concluded_education_refunds_exact_xp(client):
    education = _create_education(client, nivel="tecnico", status="concluido")  # 60
    assert _attrs(client)["carreira"]["current_xp"] == 60

    resp = client.put(f"/api/carreira/formacoes/{education['id']}", json={"status": "em_andamento"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "em_andamento"
    assert _attrs(client)["carreira"]["current_xp"] == 0


def test_reconcluding_after_reopen_credits_xp_again(client):
    education = _create_education(client, nivel="certificacao", status="concluido")  # 25
    client.put(f"/api/carreira/formacoes/{education['id']}", json={"status": "em_andamento"})
    assert _attrs(client)["carreira"]["current_xp"] == 0

    resp = client.put(f"/api/carreira/formacoes/{education['id']}", json={"status": "concluido"})
    assert resp.status_code == 200
    assert _attrs(client)["carreira"]["current_xp"] == 25


def test_multiple_em_andamento_educations_allowed(client):
    _create_education(client, curso="curso a")
    _create_education(client, curso="curso b")
    resp = client.get("/api/carreira/formacoes")
    assert len(resp.json()) == 2
    assert all(e["status"] == "em_andamento" for e in resp.json())


def test_delete_education_not_found_returns_404(client):
    resp = client.delete("/api/carreira/formacoes/does-not-exist")
    assert resp.status_code == 404


def test_delete_education_does_not_refund_xp(client):
    education = _create_education(client, nivel="pos_graduacao", status="concluido")  # 90
    resp = client.delete(f"/api/carreira/formacoes/{education['id']}")
    assert resp.status_code == 204
    assert client.get("/api/carreira/formacoes").json() == []
    assert _attrs(client)["carreira"]["current_xp"] == 90


def test_update_education_not_found_returns_404(client):
    resp = client.put(
        "/api/carreira/formacoes/does-not-exist",
        json={"curso": "x", "instituicao": "y", "nivel": "graduacao", "status": "em_andamento"},
    )
    assert resp.status_code == 404


def test_previsao_conclusao_optional_roundtrip(client):
    education = _create_education(client, previsao_conclusao="2027-12-01")
    assert education["previsao_conclusao"] == "2027-12-01"

    resp = client.put(
        f"/api/carreira/formacoes/{education['id']}",
        json={"clear_previsao_conclusao": True},
    )
    assert resp.json()["previsao_conclusao"] is None


# ---------------- evolução salarial — Parte 4 ----------------

TODAY = datetime.date.today().isoformat()


def _create_salary(client, amount=5000.0, date=TODAY, **extra):
    payload = {"amount": amount, "date": date, **extra}
    resp = client.post("/api/carreira/salarios", json=payload)
    assert resp.status_code == 201
    return resp.json()


def test_first_salary_record_credits_baseline_xp(client):
    record = _create_salary(client, amount=5000.0, date="2019-01-01")
    assert record["currency"] == "BRL"
    assert _attrs(client)["carreira"]["current_xp"] == 15  # SALARY_XP_BASELINE_OR_RETROACTIVE


def test_retroactive_salary_record_after_first_credits_fixed_xp(client):
    _create_salary(client, amount=5000.0, date="2019-01-01")  # 15
    _create_salary(client, amount=6000.0, date="2020-01-01")  # retroactive, not today
    assert _attrs(client)["carreira"]["current_xp"] == 30


def test_realtime_salary_record_scales_xp_with_growth_pct(client):
    _create_salary(client, amount=5000.0, date="2019-01-01")  # baseline, 15
    record = _create_salary(client, amount=5500.0, date=TODAY)  # +10% realtime
    # 40 (base) + 10 * 3 = 70
    assert _attrs(client)["carreira"]["current_xp"] == 15 + 70
    assert record["date"] == TODAY


def test_realtime_salary_record_caps_xp_at_max(client):
    _create_salary(client, amount=1000.0, date="2019-01-01")  # baseline, 15
    _create_salary(client, amount=100000.0, date=TODAY)  # huge jump, capped
    assert _attrs(client)["carreira"]["current_xp"] == 15 + 220  # SALARY_XP_REALTIME_MAX


def test_realtime_salary_pay_cut_still_credits_base_xp(client):
    _create_salary(client, amount=8000.0, date="2019-01-01")  # baseline, 15
    _create_salary(client, amount=7000.0, date=TODAY)  # cut, no growth bonus
    assert _attrs(client)["carreira"]["current_xp"] == 15 + 40  # SALARY_XP_REALTIME_BASE


def test_create_salary_record_zero_or_negative_amount_returns_422(client):
    resp = client.post("/api/carreira/salarios", json={"amount": 0, "date": TODAY})
    assert resp.status_code == 422


def test_create_salary_record_invalid_position_returns_422(client):
    resp = client.post(
        "/api/carreira/salarios",
        json={"amount": 5000.0, "date": TODAY, "position_id": "does-not-exist"},
    )
    assert resp.status_code == 422


def test_create_salary_record_links_to_position(client):
    position = _create_position(client, start_date="2019-01-01")
    record = _create_salary(client, amount=5000.0, date="2019-01-01", position_id=position["id"])
    assert record["position_id"] == position["id"]


def test_update_salary_record_does_not_credit_xp(client):
    record = _create_salary(client, amount=5000.0, date="2019-01-01")  # 15
    resp = client.put(
        f"/api/carreira/salarios/{record['id']}",
        json={"amount": 5200.0, "date": "2019-01-01"},
    )
    assert resp.status_code == 200
    assert resp.json()["amount"] == 5200.0
    assert _attrs(client)["carreira"]["current_xp"] == 15


def test_delete_salary_record_does_not_refund_xp(client):
    record = _create_salary(client, amount=5000.0, date="2019-01-01")  # 15
    resp = client.delete(f"/api/carreira/salarios/{record['id']}")
    assert resp.status_code == 204
    assert client.get("/api/carreira/salarios").json() == []
    assert _attrs(client)["carreira"]["current_xp"] == 15


def test_delete_salary_record_not_found_returns_404(client):
    resp = client.delete("/api/carreira/salarios/does-not-exist")
    assert resp.status_code == 404


def test_salary_stats_empty_when_no_records(client):
    resp = client.get("/api/carreira/salarios/estatisticas")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_registros"] == 0
    assert body["crescimento_desde_inicio_pct"] is None
    assert body["maior_salto"] is None


def test_salary_stats_growth_since_start_and_biggest_jump(client):
    _create_salary(client, amount=4000.0, date="2018-01-01")
    _create_salary(client, amount=4400.0, date="2019-01-01")  # +10%, +400
    _create_salary(client, amount=6000.0, date="2020-01-01")  # +36.4%, +1600 (biggest)

    resp = client.get("/api/carreira/salarios/estatisticas")
    body = resp.json()
    assert body["total_registros"] == 3
    assert body["crescimento_desde_inicio_pct"] == 50.0  # 4000 -> 6000
    assert body["maior_salto"]["amount"] == 1600.0
    assert body["maior_salto"]["date"] == "2020-01-01"


def test_salary_stats_growth_since_current_position(client):
    old_position = _create_position(client, company="Antiga Ltda", start_date="2015-01-01", end_date="2018-12-31")
    current_position = _create_position(client, company="Atual Ltda", start_date="2019-01-01")

    _create_salary(client, amount=3000.0, date="2016-01-01", position_id=old_position["id"])
    _create_salary(client, amount=5000.0, date="2019-01-01", position_id=current_position["id"])
    _create_salary(client, amount=6000.0, date="2021-01-01", position_id=current_position["id"])

    resp = client.get("/api/carreira/salarios/estatisticas")
    body = resp.json()
    assert body["crescimento_posicao_atual_pct"] == 20.0  # 5000 -> 6000, within current position
