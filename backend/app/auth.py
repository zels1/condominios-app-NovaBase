"""
Autenticação via Supabase Auth.

O frontend usa o SDK do Supabase para login/registo e envia o JWT resultante
no header Authorization. Aqui só validamos esse JWT (usando o segredo do
projeto Supabase) e mapeamos para o nosso User local, que guarda o role
(admin / owner / super_admin) e liga a fracões.
"""
import os
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from . import models
from .database import get_db

SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")

security = HTTPBearer()

# Projetos Supabase mais recentes assinam os tokens com chaves assimétricas
# (ES256/RS256), publicadas no endpoint JWKS do projeto, em vez do esquema
# antigo (segredo partilhado HS256). Suportamos os dois: se o token vier
# assinado com HS256 usamos o segredo; caso contrário vamos buscar a chave
# pública certa ao JWKS do Supabase.
_jwks_client = PyJWKClient(SUPABASE_URL.rstrip("/") + "/auth/v1/.well-known/jwks.json") if SUPABASE_URL else None


def decode_supabase_token(token: str) -> dict:
    try:
        alg = jwt.get_unverified_header(token).get("alg", "HS256")
        if alg == "HS256":
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            if not _jwks_client:
                raise HTTPException(
                    status_code=500,
                    detail="SUPABASE_URL não configurado no servidor (necessário para validar tokens assinados com chaves assimétricas).",
                )
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
            )
        return payload
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Token inválido: {e}")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    payload = decode_supabase_token(credentials.credentials)
    supabase_user_id = payload.get("sub")
    email = payload.get("email")

    user = db.query(models.User).filter(models.User.supabase_user_id == supabase_user_id).first()
    if not user:
        # primeiro login: cria o registo local automaticamente como 'owner' por defeito.
        # Um admin tem de ser promovido manualmente (ou via convite) a role=admin.
        user = models.User(
            email=email,
            full_name=payload.get("user_metadata", {}).get("full_name", email),
            supabase_user_id=supabase_user_id,
            role=models.UserRole.owner,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role not in (models.UserRole.admin, models.UserRole.super_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Apenas administradores podem aceder.")
    return user


def require_condo_admin(
    condominium_id: str,
    user: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> models.User:
    """Dependência de rota: confirma que o admin autenticado gere especificamente
    este condomínio (um super_admin passa sempre). Funciona em qualquer rota que
    tenha um parâmetro de path chamado 'condominium_id' — o FastAPI faz o match
    automático pelo nome."""
    if user.role == models.UserRole.super_admin:
        return user
    condo = db.query(models.Condominium).filter(models.Condominium.id == condominium_id).first()
    if not condo or condo.admin_user_id != user.id:
        raise HTTPException(status_code=403, detail="Não geres este condomínio.")
    return user


def get_user_fraction_ids(db: Session, user: models.User) -> list:
    """Devolve os ids das frações que este utilizador possui (para acesso de condómino)."""
    rows = db.query(models.FractionOwner.fraction_id).filter(models.FractionOwner.user_id == user.id).all()
    return [r[0] for r in rows]
