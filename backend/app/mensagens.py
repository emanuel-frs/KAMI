"""
Mensagens de erro traduzíveis (I18N-01) e textos que o sistema grava no
banco (`Texto`, logo abaixo da ErroKami).

As traduções moram só no frontend (frontend/i18n/<idioma>.json). O backend
devolve, junto do texto de sempre, a CHAVE da mensagem e as variáveis:

    {"detail": "essa cópia não existe na pasta de backups",
     "codigo": "nao_encontrado",
     "chave": "erro.backups.copia_inexistente", "vars": {}}

O frontend (api/client.js) mostra `t(chave, vars)` no idioma da pessoa; o
`detail` em português continua lá pra quem usa a API direto e como
reserva. O teste tests/test_mensagens.py confere que toda chave usada aqui
existe no pt.json do frontend com o MESMO texto — uma fonte só, sem os dois
lados se desencontrarem.

Uso nas rotas:

    raise ErroKami(404, "erro.backups.copia_inexistente", "essa cópia não existe na pasta de backups")
    raise ErroKami(422, "erro.lembretes.hora_passou", "esse horário já passou")
    raise ErroKami(422, "erro.pin.tamanho", "o PIN tem de {min} a {max} dígitos", min=4, max=8)
"""
import json

from starlette.exceptions import HTTPException


class ErroKami(HTTPException):
    def __init__(self, status_code: int, chave: str, texto_pt: str, headers: dict | None = None, **vars):
        super().__init__(status_code=status_code, detail=texto_pt.format(**vars) if vars else texto_pt, headers=headers)
        self.chave = chave
        self.texto_pt = texto_pt
        self.vars = vars


class Texto(str):
    """
    Texto que o sistema GRAVA no banco (registro de atividade, descrição de
    lançamento automático): é o próprio texto em português — continua
    funcionando como string em todo lugar que já usava — e carrega a chave e
    as variáveis pra ser gravado junto (colunas `descricao_chave` e
    `descricao_vars`). O frontend mostra `t(chave, vars)` no idioma da
    pessoa; as variáveis são o que a pessoa escreveu (nome da conta, da
    meta…) e nunca são traduzidas.

        register_action(db, description=Texto("log.conta_fixa.paga", "pagou conta fixa: {nome}", nome=bill["name"]), ...)

    Mesma regra da ErroKami: chave e texto literais, conferidos contra o
    pt.json por tests/test_mensagens.py.
    """

    def __new__(cls, chave: str, texto_pt: str, **vars):
        obj = super().__new__(cls, texto_pt.format(**vars) if vars else texto_pt)
        obj.chave = chave
        obj.vars = vars
        return obj


def colunas_do_texto(descricao) -> tuple:
    """(descricao_chave, descricao_vars em JSON) pra gravar — (None, None) se for texto comum."""
    if isinstance(descricao, Texto):
        return descricao.chave, json.dumps(descricao.vars, ensure_ascii=False) if descricao.vars else None
    return None, None


def texto_da_linha(row) -> dict:
    """`description_key`/`description_vars` de uma linha do banco, pra resposta da API."""
    vars_ = row["descricao_vars"]
    return {"description_key": row["descricao_chave"], "description_vars": json.loads(vars_) if vars_ else {}}
