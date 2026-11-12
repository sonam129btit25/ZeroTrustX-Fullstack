"""Session monitoring and termination."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.utils import forbidden, not_found, paginate
from app.core.deps import AuthContext, get_auth, require
from app.db.base import utcnow
from app.db.session import get_db
from app.models import User, UserSession
from app.schemas.common import PageParams
from app.services import audit, risk
from app.services.sessions import expire_stale_sessions, revoke_session

router = APIRouter(prefix="/sessions", tags=["Sessions"])


class TerminateIn(BaseModel):
    reason: str | None = Field(None, max_length=255)


def session_state(s: UserSession) -> str:
    if s.revoked_at:
        return "expired" if s.revoked_reason in ("expired", "idle_timeout") else "revoked"
    if s.expires_at <= utcnow():
        return "expired"
    return "active"


def session_out(s: UserSession, current_id=None) -> dict:
    return {
        "id": str(s.id), "user": {"id": str(s.user.id), "email": s.user.email, "full_name": s.user.full_name},
        "device": {"id": str(s.device.id), "name": s.device.name, "trust_status": s.device.trust_status} if s.device else None,
        "ip_address": s.ip_address, "user_agent": s.user_agent, "location": s.location, "created_at": s.created_at,
        "last_activity_at": s.last_activity_at, "expires_at": s.expires_at, "revoked_at": s.revoked_at,
        "revoked_reason": s.revoked_reason, "mfa_verified": s.mfa_verified, "risk_score": s.risk_score,
        "risk_level": risk.level(s.risk_score), "status": session_state(s), "refresh_count": s.refresh_count,
        "is_current": current_id is not None and s.id == current_id, "is_demo": s.is_demo,
    }


@router.get("")
def list_sessions(
    params: PageParams = Depends(),
    status: str | None = Query(None, pattern="^(active|revoked|expired)$"),
    user_id: uuid.UUID | None = None,
    risk_min: int | None = Query(None, ge=0, le=100),
    auth: AuthContext = Depends(require("sessions:read_all")),
    db: Session = Depends(get_db),
) -> dict:
    now = utcnow()
    q = select(UserSession).join(User, User.id == UserSession.user_id)
    if params.q:
        like = f"%{params.q.lower()}%"
        q = q.where(or_(func.lower(User.email).like(like), UserSession.ip_address.like(like)))
    if status == "active":
        q = q.where(UserSession.revoked_at.is_(None), UserSession.expires_at > now)
    elif status == "revoked":
        q = q.where(UserSession.revoked_at.is_not(None), UserSession.revoked_reason.not_in(["expired", "idle_timeout"]))
    elif status == "expired":
        q = q.where(or_(UserSession.revoked_reason.in_(["expired", "idle_timeout"]),
                        and_(UserSession.revoked_at.is_(None), UserSession.expires_at <= now)))
    if user_id:
        q = q.where(UserSession.user_id == user_id)
    if risk_min is not None:
        q = q.where(UserSession.risk_score >= risk_min)
    sortable = {"created_at": UserSession.created_at, "last_activity_at": UserSession.last_activity_at,
                "risk_score": UserSession.risk_score, "expires_at": UserSession.expires_at}
    return paginate(db, q, params, sortable, "last_activity_at", mapper=lambda s: session_out(s, auth.session.id))


@router.get("/stats")
def session_stats(auth: AuthContext = Depends(require("sessions:read_all")), db: Session = Depends(get_db)) -> dict:
    now = utcnow()
    active = select(UserSession).where(UserSession.revoked_at.is_(None), UserSession.expires_at > now).subquery()
    total_active = db.scalar(select(func.count()).select_from(active)) or 0
    high_risk = db.scalar(select(func.count()).select_from(active).where(active.c.risk_score >= 60)) or 0
    no_mfa = db.scalar(select(func.count()).select_from(active).where(active.c.mfa_verified.is_(False))) or 0
    users = db.scalar(select(func.count(func.distinct(active.c.user_id)))) or 0
    multi_ip = db.execute(
        select(active.c.user_id, func.count(func.distinct(active.c.ip_address)).label("n"))
        .group_by(active.c.user_id).having(func.count(func.distinct(active.c.ip_address)) > 1)
    ).all()
    flagged = []
    for uid, n in multi_ip:
        u = db.get(User, uid)
        flagged.append({"user_id": str(uid), "email": u.email if u else None, "distinct_ips": n,
                        "pattern": "Concurrent sessions from multiple IP addresses"})
    return {"active": total_active, "high_risk": high_risk, "without_mfa": no_mfa, "distinct_users": users,
            "unusual_patterns": flagged}


@router.get("/mine")
def my_sessions(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(UserSession).where(UserSession.user_id == auth.user.id)
                      .order_by(UserSession.created_at.desc()).limit(25)).scalars()
    return [session_out(s, auth.session.id) for s in rows]


@router.get("/{session_id}")
def get_session(session_id: uuid.UUID, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    s = db.get(UserSession, session_id)
    if not s:
        raise not_found("Session")
    if s.user_id != auth.user.id and not auth.has("sessions:read_all"):
        raise not_found("Session")
    return session_out(s, auth.session.id)


@router.post("/{session_id}/terminate")
def terminate(session_id: uuid.UUID, body: TerminateIn, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    s = db.get(UserSession, session_id)
    if not s:
        raise not_found("Session")
    own = s.user_id == auth.user.id
    if not own and not auth.has("sessions:terminate"):
        raise forbidden("You do not have permission to terminate other users' sessions")
    if not own and "super_admin" not in auth.user.role_names and s.user.max_role_level >= auth.user.max_role_level:
        raise forbidden("You cannot terminate sessions of users with equal or higher privileges")
    if s.revoked_at:
        return session_out(s, auth.session.id)
    revoke_session(db, s, body.reason or ("terminated_by_user" if own else "terminated_by_admin"), auth.user)
    audit.record(db, "session.terminated", "session", actor=auth.user, ip=auth.client.ip,
                 severity="low" if own else "medium", target_type="session", target_id=s.id, target_label=s.user.email,
                 details={"reason": body.reason, "self": own})
    db.commit()
    return session_out(s, auth.session.id)


@router.post("/expire-stale")
def expire_stale(auth: AuthContext = Depends(require("sessions:terminate")), db: Session = Depends(get_db)) -> dict:
    n = expire_stale_sessions(db)
    if n:
        audit.record(db, "session.expired_sweep", "session", actor=auth.user, ip=auth.client.ip, details={"expired": n})
    db.commit()
    return {"expired": n}
