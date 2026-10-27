"""
Conversas do chat e o registro do que foi enviado (IA-02, P-105,
princípio 3).

Dois lugares, uma interface:
- **banco** (assistente_conversas / _mensagens / _envios) com "guardar
  conversas" ligado — o padrão;
- **memória do backend** com ele desligado: a conversa funciona igual
  (o modelo precisa do histórico DENTRO da conversa), mas nada vai pro
  disco e tudo some ao fechar o app.

Conversa criada num lugar fica nele até ser apagada (desligar "guardar"
não apaga as que já estão no banco — a tela diz isso e tem o "apagar
tudo"). Listar junta os dois lugares. As do banco somem sozinhas depois
de `dias_historico` (`limpar_antigas`, chamado ao listar e ao abrir uma
conversa nova).
"""
import json
import threading
from datetime import timedelta

from app.assistente import config
from app.database import local_now, new_id, now_iso

TITULO_MAX = 60
ENVIOS_LISTA_MAX = 200

_lock = threading.Lock()
_memoria_conversas: dict[str, dict] = {}  # id → {"conversa": {...}, "mensagens": [...]}
_memoria_envios: list[dict] = []


def esquecer_memoria():
    """Conversas do "não guardar" (e o registro delas) — apagar tudo,
    reset e import de backup."""
    with _lock:
        _memoria_conversas.clear()
        _memoria_envios.clear()


def titulo_de(texto: str) -> str:
    linha = " ".join(texto.split())
    return linha if len(linha) <= TITULO_MAX else linha[: TITULO_MAX - 1].rstrip() + "…"


def _msg_de_row(row) -> dict:
    d = dict(row)
    d["chamadas"] = json.loads(d["chamadas"]) if d.get("chamadas") else []
    d["interrompida"] = bool(d["interrompida"])
    d["aviso"] = json.loads(d["aviso"]) if d.get("aviso") else None
    d.pop("conversa_id", None)
    return d


# ── conversas ──────────────────────────────────────────────────────────

def criar(conn, texto_inicial: str, tela: str | None) -> dict:
    agora = now_iso()
    conversa = {"id": new_id(), "titulo": titulo_de(texto_inicial), "tela": tela, "created_at": agora, "updated_at": agora}
    if config.obter(conn)["guardar_conversas"]:
        limpar_antigas(conn)
        conn.execute(
            "INSERT INTO assistente_conversas (id, titulo, tela, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            tuple(conversa.values()),
        )
        conn.commit()
        conversa["guardada"] = True
    else:
        with _lock:
            _memoria_conversas[conversa["id"]] = {"conversa": dict(conversa), "mensagens": []}
        conversa["guardada"] = False
    return conversa


def obter(conn, conversa_id: str) -> dict | None:
    """{conversa..., "guardada", "mensagens": [...]} ou None."""
    with _lock:
        mem = _memoria_conversas.get(conversa_id)
        if mem:
            return {**mem["conversa"], "guardada": False, "mensagens": [dict(m) for m in mem["mensagens"]]}
    row = conn.execute("SELECT * FROM assistente_conversas WHERE id = ?", (conversa_id,)).fetchone()
    if not row:
        return None
    msgs = conn.execute(
        "SELECT * FROM assistente_mensagens WHERE conversa_id = ? ORDER BY created_at, rowid", (conversa_id,)
    ).fetchall()
    return {**dict(row), "guardada": True, "mensagens": [_msg_de_row(m) for m in msgs]}


def listar(conn) -> list[dict]:
    limpar_antigas(conn)
    rows = conn.execute(
        "SELECT c.*, (SELECT COUNT(*) FROM assistente_mensagens m WHERE m.conversa_id = c.id AND m.papel != 'ferramenta') AS n "
        "FROM assistente_conversas c"
    ).fetchall()
    lista = [{**dict(r), "guardada": True} for r in rows]
    with _lock:
        lista += [{**m["conversa"], "guardada": False, "n": sum(1 for x in m["mensagens"] if x["papel"] != "ferramenta")}
                  for m in _memoria_conversas.values()]
    return sorted(lista, key=lambda c: c["updated_at"], reverse=True)


