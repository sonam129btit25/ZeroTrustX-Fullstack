"""Identity & Access Management: users, roles, permissions."""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.api.routes.auth import AUTH_EVENT_TYPES, event_out
from app.api.utils import bad_request, conflict, forbidden, not_found, paginate
from app.core.config import settings
from app.core.deps import AuthContext, require
from app.core.security import generate_token, hash_password, hash_token, validate_password_strength
from app.db.base import utcnow
from app.db.session import get_db
from app.models import (
    AccessRequest,
    Device,
    MFAConfig,
    PasswordResetToken,
    Permission,
    RecoveryCode,
    Role,
    RolePermission,
    SecurityEvent,
    User,
    UserRole,
    UserSession,
)
from app.schemas.common import PageParams
from app.schemas.users import (
    ResetAccessIn,
    RolePermissionsUpdate,
    RolesUpdate,
    StatusChange,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.services import audit, risk
from app.services.notify import notify_user
from app.services.org import get_org
from app.services.sessions import revoke_all_for_user

log = logging.getLogger("zerotrustx.users")
router = APIRouter(tags=["Identity & Access"])


def is_super(u: User) -> bool:
    return "super_admin" in u.role_names


def ensure_can_manage(actor: User, target: User) -> None:
    if actor.id == target.id:
        raise forbidden("You cannot perform this action on your own account")
    if not is_super(actor) and target.max_role_level >= actor.max_role_level:
        raise forbidden("You cannot manage a user with equal or higher privileges")


def ensure_can_assign(actor: User, roles: list[Role]) -> None:
    if is_super(actor):
        return
    for r in roles:
        if r.level >= actor.max_role_level:
            raise forbidden(f"You cannot assign the '{r.display_name}' role (privilege escalation prevented)")


def user_out(db: Session, u: User) -> UserOut:
    active = db.scalar(select(func.count()).select_from(UserSession).where(
        UserSession.user_id == u.id, UserSession.revoked_at.is_(None), UserSession.expires_at > utcnow())) or 0
    return UserOut(
        id=u.id, email=u.email, full_name=u.full_name, status=u.status, department=u.department, job_title=u.job_title,
        phone=u.phone, risk_score=u.risk_score, risk_level=risk.level(u.risk_score), mfa_enabled=u.mfa_enabled,
        roles=u.roles, last_login_at=u.last_login_at, last_login_ip=u.last_login_ip,
        failed_login_count=u.failed_login_count, locked_until=u.locked_until, created_at=u.created_at,
        is_demo=u.is_demo, active_sessions=active,
    )


def _get_user(db: Session, user_id: uuid.UUID) -> User:
    u = db.get(User, user_id)
    if not u:
        raise not_found("User")
    return u


# ------------------------------------------------------------------ users
@router.get("/users")
def list_users(
    params: PageParams = Depends(),
    status: str | None = Query(None, pattern="^(active|suspended|deactivated|locked)$"),
    role: str | None = Query(None, max_length=50),
    risk_min: int | None = Query(None, ge=0, le=100),
    mfa: bool | None = None,
    auth: AuthContext = Depends(require("users:read")),
    db: Session = Depends(get_db),
) -> dict:
    q = select(User)
    if params.q:
        like = f"%{params.q.lower()}%"
        q = q.where(or_(func.lower(User.email).like(like), func.lower(User.full_name).like(like),
                        func.lower(User.department).like(like)))
    if status:
        q = q.where(User.status == status)
    if role:
        q = q.where(User.id.in_(select(UserRole.user_id).join(Role, Role.id == UserRole.role_id).where(Role.name == role)))
    if risk_min is not None:
        q = q.where(User.risk_score >= risk_min)
    if mfa is not None:
        q = q.where(User.mfa_enabled.is_(mfa))
    sortable = {"created_at": User.created_at, "email": User.email, "full_name": User.full_name,
                "risk_score": User.risk_score, "last_login_at": User.last_login_at, "status": User.status}
    return paginate(db, q, params, sortable, "created_at", mapper=lambda u: user_out(db, u))


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, auth: AuthContext = Depends(require("users:write")), db: Session = Depends(get_db)) -> UserOut:
    email = body.email.lower()
    if db.execute(select(User.id).where(func.lower(User.email) == email)).first():
        raise conflict("A user with this email already exists")
    errors = validate_password_strength(body.password, get_org(db), email)
    if errors:
        raise HTTPException(422, detail={"code": "weak_password", "message": errors[0], "errors": errors})
    roles = list(db.execute(select(Role).where(Role.id.in_(body.role_ids))).scalars()) if body.role_ids else []
    if body.role_ids and len(roles) != len(set(body.role_ids)):
        raise bad_request("One or more roles do not exist")
    if not roles:
        roles = [db.execute(select(Role).where(Role.name == "employee")).scalar_one()]
    ensure_can_assign(auth.user, roles)
    u = User(email=email, full_name=body.full_name, password_hash=hash_password(body.password),
             department=body.department, job_title=body.job_title, phone=body.phone, password_changed_at=utcnow())
    db.add(u)
    db.flush()
    for r in roles:
        db.add(UserRole(user_id=u.id, role_id=r.id, assigned_by_id=auth.user.id))
    db.flush()
    db.refresh(u)
    audit.record(db, "user.created", "user_management", actor=auth.user, ip=auth.client.ip, target_type="user",
                 target_id=u.id, target_label=email, details={"roles": [r.name for r in roles]})
    db.commit()
    return user_out(db, u)


