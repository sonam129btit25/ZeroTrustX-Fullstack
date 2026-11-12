"""Notifications, organization settings, global search and system status."""
from __future__ import annotations

import uuid
from zoneinfo import ZoneInfo, available_timezones

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.api.utils import not_found, paginate
from app.core.config import settings
from app.core.deps import AuthContext, get_auth, require
from app.db.base import utcnow
from app.db.session import get_db
from app.models import Device, Incident, Notification, Policy, ProtectedResource, ThreatAlert, User
from app.schemas.common import PageParams
from app.services import audit
from app.services.org import DEFAULT_RISK_WEIGHTS, get_org, risk_weights

router = APIRouter(tags=["Platform"])


# ------------------------------------------------------------------ notifications
def notif_out(n: Notification) -> dict:
    return {"id": str(n.id), "title": n.title, "body": n.body, "category": n.category, "severity": n.severity,
            "link": n.link, "read_at": n.read_at, "created_at": n.created_at}


@router.get("/notifications")
def list_notifications(params: PageParams = Depends(), unread: bool = False, auth: AuthContext = Depends(get_auth),
                       db: Session = Depends(get_db)) -> dict:
    q = select(Notification).where(Notification.user_id == auth.user.id)
    if unread:
        q = q.where(Notification.read_at.is_(None))
    page = paginate(db, q, params, {"created_at": Notification.created_at}, "created_at", mapper=notif_out)
    page["unread"] = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == auth.user.id, Notification.read_at.is_(None))) or 0
    return page


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: uuid.UUID, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    n = db.get(Notification, notification_id)
    if not n or n.user_id != auth.user.id:
        raise not_found("Notification")
    n.read_at = n.read_at or utcnow()
    db.commit()
    return notif_out(n)


