"""Envio de ficheiros para o Supabase Storage a partir do servidor.

O upload passa pelo backend (e não diretamente do browser) para que:
- o limite de tamanho definido pelo administrador seja verificado no servidor;
- não seja preciso configurar políticas de acesso (RLS) no Storage do Supabase;
- o bucket seja criado automaticamente na primeira utilização.

Variáveis de ambiente necessárias (no Render):
- SUPABASE_URL                — ex: https://xxxx.supabase.co
- SUPABASE_SERVICE_ROLE_KEY   — chave "service_role" / "secret" (Project Settings → API Keys).
                                Nunca colocar esta chave no frontend.
"""
import json
import os
import urllib.error
import urllib.request

PHOTO_BUCKET = "occurrence-photos"
_TIMEOUT = 30
_buckets_ready: set = set()


class StorageError(Exception):
    """Erro com mensagem pronta a mostrar ao utilizador."""


def _config():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise StorageError(
            "O envio de fotos ainda não está configurado no servidor: falta definir "
            "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render."
        )
    return url, key


def _request(method: str, url: str, key: str, body: bytes = b"", content_type: str = "application/json", extra=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": content_type}
    headers.update(extra or {})
    req = urllib.request.Request(url, data=body if method != "GET" else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        raise StorageError(f"Não foi possível contactar o armazenamento de ficheiros ({e.reason}).")


def _ensure_bucket(url: str, key: str, bucket: str):
    """Cria o bucket (público para leitura) se ainda não existir."""
    if bucket in _buckets_ready:
        return
    status, body = _request("GET", f"{url}/storage/v1/bucket/{bucket}", key)
    if status == 200:
        _buckets_ready.add(bucket)
        return
    payload = json.dumps({"id": bucket, "name": bucket, "public": True}).encode()
    status, body = _request("POST", f"{url}/storage/v1/bucket", key, payload)
    text = body.decode(errors="ignore")
    if status in (200, 201) or "already exists" in text.lower() or "duplicate" in text.lower():
        _buckets_ready.add(bucket)
        return
    raise StorageError(f"Não foi possível preparar o armazenamento de fotos (erro {status}: {text[:200]}).")


def upload_public_file(data: bytes, path: str, content_type: str, bucket: str = PHOTO_BUCKET) -> str:
    """Envia o ficheiro e devolve o URL público."""
    url, key = _config()

    def send():
        _ensure_bucket(url, key, bucket)
        return _request(
            "POST", f"{url}/storage/v1/object/{bucket}/{path}", key, data, content_type,
            extra={"x-upsert": "false", "cache-control": "max-age=31536000"},
        )

    status, body = send()
    if status in (400, 404) and b"bucket not found" in body.lower():
        # O bucket foi apagado depois de o servidor arrancar: volta a criá-lo e tenta outra vez
        _buckets_ready.discard(bucket)
        status, body = send()
    if status not in (200, 201):
        raise StorageError(f"O armazenamento recusou a foto (erro {status}: {body.decode(errors='ignore')[:200]}).")
    return f"{url}/storage/v1/object/public/{bucket}/{path}"
