"""Cópia de segurança descarregável pelo administrador.

Gera um ZIP com todos os dados (um ficheiro JSON e um CSV por tabela) e, se pedido, os
ficheiros carregados (fotos, documentos, apólices, contratos).
- super_admin: a plataforma inteira;
- admin: só os condomínios que gere (e as pessoas ligadas a eles)."""
import csv
import io
import json
import tempfile
import zipfile
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..auth import require_admin
from ..database import get_db
from ..services.storage import download_file, is_private_ref, StorageError

router = APIRouter(prefix="/backup", tags=["Cópia de segurança"])

# colunas que guardam ficheiros carregados para o Storage
FILE_COLUMNS = {
    "documents": ["file_url"],
    "fractions": ["insurance_document_url"],
    "contracts": ["document_url"],
    "occurrences": ["photo_url"],
    "proxies": ["document_url"],
    "assemblies": ["minutes_document_url"],
    "expenses": ["document_url"],
}


def _plain(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if hasattr(v, "value"):  # enums
        return v.value
    return v


def _collect(db: Session, admin: models.User) -> dict:
    """{nome_tabela: [linhas]} — tudo (super_admin) ou só o que pertence aos condomínios do admin."""
    tables = [t for t in models.Base.metadata.sorted_tables]
    rows = {}
    if admin.role == models.UserRole.super_admin:
        for t in tables:
            rows[t.name] = [dict(r._mapping) for r in db.execute(t.select()).all()]
        return rows

    condo_ids = {r[0] for r in db.query(models.Condominium.id).filter(models.Condominium.admin_user_id == admin.id).all()}
    ids = {"condominiums": condo_ids}
    for t in tables:
        if t.name == "users":
            continue
        if t.name == "condominiums":
            sel = t.select().where(t.c.id.in_(condo_ids)) if condo_ids else None
        elif "condominium_id" in t.c:
            sel = t.select().where(t.c.condominium_id.in_(condo_ids)) if condo_ids else None
        else:
            # tabela "filha": filtra pela primeira chave estrangeira para uma tabela já incluída
            sel = None
            for fk in t.foreign_keys:
                parent = fk.column.table.name
                if parent in ids and parent != "users":
                    sel = t.select().where(fk.parent.in_(ids[parent])) if ids[parent] else None
                    break
            else:
                continue  # tabela sem ligação a um condomínio: não entra
        data = [dict(r._mapping) for r in db.execute(sel).all()] if sel is not None else []
        rows[t.name] = data
        if "id" in t.c:
            ids[t.name] = {r["id"] for r in data}
    # pessoas: o próprio admin e quem está ligado às frações destes condomínios
    user_ids = {admin.id} | {r["user_id"] for r in rows.get("fraction_owners", []) if r.get("user_id")}
    users = models.Base.metadata.tables["users"]
    rows["users"] = [dict(r._mapping) for r in db.execute(users.select().where(users.c.id.in_(user_ids))).all()]
    return rows


@router.get("")
def download_backup(include_files: bool = False, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    rows = _collect(db, admin)
    now = datetime.now()
    scope = "plataforma completa" if admin.role == models.UserRole.super_admin else "condomínios geridos por " + (admin.email or "")
    spool = tempfile.SpooledTemporaryFile(max_size=50 * 1024 * 1024)
    files_ok, files_failed, external = 0, [], []
    with zipfile.ZipFile(spool, "w", zipfile.ZIP_DEFLATED) as z:
        counts = {}
        for name, data in sorted(rows.items()):
            plain = [{k: _plain(v) for k, v in r.items()} for r in data]
            counts[name] = len(plain)
            z.writestr(f"dados/{name}.json", json.dumps(plain, ensure_ascii=False, indent=1))
            if plain:
                buf = io.StringIO()
                w = csv.DictWriter(buf, fieldnames=list(plain[0].keys()), delimiter=";")
                w.writeheader()
                w.writerows(plain)
                z.writestr(f"csv/{name}.csv", "﻿" + buf.getvalue())  # BOM para o Excel abrir com acentos
        if include_files:
            seen = set()
            for table, cols in FILE_COLUMNS.items():
                for r in rows.get(table, []):
                    for c in cols:
                        ref = r.get(c)
                        if not ref or ref in seen:
                            continue
                        seen.add(ref)
                        if not is_private_ref(ref) and "/storage/v1/object/public/" not in ref:
                            external.append(ref)  # link para fora (ex: Google Drive): não é um ficheiro da app
                            continue
                        try:
                            path, content = download_file(ref)
                            z.writestr(f"ficheiros/{path}", content)
                            files_ok += 1
                        except StorageError as e:
                            files_failed.append({"ficheiro": ref, "erro": str(e)})
        manifest = {
            "aplicacao": "Domvus",
            "criada_em": now.isoformat(timespec="seconds"),
            "criada_por": admin.email,
            "ambito": scope,
            "registos_por_tabela": counts,
            "ficheiros_incluidos": files_ok if include_files else "não pedidos",
            "ficheiros_com_erro": files_failed,
            "links_externos_nao_incluidos": external,
        }
        z.writestr("manifesto.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        z.writestr("LEIA-ME.txt", (
            "Cópia de segurança Domvus\n"
            f"Criada em {now:%d/%m/%Y %H:%M} por {admin.email} ({scope}).\n\n"
            "dados/   - todas as tabelas em JSON (para restaurar ou migrar)\n"
            "csv/     - as mesmas tabelas em CSV (abrem no Excel)\n"
            "ficheiros/ - fotos, documentos, apólices e contratos (se incluídos)\n\n"
            "Não inclui as palavras-passe: essas ficam no Supabase (Authentication).\n"
            "Contém dados pessoais — guarde este ficheiro num local seguro e privado.\n"
        ))
    db.add(models.AuditLog(user_id=admin.id, action="backup.downloaded", entity_type="backup",
                           details={"scope": scope, "include_files": include_files, "tables": len(rows)}))
    db.commit()
    spool.seek(0)
    filename = f"domvus-copia-{now:%Y-%m-%d-%H%M}.zip"
    return StreamingResponse(spool, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
