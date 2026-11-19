from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import sys
from pathlib import Path

from app.config import DATA_DIR

_VAULT_PATH = DATA_DIR / ".api_vault.dat"


def _dpapi_protect(raw: bytes) -> bytes:
    """Protect bytes using Windows DPAPI (CryptProtectData) when running on Windows."""
    if sys.platform != "win32":
        key = hashlib.sha256(f"{os.getlogin() if hasattr(os, 'getlogin') else 'user'}:bst_ai".encode()).digest()
        return base64.b64encode(bytes(b ^ key[i % len(key)] for i, b in enumerate(raw)))

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    in_buf = ctypes.create_string_buffer(raw, len(raw))
    in_blob = DATA_BLOB(len(raw), ctypes.cast(in_buf, ctypes.POINTER(ctypes.c_ubyte)))
    out_blob = DATA_BLOB()
    if not crypt32.CryptProtectData(ctypes.byref(in_blob), "BinanceSmartTraderAI", None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError("Windows DPAPI CryptProtectData failed")
    try:
        protected = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        return base64.b64encode(protected)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def _dpapi_unprotect(encoded: bytes) -> bytes:
    raw = base64.b64decode(encoded)
    if sys.platform != "win32":
        key = hashlib.sha256(f"{os.getlogin() if hasattr(os, 'getlogin') else 'user'}:bst_ai".encode()).digest()
        return bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    in_buf = ctypes.create_string_buffer(raw, len(raw))
    in_blob = DATA_BLOB(len(raw), ctypes.cast(in_buf, ctypes.POINTER(ctypes.c_ubyte)))
    out_blob = DATA_BLOB()
    if not crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise OSError("Windows DPAPI CryptUnprotectData failed")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def save_api_key(api_key: str) -> None:
    cleaned = api_key.strip()
    if not cleaned:
        clear_api_key()
        return
    payload = json.dumps({"api_key": cleaned}).encode("utf-8")
    encrypted = _dpapi_protect(payload)
    _VAULT_PATH.write_bytes(encrypted)


def load_api_key() -> str:
    if not _VAULT_PATH.exists():
        return ""
    try:
        decrypted = _dpapi_unprotect(_VAULT_PATH.read_bytes())
        data = json.loads(decrypted.decode("utf-8"))
        return str(data.get("api_key", ""))
    except Exception:
        return ""


def mask_api_key(api_key: str) -> str:
    if not api_key:
        return "Not configured (Public Streams)"
    if len(api_key) <= 8:
        return "****"
    return f"{api_key[:4]}...{api_key[-4:]}"


def clear_api_key() -> None:
    if _VAULT_PATH.exists():
        _VAULT_PATH.unlink()
