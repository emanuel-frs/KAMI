"""
Kami — API local (FastAPI).

Roda 100% na máquina do usuário, sem exposição externa: o Tauri
aponta o frontend (HTML/CSS/JS puro) pra este backend em
http://127.0.0.1:8000. CORS liberado porque tudo é local/localhost.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.version import KAMI_VERSION
from app.routers import perfil, nucleo, financas, wallet
from app.routers import aprendizado
from app.routers import metas
from app.routers import organizacao
from app.routers import dashboard
from app.routers import system
from app.routers import widgets
from app.routers import calendario

app = FastAPI(title="Kami API", version=KAMI_VERSION)

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


app.include_router(perfil.router, prefix="/api/perfil", tags=["perfil"])
app.include_router(nucleo.router, prefix="/api/nucleo", tags=["nucleo"])
app.include_router(financas.router, prefix="/api/financas", tags=["financas"])
app.include_router(wallet.router, prefix="/api/wallet", tags=["wallet"])
app.include_router(aprendizado.router, prefix="/api/aprendizado", tags=["aprendizado"])
app.include_router(metas.router, prefix="/api/metas", tags=["metas"])
app.include_router(organizacao.router, prefix="/api/organizacao", tags=["organizacao"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(widgets.router, prefix="/api/widgets", tags=["widgets"])
app.include_router(calendario.router, prefix="/api/calendario", tags=["calendario"])