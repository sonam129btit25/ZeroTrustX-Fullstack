"""Cryptographic primitives: password hashing, JWT, token hashing, MFA secret encryption, TOTP."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
# Hash used to equalize timing for unknown accounts.
_DUMMY_HASH = _ph.hash("timing-equalizer-not-a-real-password")


# ------------------------------------------------------------------ passwords
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _ph.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


COMMON_PASSWORDS = {"password", "password1", "123456", "12345678", "qwerty", "letmein", "welcome", "admin"}


def validate_password_strength(password: str, policy: Any | None = None, email: str | None = None) -> list[str]:
    """Return a list of human readable policy violations (empty == acceptable)."""
    min_len = getattr(policy, "password_min_length", 12) if policy else 12
    errors: list[str] = []
    if len(password) < min_len:
        errors.append(f"Password must be at least {min_len} characters long")
    if len(password) > 128:
        errors.append("Password must be at most 128 characters long")
    if (not policy or policy.password_require_upper) and not re.search(r"[A-Z]", password):
        errors.append("Password must contain an uppercase letter")
    if (not policy or policy.password_require_lower) and not re.search(r"[a-z]", password):
        errors.append("Password must contain a lowercase letter")
    if (not policy or policy.password_require_digit) and not re.search(r"\d", password):
        errors.append("Password must contain a digit")
    if (not policy or policy.password_require_symbol) and not re.search(r"[^A-Za-z0-9]", password):
        errors.append("Password must contain a symbol")
    if password.lower() in COMMON_PASSWORDS:
        errors.append("Password is too common")
    if email and email.split("@")[0].lower() in password.lower() and len(email.split("@")[0]) >= 4:
        errors.append("Password must not contain your email name")
    return errors


# ------------------------------------------------------------------ opaque tokens
def generate_token(nbytes: int = 48) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Keyed hash for storing opaque tokens (refresh, reset, recovery) at rest."""
    return hmac.new(settings.JWT_SECRET_KEY.encode(), token.encode(), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# ------------------------------------------------------------------ JWT
def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID, roles: list[str], mfa: bool) -> tuple[str, int]:
    expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "roles": roles,
        "mfa": mfa,
        "type": "access",
        "iat": _now(),
        "exp": _now() + expires,
        "jti": uuid.uuid4().hex,
        "iss": "zerotrustx",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM), int(expires.total_seconds())


def create_mfa_pending_token(user_id: uuid.UUID, device_identifier: str | None) -> str:
    payload = {
        "sub": str(user_id),
        "type": "mfa_pending",
        "dev": device_identifier,
        "iat": _now(),
        "exp": _now() + timedelta(minutes=settings.MFA_PENDING_TOKEN_EXPIRE_MINUTES),
        "jti": uuid.uuid4().hex,
        "iss": "zerotrustx",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    payload = jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        issuer="zerotrustx",
        options={"require": ["exp", "sub", "type", "iss"]},
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload


# ------------------------------------------------------------------ MFA
_fernet = Fernet(settings.MFA_ENCRYPTION_KEY.encode())


def encrypt_secret(secret: str) -> str:
    return _fernet.encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken as exc:  # pragma: no cover - key misconfiguration
        raise RuntimeError("Unable to decrypt MFA secret; check MFA_ENCRYPTION_KEY") from exc


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=settings.APP_NAME)


def verify_totp(secret: str, code: str, last_used_step: int | None) -> int | None:
    """Verify a TOTP code allowing +-1 step drift. Returns the matched time-step or None.

    Codes whose step is <= last_used_step are rejected to prevent replay.
    """
    code = (code or "").strip().replace(" ", "")
    if not re.fullmatch(r"\d{6}", code):
        return None
    totp = pyotp.TOTP(secret)
    now_step = int(time.time()) // totp.interval
    for offset in (-1, 0, 1):
        step = now_step + offset
        if hmac.compare_digest(totp.generate_otp(step), code):
            if last_used_step is not None and step <= last_used_step:
                return None
            return step
    return None


def generate_recovery_codes(n: int = 10) -> list[str]:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    codes = []
    for _ in range(n):
        raw = "".join(secrets.choice(alphabet) for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def normalize_recovery_code(code: str) -> str:
    c = re.sub(r"[^A-Za-z0-9]", "", code or "").upper()
    return f"{c[:5]}-{c[5:]}" if len(c) == 10 else c
