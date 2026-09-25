"""Endpoint do próprio utilizador — o frontend usa isto para saber o role
(admin/owner/super_admin) e mostrar a interface correta."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_admin

router = APIRouter(prefix="/me", tags=["Eu"])


@router.get("", response_model=schemas.UserOut)
def get_me(user: models.User = Depends(get_current_user)):
    return user


@router.post("/promote/{user_id}")
def promote_to_admin(
    user_id: str,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_admin),
):
    """Um super_admin (ou o próprio processo de setup inicial) promove outro
    utilizador a admin. Não exposto no frontend por padrão — usar via API
    diretamente na primeira configuração, ou promover manualmente na base
    de dados (mais simples para o primeiro admin do sistema)."""
    if current.role != models.UserRole.super_admin:
        from fastapi import HTTPException
        raise HTTPException(403, "Só um super_admin pode promover outros utilizadores.")
    target = db.query(models.User).filter(models.User.id == user_id).first()
    if not target:
        from fastapi import HTTPException
        raise HTTPException(404, "Utilizador não encontrado.")
    target.role = models.UserRole.admin
    db.commit()
    return {"ok": True}
