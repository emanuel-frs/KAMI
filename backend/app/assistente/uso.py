"""
Teto de uso (IA-01, P-104): limite por dia de chamadas ao provedor e de
tokens (entrada + saída), com o contador do dia visível na tela.

Existe pra proteger o dinheiro (e a cota gratuita) da pessoa — um laço de
ferramentas, um modelo que não para de chamar, um clique repetido. Por
isso:
- é conferido ANTES de cada chamada (`conferir`), inclusive dentro do
  laço de ferramentas, e não só no começo da mensagem;
- vale só pra provedor na NUVEM. No local não há custo; o uso é contado
  do mesmo jeito (a tela mostra), e o limite de rodadas por mensagem
  (`max_rodadas`, no laço) segura laço infinito nos dois;
- tokens são os que o provedor informa; sem informação (alguns servidores
  locais), estimativa de 1 token a cada 4 caracteres, marcada como
  estimada.

O dia é o dia local (mesmo relógio do resto do app — database.local_now).
"""
from math import ceil

from app.database import local_now

CARACTERES_POR_TOKEN = 4


class TetoAtingido(Exception):
    def __init__(self, qual: str, usado: int, teto: int):
        super().__init__(f"teto de {qual} do dia atingido ({usado}/{teto})")
        self.qual = qual  # chamadas | tokens
        self.usado = usado
        self.teto = teto


def _dia() -> str:
    return local_now().date().isoformat()


def hoje(db) -> dict:
    row = db.execute("SELECT * FROM assistente_uso WHERE dia = ?", (_dia(),)).fetchone()
    if not row:
        return {"dia": _dia(), "chamadas": 0, "tokens": 0, "tokens_entrada": 0, "tokens_saida": 0, "estimado": False}
    return {
        "dia": row["dia"], "chamadas": row["chamadas"],
        "tokens": row["tokens_entrada"] + row["tokens_saida"],
        "tokens_entrada": row["tokens_entrada"], "tokens_saida": row["tokens_saida"],
        "estimado": bool(row["estimado"]),
    }


def conferir(db, config: dict, local: bool) -> None:
    """TetoAtingido se a próxima chamada passaria do teto (só nuvem)."""
    if local:
        return
    u = hoje(db)
    if u["chamadas"] >= config["teto_chamadas"]:
        raise TetoAtingido("chamadas", u["chamadas"], config["teto_chamadas"])
    if u["tokens"] >= config["teto_tokens"]:
        raise TetoAtingido("tokens", u["tokens"], config["teto_tokens"])


def estimar(caracteres: int) -> int:
    return ceil(max(0, caracteres) / CARACTERES_POR_TOKEN)


def registrar(db, entrada: int, saida: int, estimado: bool = False) -> None:
    """Soma UMA chamada e os tokens dela ao dia. Commit fica com quem chama
    — mas quem chama comita logo, pra uma chamada cobrada nunca sumir do
    contador por causa de um erro depois."""
    db.execute(
        "INSERT INTO assistente_uso (dia, chamadas, tokens_entrada, tokens_saida, estimado) VALUES (?, 1, ?, ?, ?) "
        "ON CONFLICT(dia) DO UPDATE SET chamadas = chamadas + 1, tokens_entrada = tokens_entrada + excluded.tokens_entrada, "
        "tokens_saida = tokens_saida + excluded.tokens_saida, estimado = MAX(estimado, excluded.estimado)",
        (_dia(), int(entrada), int(saida), 1 if estimado else 0),
    )
