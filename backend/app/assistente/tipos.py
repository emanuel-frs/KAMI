"""
Formato neutro do assistente (IA-01).

Cada provedor tem o seu jeito de escrever mensagens, ferramentas e o
streaming. Os adaptadores (openai_compat.py, anthropic.py) traduzem DE e
PARA este formato, e todo o resto (chat, ferramentas, teto, registro do
que foi enviado) só conhece o que está aqui — trocar de provedor no meio
de uma conversa, ou acrescentar um formato novo um dia, não mexe em mais
nada.

Mensagem:
    papel "sistema"     instruções (versionadas no código, IA-03)
    papel "usuario"     o que a pessoa escreveu
    papel "assistente"  resposta do modelo; pode trazer `chamadas` (o
                        modelo pediu pra rodar ferramentas)
    papel "ferramenta"  resultado de UMA chamada (`id_chamada` liga ao
                        pedido; `texto` é o conteúdo devolvido)

Eventos do streaming (o adaptador devolve um iterador deles, na ordem):
    TextoDelta(delta)   pedaço da resposta
    Chamada(...)        pedido de ferramenta já completo (argumentos
                        montados e decodificados — o pedaço a pedaço do
                        JSON fica dentro do adaptador)
    Uso(...)            tokens informados pelo provedor (pode não vir)
    Fim(motivo)         "fim" | "ferramentas" | "limite" (cortou por
                        tamanho) | "outro"
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ChamadaFerramenta:
    id: str
    nome: str
    argumentos: dict


@dataclass
class Mensagem:
    papel: str  # sistema | usuario | assistente | ferramenta
    texto: str = ""
    chamadas: list[ChamadaFerramenta] = field(default_factory=list)
    id_chamada: Optional[str] = None  # só papel "ferramenta"
    nome_ferramenta: Optional[str] = None  # só papel "ferramenta" (o Gemini pede o nome junto)


@dataclass
class Ferramenta:
    nome: str
    descricao: str
    parametros: dict  # JSON Schema de um objeto


# ── eventos do streaming ──────────────────────────────────────────────

@dataclass
class TextoDelta:
    delta: str


@dataclass
class Chamada:
    chamada: ChamadaFerramenta


@dataclass
class Uso:
    entrada: int
    saida: int


@dataclass
class Fim:
    motivo: str  # fim | ferramentas | limite | outro


@dataclass
class Provedor:
    """O que um adaptador precisa pra falar com o provedor (sem banco)."""
    tipo: str  # openai | anthropic
    url_base: str
    modelo: Optional[str]
    chave: Optional[str]
    local: bool = False