@router.post("/notifications/read-all")
def mark_all(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    r = db.execute(update(Notification).where(Notification.user_id == auth.user.id, Notification.read_at.is_(None))
                   .values(read_at=utcnow()))
    db.commit()
    return {"updated": r.rowcount}


# ------------------------------------------------------------------ settings
class OrgSettingsIn(BaseModel):
    org_name: str = Field(min_length=2, max_length=150)
    domain: str | None = Field(None, max_length=150)
    timezone: str = Field(max_length=60)
    session_timeout_minutes: int = Field(ge=15, le=10080)
    idle_timeout_minutes: int = Field(ge=5, le=1440)
    password_min_length: int = Field(ge=8, le=64)
    password_require_upper: bool
    password_require_lower: bool
    password_require_digit: bool
    password_require_symbol: bool
    max_failed_logins: int = Field(ge=3, le=20)
    lockout_minutes: int = Field(ge=1, le=1440)
    mfa_required_roles: list[str] = Field(max_length=5)
    risk_block_threshold: int = Field(ge=1, le=100)
    risk_mfa_threshold: int = Field(ge=0, le=100)
    default_policy_action: str = Field(pattern="^(DENY|REQUIRE_MFA|RESTRICTED_ACCESS|ALLOW)$")
    business_hours_start: int = Field(ge=0, le=23)
    business_hours_end: int = Field(ge=1, le=24)
    risk_weights: dict[str, int]
    notification_settings: dict[str, bool]
    allow_self_registration: bool

    @field_validator("timezone")
    @classmethod
    def tz(cls, v: str) -> str:
        ZoneInfo(v)
        return v

    @field_validator("mfa_required_roles")
    @classmethod
    def roles(cls, v: list[str]) -> list[str]:
        allowed = {"super_admin", "security_admin", "analyst", "employee", "guest"}
        bad = set(v) - allowed
        if bad:
            raise ValueError(f"Unknown roles: {', '.join(bad)}")
        return v

    @field_validator("risk_weights")
    @classmethod
    def weights(cls, v: dict[str, int]) -> dict[str, int]:
        for k, val in v.items():
            if k not in DEFAULT_RISK_WEIGHTS or not 0 <= val <= 100:
                raise ValueError(f"Invalid risk weight '{k}'")
        return v

    @model_validator(mode="after")
    def thresholds(self):
        if self.risk_mfa_threshold >= self.risk_block_threshold:
            raise ValueError("MFA step-up threshold must be lower than the block threshold")
        if self.business_hours_start >= self.business_hours_end:
            raise ValueError("Business hours start must be before end")
        if self.idle_timeout_minutes > self.session_timeout_minutes:
            raise ValueError("Idle timeout cannot exceed the session timeout")
        return self


def org_out(db: Session) -> dict:
    o = get_org(db)
    return {
        "org_name": o.org_name, "domain": o.domain, "timezone": o.timezone,
        "session_timeout_minutes": o.session_timeout_minutes, "idle_timeout_minutes": o.idle_timeout_minutes,
        "password_min_length": o.password_min_length, "password_require_upper": o.password_require_upper,
        "password_require_lower": o.password_require_lower, "password_require_digit": o.password_require_digit,
        "password_require_symbol": o.password_require_symbol, "max_failed_logins": o.max_failed_logins,
        "lockout_minutes": o.lockout_minutes, "mfa_required_roles": o.mfa_required_roles or [],
        "risk_block_threshold": o.risk_block_threshold, "risk_mfa_threshold": o.risk_mfa_threshold,
        "default_policy_action": o.default_policy_action, "business_hours_start": o.business_hours_start,
        "business_hours_end": o.business_hours_end, "risk_weights": risk_weights(o),
        "notification_settings": o.notification_settings or {}, "allow_self_registration": o.allow_self_registration,
        "updated_at": o.updated_at,
    }


@router.get("/settings/organization")
def get_settings(auth: AuthContext = Depends(require("settings:read")), db: Session = Depends(get_db)) -> dict:
    return org_out(db)


@router.put("/settings/organization")
def put_settings(body: OrgSettingsIn, auth: AuthContext = Depends(require("settings:write")), db: Session = Depends(get_db)) -> dict:
    o = get_org(db)
    before = org_out(db)
    for k, v in body.model_dump().items():
        setattr(o, k, v)
    o.updated_by_id = auth.user.id
    changed = {k: [before[k], v] for k, v in body.model_dump().items() if before.get(k) != v}
    audit.record(db, "settings.updated", "system", actor=auth.user, ip=auth.client.ip, severity="high",
                 target_type="organization_settings", target_id=1, details={"changed": changed})
    db.commit()
    return org_out(db)


@router.get("/settings/timezones")
def timezones(auth: AuthContext = Depends(get_auth)) -> list[str]:
    return sorted(z for z in available_timezones() if "/" in z and not z.startswith(("Etc/", "SystemV/"))) + ["UTC"]


@router.get("/system/status")
def system_status(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    from app.api.routes.dashboard import STARTED
    import time

    from app.ws.manager import manager

    db.execute(select(1))
    return {"status": "operational", "version": "1.0.0", "environment": settings.APP_ENV,
            "uptime_seconds": int(time.time() - STARTED), "websocket_clients": manager.count,
            "assistant_provider": settings.ASSISTANT_PROVIDER,
            "components": {"api": "operational", "database": "operational", "policy_engine": "operational",
                           "realtime": "operational"}}


# ------------------------------------------------------------------ search
@router.get("/search")
def search(q: str = Query(min_length=2, max_length=100), auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> dict:
    like = f"%{q.lower()}%"
    out: dict[str, list] = {}
    if auth.has("users:read"):
        out["users"] = [{"id": str(u.id), "title": u.full_name, "subtitle": u.email, "link": f"/identity/users/{u.id}"}
                        for u in db.execute(select(User).where(or_(func.lower(User.email).like(like),
                                                                   func.lower(User.full_name).like(like))).limit(6)).scalars()]
    if auth.has("devices:read"):
        out["devices"] = [{"id": str(d.id), "title": d.name, "subtitle": d.trust_status, "link": f"/devices?id={d.id}"}
                          for d in db.execute(select(Device).where(or_(func.lower(Device.name).like(like),
                                                                       Device.ip_address.like(like))).limit(6)).scalars()]
    if auth.has("resources:read"):
        out["resources"] = [{"id": str(r.id), "title": r.name, "subtitle": r.sensitivity, "link": f"/resources?id={r.id}"}
                            for r in db.execute(select(ProtectedResource).where(
                                func.lower(ProtectedResource.name).like(like)).limit(6)).scalars()]
    if auth.has("policies:read"):
        out["policies"] = [{"id": str(p.id), "title": p.name, "subtitle": p.action, "link": f"/policies?id={p.id}"}
                           for p in db.execute(select(Policy).where(func.lower(Policy.name).like(like)).limit(6)).scalars()]
    if auth.has("incidents:read"):
        out["incidents"] = [{"id": str(i.id), "title": f"{i.reference} {i.title}", "subtitle": i.status,
                             "link": f"/incidents/{i.id}"}
                            for i in db.execute(select(Incident).where(or_(func.lower(Incident.title).like(like),
                                                                           func.lower(Incident.reference).like(like))).limit(6)).scalars()]
    if auth.has("threats:read"):
        out["threats"] = [{"id": str(a.id), "title": a.title, "subtitle": a.severity, "link": f"/threats?alert={a.id}"}
                          for a in db.execute(select(ThreatAlert).where(func.lower(ThreatAlert.title).like(like))
                                              .order_by(ThreatAlert.detected_at.desc()).limit(6)).scalars()]
    return out
