import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/condo")

# Usa explicitamente o driver psycopg2 (o instalado via requirements.txt);
# sem isto o SQLAlchemy 2.0 tenta o driver "psycopg" (v3), que não instalamos.
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# Supabase (e a maioria dos hosts Postgres geridos) exige SSL; localhost não.
connect_args = {}
if "supabase" in DATABASE_URL or "sslmode" not in DATABASE_URL:
    if "localhost" not in DATABASE_URL and "127.0.0.1" not in DATABASE_URL:
        connect_args = {"sslmode": "require"}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
