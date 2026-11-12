"""Authentication: registration, login, MFA challenge, token refresh/rotation, logout, password reset."""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.utils import bad_request, paginate
from app.core.config import settings
from app.core.deps import AuthContext, get_auth
from app.core.ratelimit import rate_limit
from app.core.request_ctx import ClientInfo, client_info
from app.core.security import (
    create_access_token,
    create_mfa_pending_token,
    decode_token,
    decrypt_secret,
    generate_token,
    hash_password,
    hash_token,
    normalize_recovery_code,
    password_needs_rehash,
    validate_password_strength,
    verify_password,
    verify_totp,
)
from app.db.base import utcnow
from app.db.session import get_db
from app.models import MFAConfig, PasswordResetToken, RecoveryCode, Role, SecurityEvent, User, UserSession
from app.schemas.auth import (
    ChangePasswordIn,
    ForgotIn,
    LoginIn,
    LoginOut,
    MeOut,
    MfaVerifyIn,
    ProfileUpdate,
    RegisterIn,
    ResetIn,
    StepUpIn,
    TokenOut,
)
from app.schemas.common import Message, PageParams
from app.services import audit, risk, threats
from app.services.devices import get_or_register_login_device
from app.services.org import get_org
from app.services.sessions import create_session, revoke_all_for_user, revoke_session

log = logging.getLogger("zerotrustx.auth")
router = APIRouter(prefix="/auth", tags=["Authentication"])

REFRESH_COOKIE = "ztx_refresh"
REFRESH_REUSE_GRACE_SECONDS = 30
AUTH_EVENT_TYPES = ("login_success", "login_failure", "mfa_challenge", "mfa_failure", "logout")
GENERIC_LOGIN_ERROR = {"code": "invalid_credentials", "message": "Invalid email or password"}


# ------------------------------------------------------------------ helpers
def _set_refresh_cookie(resp: Response, token: str, max_age: int) -> None:
    resp.set_cookie(
        REFRESH_COOKIE, token, max_age=max_age, httponly=True, secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE, path=f"{settings.API_PREFIX}/auth",
    )


def _clear_refresh_cookie(resp: Response) -> None:
    resp.delete_cookie(REFRESH_COOKIE, path=f"{settings.API_PREFIX}/auth", httponly=True,
                       secure=settings.COOKIE_SECURE, samesite=settings.COOKIE_SAMESITE)


def _event(db: Session, etype: str, ci: ClientInfo, *, user: User | None = None, email: str | None = None,
           severity: str = "informational", session_id=None, device_id=None, details: dict | None = None) -> None:
    from app.services.sessions import guess_location

    db.add(SecurityEvent(
        event_type=etype, user_id=user.id if user else None, email_attempted=email or (user.email if user else None),
        ip_address=ci.ip, user_agent=ci.user_agent, severity=severity, session_id=session_id, device_id=device_id,
        location=guess_location(ci.ip), details=details or {},
    ))
    db.flush()


def me_payload(db: Session, user: User, s: UserSession | None) -> MeOut:
    org = get_org(db)
    required = any(r in (org.mfa_required_roles or []) for r in user.role_names)
    return MeOut(
        id=user.id, email=user.email, full_name=user.full_name, department=user.department, job_title=user.job_title,
        phone=user.phone, status=user.status, risk_score=user.risk_score, mfa_enabled=user.mfa_enabled,
        roles=user.roles, permissions=sorted(user.permission_codes), preferences=user.preferences or {},
        last_login_at=user.last_login_at, created_at=user.created_at, mfa_required_by_policy=required and not user.mfa_enabled,
        session={
            "id": str(s.id) if s else None,
            "mfa_verified": bool(s and s.mfa_verified),
            "expires_at": s.expires_at.isoformat() if s else None,
            "device": (
                {"id": str(s.device.id), "name": s.device.name, "trust_status": s.device.trust_status}
                if s and s.device else None
            ),
        },
    )


