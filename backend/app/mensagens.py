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


def _reais(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


class ErroKami(HTTPException):
    """Variável `valor_*` é dinheiro: vai como número (o frontend escreve na
    moeda da pessoa, I18N-06) e no `detail` em português sai em reais."""

    def __init__(self, status_code: int, chave: str, texto_pt: str, headers: dict | None = None, **vars):
        legivel = {k: _reais(v) if k.startswith("valor") and isinstance(v, (int, float)) else v for k, v in vars.items()}
        super().__init__(status_code=status_code, detail=texto_pt.format(**legivel) if vars else texto_pt, headers=headers)
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
        obj.texto_pt = texto_pt
        obj.vars = vars
        return obj


def erro_de(exc: Exception, status_code: int, headers: dict | None = None) -> HTTPException:
    """Exceção do domínio (PIN, backup protegido, pasta extra…) → resposta.
    Se a mensagem é um Texto (tem chave), vira ErroKami e sai no idioma da
    pessoa; senão, o texto de sempre."""
    msg = exc.args[0] if exc.args else None
    if isinstance(msg, Texto):
        return ErroKami(status_code, msg.chave, msg.texto_pt, headers=headers, **msg.vars)
    return HTTPException(status_code=status_code, detail=str(exc), headers=headers)


def colunas_do_texto(descricao) -> tuple:
    """(descricao_chave, descricao_vars em JSON) pra gravar — (None, None) se for texto comum."""
    if isinstance(descricao, Texto):
        return descricao.chave, json.dumps(descricao.vars, ensure_ascii=False) if descricao.vars else None
    return None, None


def texto_da_linha(row) -> dict:
    """`description_key`/`description_vars` de uma linha do banco, pra resposta da API."""
    vars_ = row["descricao_vars"]
    return {"description_key": row["descricao_chave"], "description_vars": json.loads(vars_) if vars_ else {}}
