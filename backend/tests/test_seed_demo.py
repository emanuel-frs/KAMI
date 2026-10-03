"""
Garante que scripts/seed_demo.py continua compatível com a API.

O seed fala com o backend só por HTTP; se alguém mudar um schema ou uma
regra de negócio (ex.: limite do cartão, campos obrigatórios), este teste
quebra em vez de o modo demo falhar só na hora de gravar o vídeo.
"""
import datetime as dt
import importlib.util
from pathlib import Path

SEED_PATH = Path(__file__).resolve().parents[2] / "scripts" / "seed_demo.py"


def _carregar_seed():
    spec = importlib.util.spec_from_file_location("seed_demo", SEED_PATH)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def test_seed_popula_todos_os_modulos_e_recusa_segunda_execucao(client):
    seed = _carregar_seed()
    s = seed.Seeder(client, dt.date.today())

    assert s.instancia_vazia()

    s.perfil()
    corrente, cartao, reserva = s.carteira()
    s.financas(corrente, cartao)
    trilhas = s.aprendizado()
    s.metas(reserva, trilhas["Java e Spring Boot"])
    s.organizacao()
    s.calendario()
    s.carreira()
    s.atividade()
    s.onboarding(mostrar=False)

    assert not s.instancia_vazia()
    assert len(client.get("/api/metas").json()) == 4
    assert len(client.get("/api/aprendizado/tracks").json()) == 3
    assert client.get("/api/perfil").json()["display_name"] == "Demo"
    assert client.get("/api/perfil").json()["onboarding_completed"] is True


def test_seed_pode_deixar_onboarding_pendente(client):
    seed = _carregar_seed()
    s = seed.Seeder(client, dt.date.today())
    s.perfil()
    s.onboarding(mostrar=True)
    assert client.get("/api/perfil").json()["onboarding_completed"] is False
