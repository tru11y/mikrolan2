"""
Fernet secret encryption for router credentials.

Key derivation: SHA-256(ENCRYPTION_KEY env var) → base64url → Fernet key.
This supports any-length string key. For maximum security, set ENCRYPTION_KEY
to a 32-byte random hex string:
  python -c "import secrets; print(secrets.token_hex(32))"
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

_INSECURE_DEFAULTS = {"", "test-key-32-bytes-long-xxxxxxx"}


def _derive_key() -> bytes:
    raw = os.getenv("ENCRYPTION_KEY", "")
    if raw in _INSECURE_DEFAULTS:
        raise RuntimeError(
            "ENCRYPTION_KEY is not set or is the insecure default. "
            "Generate one: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt plaintext → opaque Fernet token. Input is never logged."""
    return Fernet(_derive_key()).encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt Fernet token → plaintext. Raises RuntimeError on wrong key or corruption."""
    try:
        return Fernet(_derive_key()).decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        raise RuntimeError("Decryption failed — wrong ENCRYPTION_KEY or corrupted ciphertext")
    except Exception as e:
        raise RuntimeError(f"Decryption error: {type(e).__name__}") from None
