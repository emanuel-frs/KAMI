"""
Recompensas por nível geral (GAM-10). Regras combinadas com o Emanuel em
2026-10-09:

  - As 9 cores de destaque continuam todas livres (já eram — travar tiraria
    algo de quem usa). As recompensas são coisas NOVAS:
  - Títulos exibidos sob o nome no perfil; o usuário escolhe entre os já
    liberados (sem escolha = o mais alto liberado, "automático").
  - Capacidades da aparência (2.1.0 — antes, temas de terminal fechados):
    cor livre, paletas, texturas, texto tingido, cores do calendário
    (app/aparencia.py).

Nível geral = level_from_xp(soma do xp dos atributos), a mesma conta do
/api/nucleo/player. Se o nível cair depois (estorno), a escolha já feita
fica como está — não se tira recompensa de ninguém; só não dá pra
ESCOLHER algo acima do nível atual.
"""
from app.aparencia import CAPACIDADES
from app.xp import level_from_xp

# I18N: rótulos e descrições em português; o frontend mostra
# `recompensa.titulo.<chave>` e `recompensa.cap.<chave>` do dicionário do idioma
# (tests/test_textos_sistema.py confere que o português é o mesmo).

# (nível mínimo, chave, rótulo)
TITULOS = (
    (1, "iniciante", "iniciante"),
    (5, "aprendiz", "aprendiz"),
    (10, "operador", "operador"),
    (15, "veterano", "veterano"),
    (20, "mestre", "mestre do terminal"),
    (30, "lenda", "lenda"),
)

# 2.1.0: os temas de terminal (padrão, fósforo, crt, âmbar) viraram
# capacidades da aparência, liberadas aos poucos — ver app/aparencia.py
# (CAPACIDADES). O `tema` antigo só serve pra
# montar a aparência de quem ainda não tem uma (app/aparencia.do_tema_antigo).

def nivel_jogador(db) -> int:
    total = db.execute("SELECT COALESCE(SUM(current_xp), 0) AS t FROM attributes").fetchone()["t"]
    return level_from_xp(total)["level"]


def chave_titulo_atual(escolhido, nivel: int) -> str:
    """Chave do título exibido: o escolhido (se existir) ou o mais alto liberado."""
    if any(chave == escolhido for _, chave, _ in TITULOS):
        return escolhido
    return [chave for minimo, chave, _ in TITULOS if nivel >= minimo][-1]


def titulo_atual(escolhido, nivel: int) -> str:
    """Rótulo (em português) do título exibido — o frontend traduz pela chave."""
    chave = chave_titulo_atual(escolhido, nivel)
    return next(rotulo for _, c, rotulo in TITULOS if c == chave)


def nivel_minimo(catalogo, chave):
    """Nível que libera `chave` no catálogo (TITULOS ou CAPACIDADES), ou None se não existe."""
    return next((item[0] for item in catalogo if item[1] == chave), None)


def catalogo(db) -> dict:
    """Tudo o que existe, com o que já está liberado — pra aba aparência."""
    nivel = nivel_jogador(db)
    return {
        "level": nivel,
        "titulos": [
            {"key": chave, "label": rotulo, "level": minimo, "unlocked": nivel >= minimo}
            for minimo, chave, rotulo in TITULOS
        ],
        "capacidades": [
            {"key": chave, "label": rotulo, "level": minimo, "unlocked": nivel >= minimo}
            for minimo, chave, rotulo in CAPACIDADES
        ],
    }