def _complete_login(db: Session, user: User, ci: ClientInfo, resp: Response, mfa_verified: bool, method: str) -> TokenOut:
    previous_ip = user.last_login_ip
    device, is_new = get_or_register_login_device(db, user, ci.device_identifier, ci.user_agent, ci.ip, ci.device_name)
    s, refresh = create_session(db, user, device, ci.ip, ci.user_agent, mfa_verified)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = utcnow()
    user.last_login_ip = ci.ip
    _event(db, "login_success", ci, user=user, session_id=s.id, device_id=device.id if device else None,
           details={"method": method, "mfa": mfa_verified})
    audit.record(db, "auth.login", "authentication", actor=user, ip=ci.ip, user_agent=ci.user_agent,
                 target_type="session", target_id=s.id, details={"method": method, "mfa_verified": mfa_verified,
                                                               "device": device.name if device else None})
    threats.on_login_success(db, user, ci.ip, device, previous_ip, is_new, s.id)
    s.risk_score = risk.recompute_user_risk(db, user)
    db.commit()
    token, exp = create_access_token(user.id, s.id, user.role_names, mfa_verified)
    _set_refresh_cookie(resp, refresh, int((s.expires_at - utcnow()).total_seconds()))
    return TokenOut(access_token=token, expires_in=exp, user=me_payload(db, user, s))


# ------------------------------------------------------------------ public endpoints
@router.get("/password-policy")
def password_policy(db: Session = Depends(get_db)) -> dict:
    org = get_org(db)
    db.commit()
    return {
        "min_length": org.password_min_length, "require_upper": org.password_require_upper,
        "require_lower": org.password_require_lower, "require_digit": org.password_require_digit,
        "require_symbol": org.password_require_symbol, "allow_self_registration": org.allow_self_registration,
    }


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=Message,
             dependencies=[Depends(rate_limit("register", 5, 60))])
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)) -> Message:
    ci = client_info(request)
    org = get_org(db)
    if not org.allow_self_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "registration_disabled",
                                                                "message": "Self-registration is disabled"})
    email = body.email.lower()
    errors = validate_password_strength(body.password, org, email)
    if errors:
        raise HTTPException(422, detail={"code": "weak_password", "message": errors[0], "errors": errors})
    if db.execute(select(User.id).where(func.lower(User.email) == email)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "email_taken", "message": "An account with this email already exists"})
    guest = db.execute(select(Role).where(Role.name == "guest")).scalar_one()
    user = User(email=email, full_name=body.full_name, password_hash=hash_password(body.password),
                password_changed_at=utcnow(), roles=[guest])
    db.add(user)
    db.flush()
    audit.record(db, "user.registered", "user_management", actor=user, ip=ci.ip, user_agent=ci.user_agent,
                 target_type="user", target_id=user.id, target_label=email, details={"role": "guest"})
    db.commit()
    return Message(message="Account created. You can now sign in. An administrator may grant additional roles.")


@router.post("/login", response_model=LoginOut, dependencies=[Depends(rate_limit("login"))])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> LoginOut:
    ci = client_info(request)
    email = body.email.lower()
    org = get_org(db)
    user = db.execute(select(User).where(func.lower(User.email) == email)).scalar()

    if user and user.locked_until and user.locked_until > utcnow():
        verify_password(body.password, None)  # timing equalisation
        _event(db, "login_failure", ci, user=user, severity="medium", details={"reason": "locked"})
        audit.record(db, "auth.login_failed", "authentication", actor=user, ip=ci.ip, severity="medium",
                     outcome="failure", details={"reason": "account_locked"})
        db.commit()
        raise HTTPException(status.HTTP_423_LOCKED, detail={"code": "account_locked",
                            "message": "Account temporarily locked due to repeated failed sign-ins. Try again later."})

    if user is None or not verify_password(body.password, user.password_hash):
        sev = "low"
        if user:
            user.failed_login_count += 1
            if user.failed_login_count >= org.max_failed_logins:
                user.locked_until = utcnow() + timedelta(minutes=org.lockout_minutes)
                sev = "high"
                audit.record(db, "auth.account_locked", "authentication", actor=user, ip=ci.ip, severity="high",
                             outcome="failure", details={"failed_attempts": user.failed_login_count,
                                                         "lockout_minutes": org.lockout_minutes})
        _event(db, "login_failure", ci, user=user, email=email, severity=sev,
               details={"reason": "bad_password" if user else "unknown_user"})
        audit.record(db, "auth.login_failed", "authentication", actor=user, actor_email=email, ip=ci.ip,
                     user_agent=ci.user_agent, severity=sev, outcome="failure",
                     details={"reason": "invalid_credentials"})
        threats.on_login_failure(db, user, email, ci.ip)
        if user:
            risk.recompute_user_risk(db, user)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=GENERIC_LOGIN_ERROR)

    if user.status != "active":
        _event(db, "login_failure", ci, user=user, severity="medium", details={"reason": f"account_{user.status}"})
        audit.record(db, "auth.login_failed", "authentication", actor=user, ip=ci.ip, severity="medium",
                     outcome="failure", details={"reason": f"account_{user.status}"})
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "account_inactive",
                            "message": f"This account is {user.status}. Contact your security administrator."})

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)

    if user.mfa_enabled:
        user.failed_login_count = 0
        _event(db, "mfa_challenge", ci, user=user)
        db.commit()
        return LoginOut(mfa_required=True, mfa_token=create_mfa_pending_token(user.id, ci.device_identifier))

    return LoginOut(mfa_required=False, auth=_complete_login(db, user, ci, response, False, "password"))


