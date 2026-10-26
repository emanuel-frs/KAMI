"""
I18N: textos que o backend cria e o frontend traduz pela chave —
conquistas do seed, missões, títulos e temas das recompensas. O português
mora nos dois lados (aqui, como reserva pra quem usa a API direto; no
frontend/i18n/pt.json, como fonte das traduções); este teste garante que
não se desencontram — mudar um texto aqui sem mudar lá (e nos outros 9
idiomas) quebra.
"""
import json
from pathlib import Path

from app.achievements import ACHIEVEMENT_SEED
from app.missoes import DIARIAS, SEMANAIS, nome_da_missao
from app.recompensas import TEMAS, TITULOS
from app.routers.nucleo import CLASS_BY_ATTRIBUTE, POLYMATH_CLASS, SECRET_DESCRIPTION, SECRET_TITLE
from app.widgets import WIDGET_CATALOG

PT = json.loads((Path(__file__).resolve().parents[2] / "frontend" / "i18n" / "pt.json").read_text(encoding="utf-8"))


def _confere(pares):
    for chave, texto in pares:
        assert chave in PT, f"{chave} não está no frontend/i18n/pt.json"
        assert PT[chave] == texto, f"{chave} difere do pt.json:\n  {texto!r}\n  {PT[chave]!r}"


def test_conquistas_do_seed():
    _confere(
        par
        for a in ACHIEVEMENT_SEED
        for par in ((f"conquista.{a['key']}.titulo", a["title"]), (f"conquista.{a['key']}.descricao", a["description"]))
    )
    _confere([("conquista.secreta.titulo", SECRET_TITLE), ("conquista.secreta.descricao", SECRET_DESCRIPTION)])


def test_missoes():
    _confere((f"missao.dia.{tipo}", texto) for tipo, texto in DIARIAS.items())
    _confere((f"missao.semana.{tipo}", s["titulo"]) for tipo, s in SEMANAIS.items())


def test_recompensas():
    _confere((f"recompensa.titulo.{chave}", rotulo) for _, chave, rotulo in TITULOS)
    _confere(
        par
        for _, chave, rotulo, desc in TEMAS
        for par in ((f"recompensa.tema.{chave}", rotulo), (f"recompensa.tema.{chave}.desc", desc))
    )


def test_nome_da_missao():
    assert nome_da_missao(DIARIAS["meta"].format(nome="viagem")) == "viagem"
    assert nome_da_missao(DIARIAS["habito"].format(nome='ler "duna"')) == 'ler "duna"'
    assert nome_da_missao(DIARIAS["link"]) is None


def test_classes_e_widgets():
    _confere((f"classe.{attr}", rotulo) for attr, rotulo in CLASS_BY_ATTRIBUTE.items())
    _confere([("classe.polimata", POLYMATH_CLASS)])
    _confere((f"widget.{tipo}", d["label"]) for tipo, d in WIDGET_CATALOG.items())
