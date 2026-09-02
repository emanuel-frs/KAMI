"""
Kami — API local (FastAPI).

Roda 100% na máquina do usuário, sem exposição externa: o Tauri
aponta o frontend (HTML/CSS/JS puro) pra este backend em
http://127.0.0.1:<porta dinâmica>. CORS liberado porque tudo é
local/localhost (ver nota junto do CORSMiddleware abaixo sobre uma
tentativa de restringir que foi revertida).
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.database import init_db
from app.version import KAMI_VERSION
from app.routers import perfil, nucleo, financas, carteira
from app.routers import aprendizado
from app.routers import metas
from app.routers import organizacao
from app.routers import dashboard
from app.routers import sistema
from app.routers import widgets
from app.routers import calendario
from app.routers import carreira

app = FastAPI(title="Kami API", version=KAMI_VERSION)

# CORS liberado (allow_origins=["*"]) porque tudo é local/localhost —
# revertido depois de uma tentativa de restringir a origens específicas
# do Tauri (auditoria de segurança) ter quebrado o app: os valores
# "tauri://localhost" / "http://tauri.localhost" documentados pelo
# Tauri v2 não bateram com a Origin real enviada nesta instalação
# (todo OPTIONS preflight voltava 400 do CORSMiddleware). Sem
# allow_credentials=True, não há sessão/cookie pra vazar via CORS
# aberto — o risco de "*" aqui é só outra página local conseguir ler
# a resposta da API via fetch(), risco baixo pro cenário single-user.
# Se quiser travar isso de verdade no futuro, descobrir a Origin real
# primeiro (ex.: logar o header Origin recebido, ou middleware
# temporário) antes de restringir de novo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok", "version": KAMI_VERSION}


# Traduz mensagens de erro de validação do Pydantic pra português —
# o texto padrão em inglês ("Input should be greater than 0") vazava
# direto pro usuário final em qualquer 422 (ex: POST /financas/transactions
# com amount=0). ctx (gt/le/ge/lt) vem do próprio erro do Pydantic v2;
# os nomes de chave batem com o que a versão instalada devolve (conferido
# manualmente dessa versão do Pydantic).
_PT_MESSAGES = {
    "greater_than": "deve ser maior que {gt}",
    "less_than_equal": "deve ser menor ou igual a {le}",
    "greater_than_equal": "deve ser maior ou igual a {ge}",
    "less_than": "deve ser menor que {lt}",
    "string_pattern_mismatch": "formato inválido",
    "missing": "campo obrigatório",
}


@app.exception_handler(RequestValidationError)
def validation_exception_handler(request, exc):
    errors = []
    for e in exc.errors():
        field = ".".join(str(p) for p in e["loc"] if p != "body")
        err_type = e.get("type", "")
        ctx = e.get("ctx", {})
        template = _PT_MESSAGES.get(err_type)
        if template:
            msg = f"{field}: {template.format(**ctx)}" if ctx else f"{field}: {template}"
        else:
            msg = f"{field}: {e.get('msg', 'valor inválido')}"
        errors.append(msg)
    return JSONResponse(status_code=422, content={"detail": "; ".join(errors)})


app.include_router(perfil.router, prefix="/api/perfil", tags=["perfil"])
app.include_router(nucleo.router, prefix="/api/nucleo", tags=["nucleo"])
app.include_router(financas.router, prefix="/api/financas", tags=["financas"])
app.include_router(carteira.router, prefix="/api/carteira", tags=["carteira"])
app.include_router(aprendizado.router, prefix="/api/aprendizado", tags=["aprendizado"])
app.include_router(metas.router, prefix="/api/metas", tags=["metas"])
app.include_router(organizacao.router, prefix="/api/organizacao", tags=["organizacao"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(sistema.router, prefix="/api/sistema", tags=["sistema"])
app.include_router(widgets.router, prefix="/api/widgets", tags=["widgets"])
app.include_router(calendario.router, prefix="/api/calendario", tags=["calendario"])
app.include_router(carreira.router, prefix="/api/carreira", tags=["carreira"])