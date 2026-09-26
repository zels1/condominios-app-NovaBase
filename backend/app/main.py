"""Ponto de entrada da API — junta todos os routers e configura CORS."""
import os
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

logger = logging.getLogger("condo-app")

from .database import engine
from .models import Base
from .routers import (
    condominiums, fractions, budgets, quotas, payments,
    latefees, reminders, suppliers, maintenance, assemblies,
    documents, dashboard, users, owners,
)

app = FastAPI(title="Gestão de Condomínios API", version="1.0.0")


# Apanha erros inesperados ANTES do CORS: assim a resposta 500 leva os cabeçalhos CORS
# e o browser mostra a mensagem real, em vez de um "NetworkError" genérico.
# Tem de ficar registado antes do app.add_middleware(CORSMiddleware, ...).
@app.middleware("http")
async def catch_unhandled_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro não tratado em %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Erro interno no servidor ({type(exc).__name__}: {exc})"},
        )


# Em produção usa a variável de ambiente FRONTEND_URL (ex: https://o-teu-site.vercel.app)
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
allowed_origins = [frontend_url] if frontend_url else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    condominiums.router, fractions.router, budgets.router, quotas.router, payments.router,
    latefees.router, reminders.router, suppliers.router, maintenance.router, assemblies.router,
    documents.router, dashboard.router, users.router, owners.router,
):
    app.include_router(router)


@app.get("/")
def root():
    return {"status": "ok", "service": "condo-app-api"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.on_event("startup")
def on_startup():
    # Cria as tabelas que ainda não existam. Em produção prefira Alembic para
    # migrações controladas; isto é apenas uma rede de segurança para o arranque.
    Base.metadata.create_all(bind=engine)

    # Pequenos ajustes de esquema em tabelas já existentes (create_all não altera
    # colunas de tabelas que já existem). Tudo aqui é seguro para correr repetidamente.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE fraction_owners ALTER COLUMN user_id DROP NOT NULL"))
        conn.execute(text("ALTER TABLE fraction_owners ADD COLUMN IF NOT EXISTS invited_email VARCHAR"))

        # Ficha completa do condómino (users)
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS nif VARCHAR"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS correspondence_address VARCHAR"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS iban VARCHAR"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT"))

        # Seguro da fração (fractions)
        conn.execute(text("ALTER TABLE fractions ADD COLUMN IF NOT EXISTS insurance_company VARCHAR"))
        conn.execute(text("ALTER TABLE fractions ADD COLUMN IF NOT EXISTS insurance_policy_number VARCHAR"))
        conn.execute(text("ALTER TABLE fractions ADD COLUMN IF NOT EXISTS insurance_valid_until DATE"))

        # Ficha completa do condomínio (condominiums)
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS district VARCHAR"))
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS municipality VARCHAR"))
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS construction_year INTEGER"))
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS registry_number VARCHAR"))
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS insurance_company VARCHAR"))
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS insurance_policy_number VARCHAR"))
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS insurance_valid_until DATE"))
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS external_management_name VARCHAR"))
        conn.execute(text("ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS external_management_contact VARCHAR"))
