"""Comparação de identificadores de frações: "1º Dto", "1ºdto", "1.º Direito" e "1 dto"
são a mesma fração. Usado para impedir frações repetidas no mesmo condomínio."""
import re
import unicodedata

_SYNONYMS = {
    "direito": "dto", "direita": "dto", "dir": "dto", "dto": "dto", "dt": "dto", "drt": "dto",
    "esquerdo": "esq", "esquerda": "esq", "esq": "esq", "esqdo": "esq",
    "frente": "fte", "fte": "fte", "frt": "fte",
    "centro": "ctr", "ctr": "ctr", "cto": "ctr",
    "rc": "rc", "rch": "rc",
    "cave": "cv", "cv": "cv",
    "sobreloja": "slj", "sl": "slj",
}
_DROP = {"andar", "piso", "fracao", "fr", "no"}


def normalize_identifier(value: str) -> str:
    s = (value or "").strip().lower()
    s = s.replace("º", " ").replace("ª", " ").replace("°", " ")
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))
    s = re.sub(r"r\s*/\s*c(?![a-z])", " rc ", s)
    s = re.sub(r"res\W*do\W*chao", " rc ", s)
    tokens = re.findall(r"[a-z]+|\d+", s)
    out = []
    for i, t in enumerate(tokens):
        if t.isdigit():
            out.append(str(int(t)))
            continue
        if t in _DROP:
            continue
        # "1o Dto" (o em vez de º) — só quando o "o" vem logo a seguir a um número e há mais texto
        if t == "o" and i > 0 and tokens[i - 1].isdigit() and i < len(tokens) - 1:
            continue
        out.append(_SYNONYMS.get(t, t))
    return "".join(out)


def find_equivalent(existing, identifier: str, exclude_id=None):
    """Devolve a fração (de `existing`) equivalente a `identifier`, ou None."""
    key = normalize_identifier(identifier)
    if not key:
        return None
    for f in existing:
        if f.id != exclude_id and normalize_identifier(f.identifier) == key:
            return f
    return None
