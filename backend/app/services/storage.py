"""Ligação ao Supabase a partir do servidor: Storage (fotos e documentos) e Auth (admin).

O upload passa pelo backend (e não diretamente do browser) para que:
- os limites de tamanho e os tipos de ficheiro sejam verificados no servidor;
- não seja preciso configurar políticas de acesso (RLS) no Storage do Supabase;
- os buckets sejam criados automaticamente na primeira utilização.

Variáveis de ambiente necessárias (no Render):
- SUPABASE_URL                — ex: https://xxxx.supabase.co
- SUPABASE_SERVICE_ROLE_KEY   — chave "service_role" / "secret" (Project Settings → API Keys).
                                Nunca colocar esta chave no frontend.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

PHOTO_BUCKET = "occurrence-photos"      # público (URLs impossíveis de adivinhar)
DOCUMENT_BUCKET = "condo-documents"     # privado: só se abre com link temporário
STORAGE_PREFIX = "sb://"                # como guardamos na BD um ficheiro privado: sb://bucket/caminho
_TIMEOUT = 30
_buckets_ready: set = set()


class StorageError(Exception):
    """Erro com mensagem pronta a mostrar ao utilizador."""


def _config(what: str = "O envio de ficheiros"):
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise StorageError(
            f"{what} ainda não está configurado no servidor: falta definir "
            "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render."
        )
    return url, key


def _request(method: str, url: str, key: str, body: bytes = b"", content_type: str = "application/json", extra=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": content_type}
    headers.update(extra or {})
    data = body if method not in ("GET",) else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        raise StorageError(f"Não foi possível contactar o Supabase ({e.reason}).")


def _quote_path(path: str) -> str:
    return urllib.parse.quote(path, safe="/")


def _ensure_bucket(url: str, key: str, bucket: str, public: bool):
    """Cria o bucket se ainda não existir."""
    if bucket in _buckets_ready:
        return
    status, body = _request("GET", f"{url}/storage/v1/bucket/{bucket}", key)
    if status == 200:
        _buckets_ready.add(bucket)
        return
    payload = json.dumps({"id": bucket, "name": bucket, "public": public}).encode()
    status, body = _request("POST", f"{url}/storage/v1/bucket", key, payload)
    text = body.decode(errors="ignore")
    if status in (200, 201) or "already exists" in text.lower() or "duplicate" in text.lower():
        _buckets_ready.add(bucket)
        return
    raise StorageError(f"Não foi possível preparar o armazenamento de ficheiros (erro {status}: {text[:200]}).")


def _upload(data: bytes, path: str, content_type: str, bucket: str, public: bool):
    url, key = _config()

    def send():
        _ensure_bucket(url, key, bucket, public)
        return _request(
            "POST", f"{url}/storage/v1/object/{bucket}/{_quote_path(path)}", key, data, content_type,
            extra={"x-upsert": "false", "cache-control": "max-age=31536000"},
        )

    status, body = send()
    if status in (400, 404) and b"bucket not found" in body.lower():
        # O bucket foi apagado depois de o servidor arrancar: volta a criá-lo e tenta outra vez
        _buckets_ready.discard(bucket)
        status, body = send()
    if status not in (200, 201):
        raise StorageError(f"O armazenamento recusou o ficheiro (erro {status}: {body.decode(errors='ignore')[:200]}).")
    return url


def upload_public_file(data: bytes, path: str, content_type: str, bucket: str = PHOTO_BUCKET) -> str:
    """Envia para um bucket público e devolve o URL público (usado nas fotos das ocorrências)."""
    url = _upload(data, path, content_type, bucket, public=True)
    return f"{url}/storage/v1/object/public/{bucket}/{_quote_path(path)}"


def upload_private_file(data: bytes, path: str, content_type: str, bucket: str = DOCUMENT_BUCKET) -> str:
    """Envia para um bucket privado e devolve a referência interna sb://bucket/caminho."""
    _upload(data, path, content_type, bucket, public=False)
    return f"{STORAGE_PREFIX}{bucket}/{path}"