@router.get("/users/{user_id}")
def get_user(user_id: uuid.UUID, auth: AuthContext = Depends(require("users:read")), db: Session = Depends(get_db)) -> dict:
    u = _get_user(db, user_id)
    score, factors = risk.compute_user_risk(db, u)
    devices = db.execute(select(Device).where(Device.user_id == u.id).order_by(Device.last_seen_at.desc())).scalars().all()
    grants = db.execute(select(AccessRequest).where(
        AccessRequest.requester_id == u.id, AccessRequest.status == "approved", AccessRequest.expires_at > utcnow())).scalars().all()
    return {
        "user": user_out(db, u),
        "permissions": sorted(u.permission_codes),
        "risk": {"score": u.risk_score, "computed_score": score, "level": risk.level(u.risk_score), "factors": factors},
        "devices": [{"id": str(d.id), "name": d.name, "trust_status": d.trust_status, "os": d.os,
                     "last_seen_at": d.last_seen_at, "ip_address": d.ip_address} for d in devices],
        "active_grants": [{"id": str(g.id), "resource": g.resource.name, "expires_at": g.expires_at} for g in grants],
    }


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, body: UserUpdate, auth: AuthContext = Depends(require("users:write")),
                db: Session = Depends(get_db)) -> UserOut:
    u = _get_user(db, user_id)
    if u.id != auth.user.id:
        ensure_can_manage(auth.user, u)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(u, k, v)
    audit.record(db, "user.updated", "user_management", actor=auth.user, ip=auth.client.ip, target_type="user",
                 target_id=u.id, target_label=u.email, details={"fields": sorted(changes)})
    db.commit()
    return user_out(db, u)


@router.put("/users/{user_id}/roles", response_model=UserOut)
def set_roles(user_id: uuid.UUID, body: RolesUpdate, auth: AuthContext = Depends(require("users:manage_roles")),
              db: Session = Depends(get_db)) -> UserOut:
    u = _get_user(db, user_id)
    ensure_can_manage(auth.user, u)
    roles = list(db.execute(select(Role).where(Role.id.in_(body.role_ids))).scalars())
    if len(roles) != len(set(body.role_ids)):
        raise bad_request("One or more roles do not exist")
    ensure_can_assign(auth.user, roles)
    before = u.role_names
    db.execute(delete(UserRole).where(UserRole.user_id == u.id))
    for r in roles:
        db.add(UserRole(user_id=u.id, role_id=r.id, assigned_by_id=auth.user.id))
    db.flush()
    db.expire(u, ["roles"])
    after = [r.name for r in roles]
    revoke_all_for_user(db, u.id, "roles_changed", auth.user)  # force re-authentication with new privileges
    audit.record(db, "user.roles_changed", "user_management", actor=auth.user, ip=auth.client.ip, severity="medium",
                 target_type="user", target_id=u.id, target_label=u.email, details={"before": before, "after": after})
    notify_user(db, u.id, "Your roles were updated", f"Roles changed from {', '.join(before)} to {', '.join(after)}.",
                category="account", severity="low")
    db.commit()
    return user_out(db, u)


