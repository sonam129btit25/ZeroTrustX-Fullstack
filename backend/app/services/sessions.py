from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import generate_token, hash_token
from app.db.base import utcnow
from app.models import Device, User, UserSession
from app.services.org import get_org
from app.ws.manager import ADMINS, queue_event, queue_session_close


def create_session(db: Session, user: User, device: Device | None, ip: str | None, ua: str | None,
                   mfa_verified: bool) -> tuple[UserSession, str]:
    org = get_org(db)
    lifetime = min(timedelta(minutes=org.session_timeout_minutes), timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))
    refresh = generate_token()
    s = UserSession(
        user_id=user.id, device_id=device.id if device else None, ip_address=ip, user_agent=ua,
        location=guess_location(ip), expires_at=utcnow() + lifetime, mfa_verified=mfa_verified,
        refresh_token_hash=hash_token(refresh), risk_score=user.risk_score,
    )
    db.add(s)
    db.flush()
    queue_event(db, "session.created", {"id": str(s.id), "user": user.email, "ip": ip}, ADMINS)
    return s, refresh


def guess_location(ip: str | None) -> str | None:
    """No GeoIP database is bundled; only private/loopback ranges can be classified honestly."""
    if not ip:
        return None
    import ipaddress

    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if a.is_loopback:
        return "Localhost"
    if a.is_private:
        return "Private network"
    return None  # Unknown without a GeoIP integration


def revoke_session(db: Session, s: UserSession, reason: str, by: User | None = None) -> None:
    if s.revoked_at is not None:
        return
    s.revoked_at = utcnow()
    s.revoked_reason = reason
    s.revoked_by_id = by.id if by else None
    s.refresh_token_hash = None
    queue_event(db, "session.revoked", {"id": str(s.id), "user_id": str(s.user_id), "reason": reason}, ADMINS)
    queue_session_close(db, s.id, reason)


def revoke_all_for_user(db: Session, user_id: uuid.UUID, reason: str, by: User | None = None,
                        except_session: uuid.UUID | None = None) -> int:
    q = select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_session:
        q = q.where(UserSession.id != except_session)
    sessions = db.execute(q).scalars().all()
    for s in sessions:
        revoke_session(db, s, reason, by)
    return len(sessions)


def expire_stale_sessions(db: Session) -> int:
    """Mark absolute-expired and idle sessions as revoked (called periodically)."""
    org = get_org(db)
    now = utcnow()
    idle_cutoff = now - timedelta(minutes=org.idle_timeout_minutes)
    stale = db.execute(
        select(UserSession).where(
            UserSession.revoked_at.is_(None),
            (UserSession.expires_at <= now) | (UserSession.last_activity_at <= idle_cutoff),
        )
    ).scalars().all()
    for s in stale:
        revoke_session(db, s, "expired" if s.expires_at <= now else "idle_timeout")
    return len(stale)


def touch(db: Session, s: UserSession) -> None:
    now = utcnow()
    if (now - s.last_activity_at).total_seconds() > 30:
        db.execute(update(UserSession).where(UserSession.id == s.id).values(last_activity_at=now))
        s.last_activity_at = now
