"""Documentos (com alerta de expiração) e comunicados gerais."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date, timedelta
from typing import List

from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_condo_admin

router = APIRouter(prefix="/condominiums/{condominium_id}", tags=["Documentos e Comunicados"])


@router.post("/documents", response_model=schemas.DocumentOut)
def upload_document(condominium_id: str, payload: schemas.DocumentCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    doc = models.Document(condominium_id=condominium_id, uploaded_by=user.id, **payload.model_dump())
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/documents", response_model=List[schemas.DocumentOut])
def list_documents(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.Document).filter(models.Document.condominium_id == condominium_id).order_by(models.Document.created_at.desc()).all()


@router.delete("/documents/{document_id}")
def delete_document(condominium_id: str, document_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    doc = db.query(models.Document).filter(models.Document.id == document_id, models.Document.condominium_id == condominium_id).first()
    if not doc:
        raise HTTPException(404, "Documento não encontrado.")
    db.delete(doc)
    db.commit()
    return {"ok": True}


@router.post("/communications", response_model=schemas.CommunicationOut)
def send_communication(condominium_id: str, payload: schemas.CommunicationCreate, db: Session = Depends(get_db), user: models.User = Depends(require_condo_admin)):
    comm = models.Communication(condominium_id=condominium_id, sent_by=user.id, **payload.model_dump())
    db.add(comm)
    db.commit()
    db.refresh(comm)
    return comm


@router.get("/communications", response_model=List[schemas.CommunicationOut])
def list_communications(condominium_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.Communication).filter(models.Communication.condominium_id == condominium_id).order_by(models.Communication.created_at.desc()).all()
