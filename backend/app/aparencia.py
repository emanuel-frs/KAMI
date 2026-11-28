"""
Aparência personalizável (2.1.0).

Os temas de terminal fechados (GAM-10: padrão, fósforo, crt, âmbar) viraram
peças soltas que o nível libera aos poucos: cor livre, paleta, textura (e
onde ela aparece), texto tingido, cores do calendário, duas cores do avatar.
Tudo mora num JSON em `user_profile.aparencia`; a cor de destaque continua
em `accent_color` (a tela do PIN, o ícone do app e muita coisa já leem dali).

Quem CALCULA os tons (derivação, contraste) é o frontend
(components/aparencia.js) — aqui só se valida o formato, completa o que
faltar com o padrão e confere o nível de cada capacidade usada.

Perfil sem `aparencia` (banco de antes da 2.1.0, ou backup antigo
importado): a aparência sai do `tema` antigo, com o mesmo visual de antes —
por isso não há migração de dados, só a coluna.
"""
import json
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.limites import Entrada

HEX = r"^#[0-9a-fA-F]{6}$"
_HEX_RE = re.compile(HEX)

# as 9 cores prontas (frontend/js/components/accent-colors.js) — livres
CORES_PRONTAS = (
    "#8fbf8f", "#b3a06a", "#8fa8bf", "#b06060", "#c9c9c9",
    "#c9a0dc", "#e0c15a", "#5ac8c8", "#e08fa0",
)

PALETAS = ("padrao", "ambar", "personalizada")
TEXTURAS = ("nenhuma", "scanline", "crt", "grade", "pontilhado")
# tokens que o modo avançado pode fixar à mão (components/aparencia.js)
TOKENS_FIXAVEIS = (
    "--bg-alt", "--panel", "--border-soft", "--border-interactive", "--text-bright",
    "--text-dim", "--text-faint", "--accent-dim", "--red", "--green", "--amber",
)
# tipos do calendário (frontend/js/components/event-types.js)
TIPOS_CALENDARIO = (
    "conta_fixa", "divida", "assinatura", "parcela", "meta", "acao",
    "evento", "contrato_fim", "revisao_salarial", "lembrete",
)
# limites dos ajustes de cada textura: espaçamento, espessura/ponto (px)
LIMITES_TEXTURA = {
    "scanline": {"esp": (2, 16), "gros": (1, 6)},
    "crt": {"esp": (2, 16), "gros": (1, 6)},
    "grade": {"esp": (4, 64), "gros": (1, 8)},
    "pontilhado": {"esp": (2, 32), "gros": (1, 12)},
}
AJUSTES_PADRAO = {
    "scanline": {"esp": 3, "gros": 1, "int": 3},
    "crt": {"esp": 3, "gros": 1, "int": 3},
    "grade": {"esp": 8, "gros": 1, "int": 3},
    "pontilhado": {"esp": 3, "gros": 1, "int": 3},
}
CORES_PADRAO = {"bg": "#000000", "superficie": "#0d0d0d", "borda": "#3c3c3c", "texto": "#c9c9c9"}
CONTORNO_PADRAO = "#000000"

# (nível mínimo, chave, rótulo em português) — o frontend traduz por
# `recompensa.cap.<chave>` (tests/test_textos_sistema.py confere)
# 2.1.0, no teste: os níveis da proposta (5…25) ficaram altos — baixados
# mais ou menos pela metade, na mesma ordem
CAPACIDADES = (
    (3, "texto_tingido", "texto tingido pela cor de destaque"),
    (4, "cor_livre", "cor livre (destaque e avatar)"),
    (5, "textura_crt", "textura crt"),
    (6, "calendario", "cores do calendário"),
    (8, "paleta_ambar", "paleta âmbar clássico"),
    (8, "paleta_personalizada", "paleta personalizada"),
    (10, "texto", "cor do texto"),
    (10, "avancado", "modo avançado"),
    (12, "texturas_novas", "texturas grade e pontilhado"),
)


class CoresPaleta(BaseModel):
    bg: str = Field(..., pattern=HEX)
    superficie: str = Field(..., pattern=HEX)
    borda: str = Field(..., pattern=HEX)
    texto: str = Field(..., pattern=HEX)


class LugaresTextura(BaseModel):
    tela: bool = True
    menu: bool = True
    componentes: bool = True


class AvatarCores(BaseModel):
    contorno: str = Field(CONTORNO_PADRAO, pattern=HEX)
    preenchimento: Optional[str] = Field(None, pattern=HEX)  # None = segue a cor de destaque


class AparenciaIn(Entrada):
    """O que o app manda inteiro a cada mudança (o que faltar vira o padrão)."""
    paleta: Literal["padrao", "ambar", "personalizada"] = "padrao"
    cores: Optional[CoresPaleta] = None
    fixos: dict[str, str] = Field(default_factory=dict, max_length=len(TOKENS_FIXAVEIS))
    contraste_auto: bool = True
    textura: Literal["nenhuma", "scanline", "crt", "grade", "pontilhado"] = "scanline"
    textura_lugares: LugaresTextura = Field(default_factory=LugaresTextura)
    # {"grade": {"esp": 24, "gros": 2, "int": 6}} — fora da faixa volta ao padrão (normalizar)
    textura_ajustes: dict[str, dict[str, int]] = Field(default_factory=dict, max_length=len(LIMITES_TEXTURA))
    texto_tingido: bool = False
    avatar: AvatarCores = Field(default_factory=AvatarCores)
    calendario: dict[str, str] = Field(default_factory=dict, max_length=len(TIPOS_CALENDARIO))


