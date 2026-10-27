"""
Configuração do assistente e provedores salvos (IA-01).

`assistente_config` tem uma linha só, criada na primeira leitura com os
padrões de PADROES (P-104/P-105/P-110). `assistente_provedores` guarda
cada provedor que a pessoa configurou; só um fica em uso
(`assistente_config.provedor_id`).

A chave da API é cifrada como os outros segredos (app/crypto.py, chave no
cofre do sistema) e só é decifrada aqui, na hora de montar o `Provedor`
pra uma chamada. Nenhuma função daqui devolve a chave pra rota — a rota
recebe `tem_chave`.

"Pronto pra usar" (`estado`) = ligado + provedor em uso + modelo escolhido
+ chave salva quando o provedor exige. Cada falta tem um código, e a tela
mostra o que falta (P-11, P-110).
"""
from app.assistente import catalogo, provedores
from app.assistente.tipos import Provedor
from app.crypto import decrypt_password
from app.database import new_id, now_iso

PADROES = {
    "ativo": 0,
    "escondido": 0,
    "provedor_id": None,
    "teto_chamadas": 150,
    "teto_tokens": 200_000,
    "max_rodadas": 6,
    "guardar_conversas": 1,
    "dias_historico": 30,
}

# limites dos campos editáveis (a tela e a API usam os mesmos)
LIMITES = {
    "teto_chamadas": (1, 10_000),
    "teto_tokens": (1_000, 100_000_000),
    "max_rodadas": (1, 20),
    "dias_historico": (1, 3650),
}


def obter(db) -> dict:
    row = db.execute("SELECT * FROM assistente_config LIMIT 1").fetchone()
    if row is None:
        db.execute(
            "INSERT INTO assistente_config (id, ativo, escondido, provedor_id, teto_chamadas, teto_tokens, "
            "max_rodadas, guardar_conversas, dias_historico, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id(), *PADROES.values(), now_iso()),
        )
        db.commit()
        row = db.execute("SELECT * FROM assistente_config LIMIT 1").fetchone()
    return dict(row)


def atualizar(db, campos: dict) -> dict:
    atual = obter(db)
    permitidos = {k: v for k, v in campos.items() if k in PADROES and k != "provedor_id"}
    if not permitidos:
        return atual
    sets = ", ".join(f"{k} = ?" for k in permitidos)  # nomes vêm de PADROES, não da requisição
    db.execute(f"UPDATE assistente_config SET {sets}, updated_at = ? WHERE id = ?",
               (*permitidos.values(), now_iso(), atual["id"]))
    db.commit()
    return obter(db)


def usar_provedor(db, provedor_id: str | None) -> None:
    atual = obter(db)
    db.execute("UPDATE assistente_config SET provedor_id = ?, updated_at = ? WHERE id = ?",
               (provedor_id, now_iso(), atual["id"]))


# ── provedores salvos ──────────────────────────────────────────────────

def _publico(row) -> dict:
    """O provedor como a tela vê: sem a chave, com `tem_chave`, `local` e
    o que o catálogo sabe dele (links, selo, se exige chave)."""
    d = dict(row)
    d["tem_chave"] = bool(d.pop("chave_enc", None))
    try:
        _, d["local"] = provedores.normalizar_url(d["url_base"])
    except provedores.UrlInvalida:
        d["local"] = False
    cat = catalogo.obter(d["catalogo"]) or catalogo.obter(catalogo.OUTRO)
    d["chave_exigida"] = cat["chave"] == "obrigatoria"
    d["links"] = cat.get("links", {})
    d["selo"] = cat.get("selo")
    for k in ("teste_ok", "ferramentas_ok"):
        d[k] = None if d[k] is None else bool(d[k])
    return d


def listar(db) -> list[dict]:
    rows = db.execute("SELECT * FROM assistente_provedores ORDER BY created_at").fetchall()
    return [_publico(r) for r in rows]


def obter_provedor(db, provedor_id: str):
    return db.execute("SELECT * FROM assistente_provedores WHERE id = ?", (provedor_id,)).fetchone()


def publico(row) -> dict:
    return _publico(row)


def montar(row) -> Provedor:
    """Provedor pronto pra chamada (chave decifrada). ValueError /
    ChaveIndisponivel sobem pra rota tratar."""
    url, local = provedores.normalizar_url(row["url_base"])
    chave = decrypt_password(row["chave_enc"]) if row["chave_enc"] else None
    return Provedor(tipo=row["tipo"], url_base=url, modelo=row["modelo"], chave=chave, local=local)


def estado(db) -> dict:
    """O que a tela precisa pra decidir o que mostrar no painel/aba."""
    cfg = obter(db)
    row = obter_provedor(db, cfg["provedor_id"]) if cfg["provedor_id"] else None
    falta = None
    if row is None:
        falta = "provedor"
    else:
        pub = _publico(row)
        if not row["modelo"]:
            falta = "modelo"
        elif pub["chave_exigida"] and not pub["tem_chave"]:
            falta = "chave"
    if falta is None and not cfg["ativo"]:
        falta = "desligado"
    return {
        "config": {k: (bool(cfg[k]) if k in ("ativo", "escondido", "guardar_conversas") else cfg[k]) for k in PADROES},
        "provedor": _publico(row) if row else None,
        "pronto": falta is None,
        "falta": falta,
    }


def provedor_em_uso(db):
    """(row, Provedor) do provedor em uso — None se não houver. Pode
    levantar ChaveIndisponivel/ValueError ao decifrar a chave."""
    cfg = obter(db)
    row = obter_provedor(db, cfg["provedor_id"]) if cfg["provedor_id"] else None
    return (row, montar(row)) if row else None