def is_private_ref(ref: str) -> bool:
    return bool(ref) and ref.startswith(STORAGE_PREFIX)


def _split_ref(ref: str):
    bucket, _, path = ref[len(STORAGE_PREFIX):].partition("/")
    return bucket, path


def signed_url(ref: str, expires_in: int = 3600, download_name: str = None) -> str:
    """Link temporário para abrir um ficheiro privado (por defeito válido 1 hora)."""
    url, key = _config()
    bucket, path = _split_ref(ref)
    payload = json.dumps({"expiresIn": expires_in}).encode()
    status, body = _request("POST", f"{url}/storage/v1/object/sign/{bucket}/{_quote_path(path)}", key, payload)
    if status != 200:
        raise StorageError(f"Não foi possível gerar o link do ficheiro (erro {status}).")
    data = json.loads(body)
    signed = data.get("signedURL") or data.get("signedUrl") or ""
    if signed.startswith("http"):
        full = signed
    else:
        full = f"{url}/storage/v1{signed if signed.startswith('/') else '/' + signed}"
    if download_name:
        full += ("&" if "?" in full else "?") + "download=" + urllib.parse.quote(download_name)
    return full


def delete_file(ref: str) -> None:
    """Apaga um ficheiro privado (ignora erros — o registo na BD é o que conta)."""
    try:
        url, key = _config()
        bucket, path = _split_ref(ref)
        payload = json.dumps({"prefixes": [path]}).encode()
        _request("DELETE", f"{url}/storage/v1/object/{bucket}", key, payload)
    except StorageError:
        pass


# ---------- Auth (admin) ----------
def update_auth_email(supabase_user_id: str, new_email: str) -> None:
    """Muda o email de login de uma conta do Supabase (já confirmado, sem email de verificação)."""
    url, key = _config()
    payload = json.dumps({"email": new_email, "email_confirm": True}).encode()
    status, body = _request("PUT", f"{url}/auth/v1/admin/users/{supabase_user_id}", key, payload)
    if status in (200, 201):
        return
    text = body.decode(errors="ignore")
    if status == 422 or "already" in text.lower():
        raise StorageError("Já existe outra conta de login com esse email.")
    raise StorageError(f"Não foi possível alterar o email de login (erro {status}: {text[:200]}).")


def _password_error(status: int, text: str) -> str:
    low = text.lower()
    if "weak" in low or "should be at least" in low or "password" in low and status == 422:
        return "Palavra-passe recusada pelo Supabase: é demasiado curta ou fraca. Usa pelo menos 8 caracteres, com letras e números."
    return f"O Supabase recusou o pedido (erro {status}: {text[:200]})."


def _auth_id_by_email(url: str, key: str, email: str):
    """id da conta de login com este email (sem enviar email nenhum), ou None se não existir."""
    status, body = _request("POST", f"{url}/auth/v1/admin/generate_link", key,
                            json.dumps({"type": "magiclink", "email": email}).encode())
    if status in (200, 201):
        data = json.loads(body or b"{}")
        return data.get("id") or (data.get("user") or {}).get("id")
    return None


def create_auth_user(email: str, password: str, full_name: str = None) -> str:
    """Cria a conta de login (email já confirmado) com a palavra-passe indicada. Se já existir
    uma conta com este email (ex: convite enviado antes), reaproveita-a e muda-lhe a palavra-passe.
    Devolve o id da conta no Supabase."""
    url, key = _config("A gestão de contas de acesso")
    payload = {"email": email, "password": password, "email_confirm": True,
               "user_metadata": {"full_name": full_name} if full_name else {}}
    status, body = _request("POST", f"{url}/auth/v1/admin/users", key, json.dumps(payload).encode())
    if status in (200, 201):
        return json.loads(body)["id"]
    text = body.decode(errors="ignore")
    if status == 422 and ("already" in text.lower() or "registered" in text.lower() or "exists" in text.lower()):
        existing = _auth_id_by_email(url, key, email)
        if not existing:
            raise StorageError("Já existe uma conta de login com este email, mas não foi possível encontrá-la.")
        set_auth_password(existing, password)
        return existing
    raise StorageError(_password_error(status, text))