@router.post("/mfa/verify", response_model=TokenOut, dependencies=[Depends(rate_limit("mfa", 10, 60))])
def verify_mfa(body: MfaVerifyIn, request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    ci = client_info(request)
    try:
        payload = decode_token(body.mfa_token, "mfa_pending")
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(401, detail={"code": "mfa_token_expired", "message": "MFA challenge expired; sign in again"}) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(401, detail={"code": "invalid_token", "message": "Invalid MFA challenge"}) from exc
    user = db.get(User, uuid.UUID(payload["sub"]))
    if not user or user.status != "active" or not user.mfa_enabled:
        raise HTTPException(401, detail={"code": "invalid_token", "message": "Invalid MFA challenge"})
    cfg = db.execute(select(MFAConfig).where(MFAConfig.user_id == user.id)).scalar()
    ok, method = False, "totp"
    if body.code and cfg:
        step = verify_totp(decrypt_secret(cfg.secret_encrypted), body.code, cfg.last_used_step)
        if step is not None:
            cfg.last_used_step, cfg.last_used_at, ok = step, utcnow(), True
    elif body.recovery_code:
        method = "recovery_code"
        h = hash_token(normalize_recovery_code(body.recovery_code))
        rc = db.execute(select(RecoveryCode).where(RecoveryCode.user_id == user.id, RecoveryCode.code_hash == h,
                                                   RecoveryCode.used_at.is_(None))).scalar()
        if rc:
            rc.used_at, ok = utcnow(), True
            audit.record(db, "mfa.recovery_code_used", "mfa", actor=user, ip=ci.ip, severity="medium")
    if not ok:
        _event(db, "mfa_failure", ci, user=user, severity="medium", details={"method": method})
        audit.record(db, "auth.mfa_failed", "mfa", actor=user, ip=ci.ip, severity="medium", outcome="failure",
                     details={"method": method})
        threats.on_mfa_failure(db, user, ci.ip)
        db.commit()
        raise HTTPException(401, detail={"code": "invalid_mfa_code", "message": "Invalid verification code"})
    if payload.get("dev") and not ci.device_identifier:
        ci.device_identifier = payload["dev"]
    return _complete_login(db, user, ci, response, True, f"password+{method}")


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(rate_limit("refresh", 30, 60))])
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    ci = client_info(request)
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(401, detail={"code": "no_refresh_token", "message": "Not signed in"})
    h = hash_token(token)
    s = db.execute(select(UserSession).where(UserSession.refresh_token_hash == h)).scalar()
    now = utcnow()
    if s is None:
        old = db.execute(select(UserSession).where(UserSession.previous_refresh_hash == h)).scalar()
        if (old and old.revoked_at is None and old.refresh_rotated_at
                and (now - old.refresh_rotated_at).total_seconds() < REFRESH_REUSE_GRACE_SECONDS):
            # Benign race (page reload / parallel tabs aborted the previous rotation before the browser stored
            # the new cookie). Within the short grace window the previous token may rotate once more; this
            # invalidates the token issued by the interrupted request.
            s = old
        else:
            if old and old.revoked_at is None:
                revoke_session(db, old, "refresh_token_reuse")
                audit.record(db, "auth.refresh_reuse", "session", actor=old.user, ip=ci.ip, severity="high",
                             outcome="failure", target_type="session", target_id=old.id)
                threats.create_alert(db, "refresh_token_reuse", user=old.user, ip=ci.ip, session_id=old.id)
                db.commit()
            _clear_refresh_cookie(response)
            raise HTTPException(401, detail={"code": "invalid_refresh_token", "message": "Session is no longer valid"},
                                headers={"set-cookie": response.headers.get("set-cookie", "")})
    if s.revoked_at is not None or s.expires_at <= now:
        raise HTTPException(401, detail={"code": "session_expired", "message": "Session expired"})
    org = get_org(db)
    if s.last_activity_at <= now - timedelta(minutes=org.idle_timeout_minutes):
        revoke_session(db, s, "idle_timeout")
        db.commit()
        raise HTTPException(401, detail={"code": "session_expired", "message": "Session expired due to inactivity"})
    user = s.user
    if user.status != "active":
        revoke_session(db, s, f"account_{user.status}")
        db.commit()
        raise HTTPException(403, detail={"code": "account_inactive", "message": "Account is not active"})
    if ci.ip and s.ip_address and ci.ip != s.ip_address:
        threats.create_alert(db, "session_ip_change", user=user, ip=ci.ip, session_id=s.id,
                             fmt={"previous_ip": s.ip_address}, evidence={"previous_ip": s.ip_address, "new_ip": ci.ip})
    new_refresh = generate_token()
    if s.refresh_token_hash == h:
        s.previous_refresh_hash = h
    s.refresh_token_hash = hash_token(new_refresh)
    s.refresh_rotated_at = now
    s.refresh_count += 1
    s.last_activity_at = now
    db.commit()
    access, exp = create_access_token(user.id, s.id, user.role_names, s.mfa_verified)
    _set_refresh_cookie(response, new_refresh, int((s.expires_at - now).total_seconds()))
    return TokenOut(access_token=access, expires_in=exp, user=me_payload(db, user, s))