def adicionar_mensagem(conn, conversa_id: str, papel: str, texto: str = "", **extra) -> dict:
    msg = {
        "id": new_id(), "papel": papel, "texto": texto,
        "chamadas": extra.get("chamadas") or [], "id_chamada": extra.get("id_chamada"),
        "nome_ferramenta": extra.get("nome_ferramenta"), "provedor": extra.get("provedor"),
        "modelo": extra.get("modelo"), "interrompida": bool(extra.get("interrompida")),
        "erro_chave": extra.get("erro_chave"), "aviso": extra.get("aviso"), "created_at": now_iso(),
    }
    with _lock:
        mem = _memoria_conversas.get(conversa_id)
        if mem:
            mem["mensagens"].append(dict(msg))
            mem["conversa"]["updated_at"] = msg["created_at"]
            return msg
    conn.execute(
        "INSERT INTO assistente_mensagens (id, conversa_id, papel, texto, chamadas, id_chamada, nome_ferramenta, "
        "provedor, modelo, interrompida, erro_chave, aviso, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (msg["id"], conversa_id, papel, texto, json.dumps(msg["chamadas"], ensure_ascii=False) if msg["chamadas"] else None,
         msg["id_chamada"], msg["nome_ferramenta"], msg["provedor"], msg["modelo"], int(msg["interrompida"]),
         msg["erro_chave"], json.dumps(msg["aviso"], ensure_ascii=False) if msg["aviso"] else None, msg["created_at"]),
    )
    conn.execute("UPDATE assistente_conversas SET updated_at = ? WHERE id = ?", (msg["created_at"], conversa_id))
    conn.commit()
    return msg


def remover_mensagens(conn, conversa_id: str, ids: list[str]) -> None:
    """Continuar/refazer (retorno do teste da F3): a resposta refeita sai
    da conversa; o registro do que foi enviado continua (aquilo saiu)."""
    if not ids:
        return
    with _lock:
        mem = _memoria_conversas.get(conversa_id)
        if mem:
            mem["mensagens"] = [m for m in mem["mensagens"] if m["id"] not in ids]
            return
    conn.executemany("DELETE FROM assistente_mensagens WHERE conversa_id = ? AND id = ?", [(conversa_id, i) for i in ids])
    conn.commit()


def apagar(conn, conversa_id: str) -> bool:
    with _lock:
        if _memoria_conversas.pop(conversa_id, None):
            _memoria_envios[:] = [e for e in _memoria_envios if e["conversa_id"] != conversa_id]
            return True
    cur = conn.execute("DELETE FROM assistente_conversas WHERE id = ?", (conversa_id,))
    conn.execute("DELETE FROM assistente_envios WHERE conversa_id = ?", (conversa_id,))
    conn.commit()
    return cur.rowcount > 0


def apagar_tudo(conn) -> None:
    """Conversas + registro do que foi enviado, nos dois lugares."""
    esquecer_memoria()
    conn.execute("DELETE FROM assistente_conversas")
    conn.execute("DELETE FROM assistente_envios")
    conn.commit()


def limpar_antigas(conn) -> None:
    dias = config.obter(conn)["dias_historico"]
    corte = (local_now() - timedelta(days=dias)).isoformat()
    conn.execute("DELETE FROM assistente_conversas WHERE updated_at < ?", (corte,))
    conn.execute("DELETE FROM assistente_envios WHERE created_at < ?", (corte,))
    conn.commit()


# ── o que foi enviado (princípio 3) ──────────────────────────────────────

def registrar_envio(conn, conversa_id: str | None, provedor: str, modelo: str | None, destino: str, local: bool,
                    itens: list[dict]) -> str:
    envio = {"id": new_id(), "conversa_id": conversa_id, "provedor": provedor, "modelo": modelo, "destino": destino,
             "local": local, "itens": itens, "tokens_entrada": None, "tokens_saida": None, "created_at": now_iso()}
    with _lock:
        if conversa_id in _memoria_conversas:
            _memoria_envios.append(envio)
            return envio["id"]
    conn.execute(
        "INSERT INTO assistente_envios (id, conversa_id, provedor, modelo, destino, local, itens, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (envio["id"], conversa_id, provedor, modelo, destino, int(local), json.dumps(itens, ensure_ascii=False), envio["created_at"]),
    )
    conn.commit()
    return envio["id"]


def anotar_tokens(conn, envio_id: str, entrada: int, saida: int) -> None:
    with _lock:
        for e in _memoria_envios:
            if e["id"] == envio_id:
                e["tokens_entrada"], e["tokens_saida"] = entrada, saida
                return
    conn.execute("UPDATE assistente_envios SET tokens_entrada = ?, tokens_saida = ? WHERE id = ?", (entrada, saida, envio_id))
    conn.commit()


def listar_envios(conn) -> list[dict]:
    limpar_antigas(conn)
    rows = conn.execute("SELECT * FROM assistente_envios ORDER BY created_at DESC LIMIT ?", (ENVIOS_LISTA_MAX,)).fetchall()
    lista = [{**dict(r), "local": bool(r["local"]), "itens": json.loads(r["itens"])} for r in rows]
    with _lock:
        lista += [dict(e) for e in _memoria_envios]
    return sorted(lista, key=lambda e: e["created_at"], reverse=True)[:ENVIOS_LISTA_MAX]


def apagar_envios(conn) -> None:
    with _lock:
        _memoria_envios.clear()
    conn.execute("DELETE FROM assistente_envios")
    conn.commit()


_resetar_para_testes = esquecer_memoria