def _status_change(db: Session, auth: AuthContext, user_id: uuid.UUID, new_status: str, action: str, reason: str | None):
    u = _get_user(db, user_id)
    ensure_can_manage(auth.user, u)
    prev = u.status
    u.status = new_status
    revoked = 0
    if new_status != "active":
        revoked = revoke_all_for_user(db, u.id, f"account_{new_status}", auth.user)
    else:
        u.locked_until, u.failed_login_count = None, 0
    audit.record(db, action, "user_management", actor=auth.user, ip=auth.client.ip,
                 severity="medium" if new_status != "active" else "low", target_type="user", target_id=u.id,
                 target_label=u.email, details={"from": prev, "to": new_status, "reason": reason, "sessions_revoked": revoked})
    db.commit()
    return user_out(db, u)


@router.post("/users/{user_id}/suspend", response_model=UserOut)
def suspend_user(user_id: uuid.UUID, body: StatusChange, auth: AuthContext = Depends(require("users:write")),
                 db: Session = Depends(get_db)) -> UserOut:
    return _status_change(db, auth, user_id, "suspended", "user.suspended", body.reason)


@router.post("/users/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(user_id: uuid.UUID, body: StatusChange, auth: AuthContext = Depends(require("users:write")),
                    db: Session = Depends(get_db)) -> UserOut:
    return _status_change(db, auth, user_id, "deactivated", "user.deactivated", body.reason)


@router.post("/users/{user_id}/activate", response_model=UserOut)
def activate_user(user_id: uuid.UUID, body: StatusChange, auth: AuthContext = Depends(require("users:write")),
                  db: Session = Depends(get_db)) -> UserOut:
    return _status_change(db, auth, user_id, "active", "user.activated", body.reason)


@router.post("/users/{user_id}/reset-access")
def reset_access(user_id: uuid.UUID, body: ResetAccessIn, auth: AuthContext = Depends(require("users:write")),
                 db: Session = Depends(get_db)) -> dict:
    u = _get_user(db, user_id)
    ensure_can_manage(auth.user, u)
    summary: dict = {}
    if body.revoke_sessions:
        summary["sessions_revoked"] = revoke_all_for_user(db, u.id, "access_reset", auth.user)
    if body.reset_mfa:
        db.execute(delete(MFAConfig).where(MFAConfig.user_id == u.id))
        db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == u.id))
        u.mfa_enabled = False
        summary["mfa_reset"] = True
    if body.revoke_grants:
        grants = db.execute(select(AccessRequest).where(AccessRequest.requester_id == u.id,
                                                        AccessRequest.status == "approved")).scalars().all()
        for g in grants:
            g.status, g.revoked_at, g.revoked_by_id = "revoked", utcnow(), auth.user.id
        summary["grants_revoked"] = len(grants)
    if body.force_password_reset:
        token = generate_token(32)
        db.add(PasswordResetToken(user_id=u.id, token_hash=hash_token(token), expires_at=utcnow() + timedelta(hours=24)))
        u.password_hash = hash_password(generate_token(32))  # invalidate current password
        log.warning("Admin-initiated password reset link for %s: %s/reset-password?token=%s", u.email, settings.FRONTEND_URL, token)
        summary["password_reset_issued"] = True
    u.failed_login_count, u.locked_until = 0, None
    risk.recompute_user_risk(db, u)
    audit.record(db, "user.access_reset", "user_management", actor=auth.user, ip=auth.client.ip, severity="high",
                 target_type="user", target_id=u.id, target_label=u.email, details={**summary, "reason": body.reason})
    db.commit()
    return {"message": "Access reset completed", "summary": summary}