@router.post("/logout", response_model=Message)
def logout(response: Response, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> Message:
    revoke_session(db, auth.session, "logout", auth.user)
    _event(db, "logout", auth.client, user=auth.user, session_id=auth.session.id)
    audit.record(db, "auth.logout", "authentication", actor=auth.user, ip=auth.client.ip, target_type="session",
                 target_id=auth.session.id)
    db.commit()
    _clear_refresh_cookie(response)
    return Message(message="Signed out")


@router.post("/logout-all", response_model=Message)
def logout_all(response: Response, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> Message:
    n = revoke_all_for_user(db, auth.user.id, "logout_all", auth.user)
    audit.record(db, "auth.logout_all", "session", actor=auth.user, ip=auth.client.ip, severity="low",
                 details={"sessions_revoked": n})
    db.commit()
    _clear_refresh_cookie(response)
    return Message(message=f"Signed out of {n} session(s)")


@router.post("/step-up", response_model=TokenOut, dependencies=[Depends(rate_limit("mfa", 10, 60))])
def step_up(body: StepUpIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> TokenOut:
    """Upgrade the current session to MFA-verified (used when a policy returns REQUIRE_MFA)."""
    cfg = db.execute(select(MFAConfig).where(MFAConfig.user_id == auth.user.id, MFAConfig.is_enabled.is_(True))).scalar()
    if not cfg:
        raise bad_request("Enrol in MFA before performing step-up verification", "mfa_not_enabled")
    step = verify_totp(decrypt_secret(cfg.secret_encrypted), body.code, cfg.last_used_step)
    if step is None:
        _event(db, "mfa_failure", auth.client, user=auth.user, severity="medium", details={"method": "step_up"})
        threats.on_mfa_failure(db, auth.user, auth.client.ip)
        db.commit()
        raise HTTPException(401, detail={"code": "invalid_mfa_code", "message": "Invalid verification code"})
    cfg.last_used_step, cfg.last_used_at = step, utcnow()
    auth.session.mfa_verified = True
    audit.record(db, "auth.step_up", "mfa", actor=auth.user, ip=auth.client.ip, target_type="session",
                 target_id=auth.session.id)
    db.commit()
    access, exp = create_access_token(auth.user.id, auth.session.id, auth.user.role_names, True)
    return TokenOut(access_token=access, expires_in=exp, user=me_payload(db, auth.user, auth.session))


@router.get("/me", response_model=MeOut)
def me(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> MeOut:
    return me_payload(db, auth.user, auth.session)


@router.patch("/me", response_model=MeOut)
def update_me(body: ProfileUpdate, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> MeOut:
    changes = body.model_dump(exclude_unset=True)
    for k in ("full_name", "phone", "job_title"):
        if k in changes:
            setattr(auth.user, k, changes[k])
    if "preferences" in changes and changes["preferences"] is not None:
        auth.user.preferences = {**(auth.user.preferences or {}), **changes["preferences"]}
    audit.record(db, "user.profile_updated", "user_management", actor=auth.user, ip=auth.client.ip,
                 target_type="user", target_id=auth.user.id, details={"fields": sorted(changes)})
    db.commit()
    return me_payload(db, auth.user, auth.session)


@router.post("/change-password", response_model=Message)
def change_password(body: ChangePasswordIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> Message:
    if not verify_password(body.current_password, auth.user.password_hash):
        audit.record(db, "auth.password_change_failed", "authentication", actor=auth.user, ip=auth.client.ip,
                     severity="low", outcome="failure")
        db.commit()
        raise HTTPException(400, detail={"code": "invalid_password", "message": "Current password is incorrect"})
    errors = validate_password_strength(body.new_password, get_org(db), auth.user.email)
    if verify_password(body.new_password, auth.user.password_hash):
        errors.append("New password must differ from the current password")
    if errors:
        raise HTTPException(422, detail={"code": "weak_password", "message": errors[0], "errors": errors})
    auth.user.password_hash = hash_password(body.new_password)
    auth.user.password_changed_at = utcnow()
    n = revoke_all_for_user(db, auth.user.id, "password_changed", auth.user, except_session=auth.session.id)
    audit.record(db, "auth.password_changed", "authentication", actor=auth.user, ip=auth.client.ip, severity="low",
                 details={"other_sessions_revoked": n})
    db.commit()
    return Message(message=f"Password updated. {n} other session(s) were signed out.")


@router.post("/forgot-password", status_code=202, dependencies=[Depends(rate_limit("forgot", 5, 60))])
def forgot_password(body: ForgotIn, request: Request, db: Session = Depends(get_db)) -> dict:
    ci = client_info(request)
    email = body.email.lower()
    user = db.execute(select(User).where(func.lower(User.email) == email)).scalar()
    out: dict = {"message": "If an account exists for that email, a reset link has been sent."}
    if user and user.status == "active":
        token = generate_token(32)
        db.add(PasswordResetToken(user_id=user.id, token_hash=hash_token(token), expires_at=utcnow() + timedelta(minutes=30)))
        audit.record(db, "auth.password_reset_requested", "authentication", actor=user, ip=ci.ip)
        url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        # No email provider is configured: the link is written to the server log (development delivery).
        log.warning("Password reset link for %s: %s", email, url)
        if settings.EXPOSE_DEV_RESET_TOKENS and settings.APP_ENV != "production":
            out["dev_reset_url"] = url
    db.commit()
    return out


@router.post("/reset-password", response_model=Message, dependencies=[Depends(rate_limit("reset", 10, 60))])
def reset_password(body: ResetIn, request: Request, db: Session = Depends(get_db)) -> Message:
    ci = client_info(request)
    rt = db.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(body.token))).scalar()
    if not rt or rt.used_at or rt.expires_at <= utcnow():
        raise bad_request("This reset link is invalid or has expired", "invalid_reset_token")
    user = db.get(User, rt.user_id)
    errors = validate_password_strength(body.new_password, get_org(db), user.email)
    if errors:
        raise HTTPException(422, detail={"code": "weak_password", "message": errors[0], "errors": errors})
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = utcnow()
    user.failed_login_count = 0
    user.locked_until = None
    rt.used_at = utcnow()
    n = revoke_all_for_user(db, user.id, "password_reset")
    audit.record(db, "auth.password_reset", "authentication", actor=user, ip=ci.ip, severity="low",
                 details={"sessions_revoked": n})
    db.commit()
    return Message(message="Password has been reset. Please sign in.")


@router.get("/me/login-history")
def login_history(params: PageParams = Depends(), auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    q = select(SecurityEvent).where(SecurityEvent.user_id == auth.user.id, SecurityEvent.event_type.in_(AUTH_EVENT_TYPES))
    return paginate(db, q, params, {"created_at": SecurityEvent.created_at}, "created_at", mapper=event_out)


def event_out(e: SecurityEvent) -> dict:
    return {
        "id": str(e.id), "event_type": e.event_type, "ip_address": e.ip_address, "user_agent": e.user_agent,
        "location": e.location, "severity": e.severity, "details": e.details, "created_at": e.created_at,
        "is_demo": e.is_demo, "email": e.email_attempted,
    }
