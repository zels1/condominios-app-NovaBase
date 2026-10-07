"""Ponto de entrada da API — junta todos os routers e configura CORS."""
import os
import re
import time
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
    documents, dashboard, users, owners, account, maintenance_tasks, charges, backup, legal,
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
    # para o browser conseguir ler o nome do ficheiro nos downloads (ex: recibos em PDF)
    expose_headers=["Content-Disposition"],
)

for router in (
    condominiums.router, fractions.router, budgets.router, quotas.router, payments.router,
    latefees.router, reminders.router, suppliers.router, maintenance.router, assemblies.router,
    documents.router, dashboard.router, dashboard.overview_router, users.router, owners.router,
    account.router, maintenance_tasks.router, owners.platform_router, charges.router, backup.router, legal.router, legal.me_router,
):
    app.include_router(router)


@app.get("/")
def root():
    return {"status": "ok", "service": "condo-app-api"}


@app.get("/health")
def health():
    return {"status": "healthy"}


# Ajustes de esquema em tabelas já existentes (create_all não altera colunas de tabelas
# que já existem). Cada linha é segura para correr repetidamente.
MIGRATIONS = [
    'ALTER TABLE fraction_owners ALTER COLUMN user_id DROP NOT NULL',
    'ALTER TABLE fraction_owners ADD COLUMN IF NOT EXISTS invited_email VARCHAR',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS nif VARCHAR',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS correspondence_address VARCHAR',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS iban VARCHAR',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS landline_phone VARCHAR',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_ack_version VARCHAR',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_ack_at TIMESTAMP',
    'ALTER TABLE fractions ADD COLUMN IF NOT EXISTS insurance_company VARCHAR',
    'ALTER TABLE fractions ADD COLUMN IF NOT EXISTS insurance_policy_number VARCHAR',
    'ALTER TABLE fractions ADD COLUMN IF NOT EXISTS insurance_valid_until DATE',
    'ALTER TABLE fractions ADD COLUMN IF NOT EXISTS insurance_document_url VARCHAR',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS district VARCHAR',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS municipality VARCHAR',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS construction_year INTEGER',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS registry_number VARCHAR',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS insurance_company VARCHAR',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS insurance_policy_number VARCHAR',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS insurance_valid_until DATE',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS external_management_name VARCHAR',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS external_management_contact VARCHAR',
    'ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS max_upload_mb INTEGER DEFAULT 5',
    'ALTER TABLE reminder_logs ALTER COLUMN reminder_config_id DROP NOT NULL',
    "ALTER TABLE charge_types ADD COLUMN IF NOT EXISTS frequency VARCHAR DEFAULT 'mensal'",
    'ALTER TABLE charge_types ADD COLUMN IF NOT EXISTS start_month DATE',
    "ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'manual'",
    'ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE',
    "ALTER TABLE quotas ADD COLUMN IF NOT EXISTS kind VARCHAR NOT NULL DEFAULT 'regular'",
    'ALTER TABLE quotas ADD COLUMN IF NOT EXISTS description VARCHAR',
    'ALTER TABLE quotas DROP CONSTRAINT IF EXISTS uq_quota_fraction_month',
    # quotas repartidas pelos proprietários: deixa de haver uma só quota mensal por fração
    'DROP INDEX IF EXISTS uq_quota_regular_month',
    'ALTER TABLE quotas ADD COLUMN IF NOT EXISTS owner_link_id UUID REFERENCES fraction_owners(id) ON DELETE SET NULL',
    'ALTER TABLE quotas ADD COLUMN IF NOT EXISTS billed_to VARCHAR',
    "ALTER TABLE fractions ADD COLUMN IF NOT EXISTS billing_mode VARCHAR NOT NULL DEFAULT 'split'",
    'ALTER TABLE fractions ADD COLUMN IF NOT EXISTS billing_owner_link_id UUID',
    'CREATE INDEX IF NOT EXISTS ix_quota_fraction_month ON quotas (fraction_id, reference_month)',
]


def _already_applied(conn, sql: str) -> bool:
    """Evita tocar na tabela (e pedir um bloqueio exclusivo) quando a alteração já lá está."""
    m = re.match(r"ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)", sql)
    if m:
        return conn.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
            "AND table_name = :t AND column_name = :c"), {"t": m.group(1), "c": m.group(2)}).first() is not None
    m = re.match(r"ALTER TABLE (\w+) ALTER COLUMN (\w+) DROP NOT NULL", sql)
    if m:
        return conn.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
            "AND table_name = :t AND column_name = :c AND is_nullable = 'YES'"), {"t": m.group(1), "c": m.group(2)}).first() is not None
    m = re.match(r"ALTER TABLE (\w+) DROP CONSTRAINT IF EXISTS (\w+)", sql)
    if m:
        return conn.execute(text("SELECT 1 FROM pg_constraint WHERE conname = :c"), {"c": m.group(2)}).first() is None
    m = re.match(r"DROP INDEX IF EXISTS (\w+)", sql)
    if m:
        return conn.execute(text("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :i"),
                            {"i": m.group(1)}).first() is None
    m = re.match(r"CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)", sql)
    if m:
        return conn.execute(text("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :i"),
                            {"i": m.group(1)}).first() is not None
    return False


def run_migrations():
    """Aplica só as alterações em falta, uma de cada vez e em transações curtas.
    (Antes corriam todas numa única transação, que bloqueava as tabelas principais durante
    o arranque; com a aplicação em uso, isso podia entrar em conflito com os pedidos em curso
    e impedir a nova versão de arrancar.)"""
    for sql in MIGRATIONS:
        last_error = None
        for attempt in range(1, 7):
            try:
                with engine.begin() as conn:
                    if _already_applied(conn, sql):
                        break
                    # se a tabela estiver ocupada, desiste ao fim de 5 s e tenta outra vez
                    conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                    conn.execute(text(sql))
                    logger.warning("Migração aplicada: %s", sql)
                    break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.warning("Migração à espera (tentativa %s/6): %s — %s", attempt, sql, type(exc).__name__)
                time.sleep(2)
        else:
            raise RuntimeError(f"Não foi possível aplicar a alteração à base de dados: {sql}") from last_error


@app.on_event("startup")
def on_startup():
    # Cria as tabelas que ainda não existam. Em produção prefira Alembic para
    # migrações controladas; isto é apenas uma rede de segurança para o arranque.
    Base.metadata.create_all(bind=engine)
    run_migrations()
