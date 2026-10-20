"""
Limites de entrada da API (SEG-05).

Duas camadas:

1. `LimiteDeCorpoMiddleware`: corpo de requisição de no máximo 1 MB
   (50 MB no import de backup) — lido antes de chegar na rota, então um
   corpo gigante nunca é carregado inteiro nem parseado. Responde 413.

2. `Entrada`: base de TODO modelo de entrada (corpo de POST/PUT). Sem
   precisar anotar campo por campo:
   - texto: 200 caracteres por padrão (nomes, títulos, datas, ids,
     status…); 5.000 nos textos livres (`TEXTOS_LONGOS`), 2.000 em url,
     500 em segredos (senha de app, token, chave), 30.000 nos desenhos
     ASCII (avatar de 120 colunas passa de 14 mil caracteres). Campo com
     `max_length` próprio (`Field(..., max_length=n)`) usa o dele;
   - números: entre -10¹² e 10¹² — mais que isso não é valor de
     finanças nem contagem, e o SQLite não guarda inteiro acima de 2⁶³
     (virava 500);
   - `Infinity`/`NaN` (o JSON do Python aceita) são recusados.

Tudo vira 422 com mensagem em português (main.py traduz os códigos).
O teste tests/test_limites_entrada.py varre o OpenAPI e garante que
nenhuma rota responde 500 a entrada absurda e que todo modelo de entrada
herda daqui.
"""
from annotated_types import MaxLen
from pydantic import BaseModel, ConfigDict, field_validator
from pydantic_core import PydanticCustomError
from starlette.responses import JSONResponse

CORPO_MAX_BYTES = 1 * 1024 * 1024
CORPO_MAX_BYTES_IMPORT = 50 * 1024 * 1024
ROTAS_CORPO_GRANDE = {"/api/sistema/import"}

TEXTO_CURTO_MAX = 200
TEXTO_LONGO_MAX = 5000
URL_MAX = 2000
SEGREDO_MAX = 500
ASCII_MAX = 30000
NUMERO_MAX = 10**12

TEXTOS_LONGOS = {"description", "notes", "note", "general_goal", "reason"}
LIMITE_POR_CAMPO = {
    **{nome: TEXTO_LONGO_MAX for nome in TEXTOS_LONGOS},
    "url": URL_MAX,
    "token": SEGREDO_MAX,
    "api_key": SEGREDO_MAX,
    "app_password": SEGREDO_MAX,
    "avatar_ascii": ASCII_MAX,
    "icon_ascii": ASCII_MAX,
}


def limite_do_campo(model, nome: str) -> int:
    field = model.model_fields.get(nome)
    proprio = [m.max_length for m in (field.metadata if field else []) if isinstance(m, MaxLen)]
    return proprio[0] if proprio else LIMITE_POR_CAMPO.get(nome, TEXTO_CURTO_MAX)


def _conferir(valor, limite: int):
    if isinstance(valor, bool):
        return
    if isinstance(valor, str) and len(valor) > limite:
        raise PydanticCustomError("string_too_long", "texto longo demais", {"max_length": limite})
    if isinstance(valor, (int, float)) and abs(valor) > NUMERO_MAX:
        raise PydanticCustomError("numero_grande_demais", "número grande demais", {"limite": f"{NUMERO_MAX:.0e}"})
    if isinstance(valor, (list, tuple, set)):
        for item in valor:
            _conferir(item, limite)


class Entrada(BaseModel):
    """Base dos modelos de entrada — ver a docstring do módulo."""

    model_config = ConfigDict(str_max_length=ASCII_MAX, allow_inf_nan=False)

    @field_validator("*", mode="after")
    @classmethod
    def _limites(cls, valor, info):
        if not getattr(cls, "sem_limites_de_entrada", False):
            _conferir(valor, limite_do_campo(cls, info.field_name))
        return valor


# Modelos de RESPOSTA que herdam de um de entrada (ex.: DebtOut(DebtIn))
# usam isto + `sem_limites_de_entrada = True`: um registro antigo, de
# antes dos limites, com um nome mais longo, tem que continuar aparecendo
# (senão a listagem inteira daria 500).
SAIDA_CONFIG = ConfigDict(str_max_length=None, allow_inf_nan=True)


class LimiteDeCorpoMiddleware:
    """
    ASGI puro: junta o corpo até o limite da rota e, se passar, responde
    413 sem chamar a rota. Fica por dentro do token (requisição sem token
    nem chega a ser lida) e por fora do resto.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        limite = CORPO_MAX_BYTES_IMPORT if scope["path"] in ROTAS_CORPO_GRANDE else CORPO_MAX_BYTES

        declarado = dict(scope.get("headers") or []).get(b"content-length")
        if declarado and declarado.isdigit() and int(declarado) > limite:
            await self._recusar(scope, receive, send, limite)
            return

        partes, total = [], 0
        while True:
            msg = await receive()
            if msg["type"] == "http.disconnect":
                return
            corpo = msg.get("body", b"")
            total += len(corpo)
            if total > limite:
                await self._recusar(scope, receive, send, limite)
                return
            partes.append(corpo)
            if not msg.get("more_body"):
                break

        corpo_inteiro = b"".join(partes)
        entregue = False

        async def replay():
            nonlocal entregue
            if not entregue:
                entregue = True
                return {"type": "http.request", "body": corpo_inteiro, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

    @staticmethod
    async def _recusar(scope, receive, send, limite):
        mb = limite // (1024 * 1024)
        resp = JSONResponse(
            status_code=413,
            content={"detail": f"conteúdo grande demais (máximo {mb} MB)", "codigo": "grande_demais"},
        )
        await resp(scope, receive, send)