@router.post("/users/{user_id}/unlock", response_model=UserOut)
def unlock_user(user_id: uuid.UUID, auth: AuthContext = Depends(require("users:write")), db: Session = Depends(get_db)) -> UserOut:
    u = _get_user(db, user_id)
    ensure_can_manage(auth.user, u)
    u.locked_until, u.failed_login_count = None, 0
    audit.record(db, "user.unlocked", "user_management", actor=auth.user, ip=auth.client.ip, target_type="user",
                 target_id=u.id, target_label=u.email)
    db.commit()
    return user_out(db, u)


@router.post("/users/{user_id}/recalculate-risk")
def recalc_risk(user_id: uuid.UUID, auth: AuthContext = Depends(require("users:write")), db: Session = Depends(get_db)) -> dict:
    u = _get_user(db, user_id)
    prev = u.risk_score
    score, factors = risk.compute_user_risk(db, u)
    u.risk_score = score
    db.commit()
    return {"previous": prev, "score": score, "level": risk.level(score), "factors": factors}


@router.get("/users/{user_id}/login-history")
def user_login_history(user_id: uuid.UUID, params: PageParams = Depends(),
                       auth: AuthContext = Depends(require("users:read")), db: Session = Depends(get_db)) -> dict:
    _get_user(db, user_id)
    q = select(SecurityEvent).where(SecurityEvent.user_id == user_id, SecurityEvent.event_type.in_(AUTH_EVENT_TYPES))
    return paginate(db, q, params, {"created_at": SecurityEvent.created_at}, "created_at", mapper=event_out)


# ------------------------------------------------------------------ roles & permissions
@router.get("/roles")
def list_roles(auth: AuthContext = Depends(require("roles:read")), db: Session = Depends(get_db)) -> list[dict]:
    counts = dict(db.execute(select(UserRole.role_id, func.count()).group_by(UserRole.role_id)).all())
    roles = db.execute(select(Role).order_by(Role.level.desc())).scalars().all()
    return [{
        "id": str(r.id), "name": r.name, "display_name": r.display_name, "description": r.description,
        "level": r.level, "is_system": r.is_system, "user_count": counts.get(r.id, 0),
        "permissions": [{"id": str(p.id), "code": p.code, "category": p.category} for p in sorted(r.permissions, key=lambda p: p.code)],
        "assignable": is_super(auth.user) or r.level < auth.user.max_role_level,
    } for r in roles]


@router.get("/permissions")
def list_permissions(auth: AuthContext = Depends(require("roles:read")), db: Session = Depends(get_db)) -> list[dict]:
    perms = db.execute(select(Permission).order_by(Permission.category, Permission.code)).scalars().all()
    return [{"id": str(p.id), "code": p.code, "description": p.description, "category": p.category} for p in perms]


@router.put("/roles/{role_id}/permissions")
def set_role_permissions(role_id: uuid.UUID, body: RolePermissionsUpdate, auth: AuthContext = Depends(require("roles:write")),
                         db: Session = Depends(get_db)) -> dict:
    role = db.get(Role, role_id)
    if not role:
        raise not_found("Role")
    if role.name == "super_admin":
        raise forbidden("The Super Admin role's permissions are immutable")
    if not is_super(auth.user) and role.level >= auth.user.max_role_level:
        raise forbidden("You cannot modify a role with equal or higher privileges")
    perms = list(db.execute(select(Permission).where(Permission.id.in_(body.permission_ids))).scalars())
    if len(perms) != len(set(body.permission_ids)):
        raise bad_request("Unknown permission id")
    if not is_super(auth.user):
        extra = {p.code for p in perms} - auth.user.permission_codes
        if extra:
            raise forbidden(f"You cannot grant permissions you do not hold: {', '.join(sorted(extra))}")
    before = sorted(p.code for p in role.permissions)
    db.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
    for p in perms:
        db.add(RolePermission(role_id=role.id, permission_id=p.id))
    after = sorted(p.code for p in perms)
    audit.record(db, "role.permissions_changed", "user_management", actor=auth.user, ip=auth.client.ip, severity="high",
                 target_type="role", target_id=role.id, target_label=role.name,
                 details={"added": sorted(set(after) - set(before)), "removed": sorted(set(before) - set(after))})
    db.commit()
    return {"message": "Role permissions updated", "permissions": after}