def set_auth_password(supabase_user_id: str, password: str) -> None:
    url, key = _config("A gestão de contas de acesso")
    payload = json.dumps({"password": password, "email_confirm": True}).encode()
    status, body = _request("PUT", f"{url}/auth/v1/admin/users/{supabase_user_id}", key, payload)
    if status in (200, 201):
        return
    if status == 404:
        raise StorageError("A conta de login já não existe no Supabase. Cria um novo acesso.")
    raise StorageError(_password_error(status, body.decode(errors="ignore")))


def delete_auth_user(supabase_user_id: str) -> None:
    url, key = _config("A gestão de contas de acesso")
    status, body = _request("DELETE", f"{url}/auth/v1/admin/users/{supabase_user_id}", key)
    if status in (200, 204, 404):
        return
    raise StorageError(f"Não foi possível apagar a conta de login (erro {status}: {body.decode(errors='ignore')[:200]}).")


def get_auth_user(supabase_user_id: str):
    """Dados da conta de login (último acesso, etc.) ou None se não existir."""
    url, key = _config("A gestão de contas de acesso")
    status, body = _request("GET", f"{url}/auth/v1/admin/users/{supabase_user_id}", key)
    if status == 200:
        return json.loads(body or b"{}")
    return None


def invite_user(email: str, full_name: str = None, redirect_to: str = None) -> str:
    """Envia ao condómino o email de convite do Supabase (link para criar a palavra-passe).
    Se a pessoa já tiver conta de login, envia antes o email de 'definir nova palavra-passe'.
    Devolve 'invited' ou 'reset_sent'."""
    url, key = _config("O envio de convites por email")
    query = f"?redirect_to={urllib.parse.quote(redirect_to, safe='')}" if redirect_to else ""
    payload = json.dumps({"email": email, "data": {"full_name": full_name} if full_name else {}}).encode()
    status, body = _request("POST", f"{url}/auth/v1/invite{query}", key, payload)
    if status in (200, 201):
        return "invited"
    text = body.decode(errors="ignore")
    if status == 422 or "already" in text.lower() or "registered" in text.lower():
        status2, body2 = _request("POST", f"{url}/auth/v1/recover{query}", key, json.dumps({"email": email}).encode())
        if status2 in (200, 201, 204):
            return "reset_sent"
        text = body2.decode(errors="ignore")
        status = status2
    if status == 429 or "rate limit" in text.lower():
        raise StorageError("Foram enviados demasiados emails num curto espaço de tempo (limite do Supabase). Tenta daqui a uma hora ou configura um servidor de email (SMTP) no Supabase.")
    raise StorageError(f"Não foi possível enviar o convite (erro {status}: {text[:200]}).")


def download_file(ref_or_url: str):
    """Descarrega um ficheiro do Storage (para as cópias de segurança).
    Aceita uma referência privada sb://bucket/caminho ou o URL público de uma foto.
    Devolve (caminho_no_zip, bytes)."""
    url, key = _config("O acesso aos ficheiros")
    if is_private_ref(ref_or_url):
        bucket, path = _split_ref(ref_or_url)
    else:
        marker = "/storage/v1/object/public/"
        if marker not in ref_or_url:
            raise StorageError("Ficheiro externo (não está no Storage da aplicação).")
        bucket, _, path = ref_or_url.split(marker, 1)[1].partition("/")
    status, body = _request("GET", f"{url}/storage/v1/object/{bucket}/{_quote_path(path)}", key)
    if status != 200:
        raise StorageError(f"erro {status}")
    return f"{bucket}/{path}", body
