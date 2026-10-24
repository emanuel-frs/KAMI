"""
Mensagens de erro traduzíveis (I18N-01).

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
from starlette.exceptions import HTTPException


class ErroKami(HTTPException):
    def __init__(self, status_code: int, chave: str, texto_pt: str, headers: dict | None = None, **vars):
        super().__init__(status_code=status_code, detail=texto_pt.format(**vars) if vars else texto_pt, headers=headers)
        self.chave = chave
        self.texto_pt = texto_pt
        self.vars = vars
