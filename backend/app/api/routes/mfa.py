"""Self-service MFA enrolment and management (TOTP + recovery codes)."""
from __future__ import annotations

import base64
import io

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.utils import bad_request
from app.core.deps import AuthContext, get_auth
from app.core.ratelimit import rate_limit
from app.core.security import (
    decrypt_secret,
    encrypt_secret,
    generate_recovery_codes,
    hash_token,
    new_totp_secret,
    normalize_recovery_code,
    totp_uri,
    verify_password,
    verify_totp,
)
from app.db.base import utcnow
from app.db.session import get_db
from app.models import MFAConfig, RecoveryCode, User
from app.schemas.auth import MfaCodeIn, MfaDisableIn, MfaSetupOut, MfaStatusOut, RecoveryCodesOut
from app.services import audit, risk
from app.services.org import get_org

router = APIRouter(prefix="/mfa", tags=["MFA"], dependencies=[Depends(rate_limit("mfa-mgmt", 20, 60))])


def _cfg(db: Session, user: User) -> MFAConfig | None:
    return db.execute(select(MFAConfig).where(MFAConfig.user_id == user.id)).scalar()


def _issue_codes(db: Session, user: User) -> list[str]:
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = generate_recovery_codes()
    for c in codes:
        db.add(RecoveryCode(user_id=user.id, code_hash=hash_token(c)))
    return codes


@router.get("/status", response_model=MfaStatusOut)
def mfa_status(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> MfaStatusOut:
    cfg = _cfg(db, auth.user)
    remaining = db.scalar(select(func.count()).select_from(RecoveryCode).where(
        RecoveryCode.user_id == auth.user.id, RecoveryCode.used_at.is_(None))) or 0
    org = get_org(db)
    return MfaStatusOut(
        enabled=auth.user.mfa_enabled, enabled_at=cfg.enabled_at if cfg else None,
        last_used_at=cfg.last_used_at if cfg else None, recovery_codes_remaining=remaining,
        pending_setup=bool(cfg and not cfg.is_enabled),
        required_by_policy=any(r in (org.mfa_required_roles or []) for r in auth.user.role_names),
        session_mfa_verified=auth.session.mfa_verified,
    )


@router.post("/setup", response_model=MfaSetupOut)
def mfa_setup(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> MfaSetupOut:
    if auth.user.mfa_enabled:
        raise bad_request("MFA is already enabled", "mfa_already_enabled")
    secret = new_totp_secret()
    cfg = _cfg(db, auth.user)
    if cfg is None:
        cfg = MFAConfig(user_id=auth.user.id, secret_encrypted=encrypt_secret(secret))
        db.add(cfg)
    else:
        cfg.secret_encrypted, cfg.is_enabled, cfg.last_used_step = encrypt_secret(secret), False, None
    uri = totp_uri(secret, auth.user.email)
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf)
    audit.record(db, "mfa.setup_started", "mfa", actor=auth.user, ip=auth.client.ip)
    db.commit()
    return MfaSetupOut(otpauth_uri=uri, secret=secret,
                       qr_svg_data_url="data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode())


@router.post("/enable", response_model=RecoveryCodesOut)
def mfa_enable(body: MfaCodeIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> RecoveryCodesOut:
    cfg = _cfg(db, auth.user)
    if not cfg or auth.user.mfa_enabled:
        raise bad_request("Start MFA setup first", "mfa_setup_required")
    step = verify_totp(decrypt_secret(cfg.secret_encrypted), body.code, None)
    if step is None:
        raise HTTPException(400, detail={"code": "invalid_mfa_code", "message": "Code did not match. Check your authenticator's clock."})
    cfg.is_enabled, cfg.enabled_at, cfg.last_used_step, cfg.last_used_at = True, utcnow(), step, utcnow()
    auth.user.mfa_enabled = True
    auth.session.mfa_verified = True
    codes = _issue_codes(db, auth.user)
    risk.recompute_user_risk(db, auth.user)
    audit.record(db, "mfa.enabled", "mfa", actor=auth.user, ip=auth.client.ip, severity="low")
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/disable")
def mfa_disable(body: MfaDisableIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    cfg = _cfg(db, auth.user)
    if not cfg or not auth.user.mfa_enabled:
        raise bad_request("MFA is not enabled", "mfa_not_enabled")
    if not verify_password(body.password, auth.user.password_hash):
        audit.record(db, "mfa.disable_failed", "mfa", actor=auth.user, ip=auth.client.ip, severity="medium", outcome="failure")
        db.commit()
        raise HTTPException(400, detail={"code": "invalid_password", "message": "Password is incorrect"})
    step = verify_totp(decrypt_secret(cfg.secret_encrypted), body.code, cfg.last_used_step)
    ok = step is not None
    if ok:
        cfg.last_used_step = step
    else:
        rc = db.execute(select(RecoveryCode).where(
            RecoveryCode.user_id == auth.user.id, RecoveryCode.used_at.is_(None),
            RecoveryCode.code_hash == hash_token(normalize_recovery_code(body.code)))).scalar()
        ok = rc is not None
    if not ok:
        audit.record(db, "mfa.disable_failed", "mfa", actor=auth.user, ip=auth.client.ip, severity="medium", outcome="failure")
        db.commit()
        raise HTTPException(400, detail={"code": "invalid_mfa_code", "message": "Verification code is invalid"})
    db.delete(cfg)
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == auth.user.id))
    auth.user.mfa_enabled = False
    risk.recompute_user_risk(db, auth.user)
    audit.record(db, "mfa.disabled", "mfa", actor=auth.user, ip=auth.client.ip, severity="medium")
    db.commit()
    return {"message": "MFA disabled"}


@router.post("/recovery-codes", response_model=RecoveryCodesOut)
def regenerate_codes(body: MfaCodeIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> RecoveryCodesOut:
    cfg = _cfg(db, auth.user)
    if not cfg or not auth.user.mfa_enabled:
        raise bad_request("MFA is not enabled", "mfa_not_enabled")
    step = verify_totp(decrypt_secret(cfg.secret_encrypted), body.code, cfg.last_used_step)
    if step is None:
        raise HTTPException(400, detail={"code": "invalid_mfa_code", "message": "Verification code is invalid"})
    cfg.last_used_step = step
    codes = _issue_codes(db, auth.user)
    audit.record(db, "mfa.recovery_codes_regenerated", "mfa", actor=auth.user, ip=auth.client.ip, severity="low")
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes)