def _limpar_hex(d: dict, chaves_validas) -> dict:
    return {k: v.lower() for k, v in d.items() if k in chaves_validas and isinstance(v, str) and _HEX_RE.match(v)}


def padrao() -> dict:
    return normalizar({})


def normalizar(dados: dict) -> dict:
    """
    Completa com o padrão e descarta o que não se conhece (chaves de uma
    versão mais nova, valores fora da faixa) — nunca levanta: serve tanto
    pro que vem do banco quanto pro que já passou pelo AparenciaIn.
    """
    if not isinstance(dados, dict):
        dados = {}
    paleta = dados.get("paleta") if dados.get("paleta") in PALETAS else "padrao"
    cores = dict(CORES_PADRAO)
    cores.update(_limpar_hex(dados.get("cores") or {}, CORES_PADRAO))
    textura = dados.get("textura") if dados.get("textura") in TEXTURAS else "scanline"
    lugares_in = dados.get("textura_lugares") or {}
    lugares = {k: bool(lugares_in.get(k, True)) for k in ("tela", "menu", "componentes")}
    ajustes = {}
    for tx, pad in AJUSTES_PADRAO.items():
        a = (dados.get("textura_ajustes") or {}).get(tx) or {}
        lim = LIMITES_TEXTURA[tx]
        esp = _faixa(a.get("esp"), *lim["esp"], pad["esp"])
        gros = min(_faixa(a.get("gros"), *lim["gros"], pad["gros"]), esp - 1)
        ajustes[tx] = {"esp": esp, "gros": gros, "int": _faixa(a.get("int"), 1, 10, pad["int"])}
    av = dados.get("avatar") or {}
    contorno = av.get("contorno") if isinstance(av.get("contorno"), str) and _HEX_RE.match(av["contorno"]) else CONTORNO_PADRAO
    preench = av.get("preenchimento") if isinstance(av.get("preenchimento"), str) and _HEX_RE.match(av["preenchimento"]) else None
    return {
        "paleta": paleta,
        "cores": cores,
        "fixos": _limpar_hex(dados.get("fixos") or {}, TOKENS_FIXAVEIS),
        "contraste_auto": bool(dados.get("contraste_auto", True)),
        "textura": textura,
        "textura_lugares": lugares,
        "textura_ajustes": ajustes,
        "texto_tingido": bool(dados.get("texto_tingido", False)),
        "avatar": {"contorno": contorno.lower(), "preenchimento": preench.lower() if preench else None},
        "calendario": _limpar_hex(dados.get("calendario") or {}, TIPOS_CALENDARIO),
    }


def _faixa(valor, minimo, maximo, padrao_):
    return valor if isinstance(valor, int) and not isinstance(valor, bool) and minimo <= valor <= maximo else padrao_


def do_tema_antigo(tema: Optional[str]) -> dict:
    """GAM-10 → 2.1.0: o visual de cada tema antigo, nas peças novas."""
    base = {}
    if tema == "fosforo":
        base["texto_tingido"] = True
    elif tema == "crt":
        base["textura"] = "crt"
    elif tema == "ambar":
        base["paleta"] = "ambar"
    return normalizar(base)


def do_perfil(row) -> dict:
    """A aparência de uma linha de user_profile (a coluna, ou o tema antigo)."""
    bruto = row["aparencia"] if "aparencia" in row.keys() else None
    if bruto:
        try:
            return normalizar(json.loads(bruto))
        except (ValueError, TypeError):
            pass
    return do_tema_antigo(row["tema"] if "tema" in row.keys() else None)


def capacidades_usadas(ap: dict, accent_color: Optional[str]) -> set[str]:
    """Quais capacidades (CAPACIDADES) esta aparência + cor precisam."""
    usadas = set()
    if ap["texto_tingido"]:
        usadas.add("texto_tingido")
    if accent_color and accent_color.lower() not in CORES_PRONTAS:
        usadas.add("cor_livre")
    if ap["avatar"]["contorno"] != CONTORNO_PADRAO or ap["avatar"]["preenchimento"]:
        usadas.add("cor_livre")
    if ap["textura"] == "crt":
        usadas.add("textura_crt")
    if ap["textura"] in ("grade", "pontilhado"):
        usadas.add("texturas_novas")
    if ap["calendario"]:
        usadas.add("calendario")
    if ap["paleta"] == "ambar":
        usadas.add("paleta_ambar")
    if ap["paleta"] == "personalizada":
        usadas.add("paleta_personalizada")
        if ap["cores"]["texto"] != CORES_PADRAO["texto"]:
            usadas.add("texto")
    if ap["fixos"]:
        usadas.add("avancado")
    return usadas


def nivel_da_capacidade(chave: str) -> int:
    return next(minimo for minimo, c, _ in CAPACIDADES if c == chave)


def serializar(ap: dict) -> str:
    return json.dumps(ap, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
