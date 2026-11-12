"""Device trust management. Devices are identified by a browser-generated identifier or manual
registration; no endpoint agent is involved, so OS posture is self-reported."""
from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.utils import conflict, not_found, paginate
from app.core.deps import AuthContext, get_auth, require
from app.db.base import utcnow
from app.db.session import get_db
from app.models import AccessDecision, Device, DeviceTrustHistory, SecurityEvent, User, UserSession
from app.models.enums import TrustStatus
from app.schemas.common import PageParams
from app.services import audit
from app.services.devices import set_trust

router = APIRouter(prefix="/devices", tags=["Device Trust"])

TRUST_PATTERN = "^(trusted|untrusted|suspicious|blocked|pending_verification)$"


class DeviceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    device_identifier: str | None = Field(None, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    device_type: str = Field("laptop", pattern="^(laptop|desktop|mobile|tablet|server|browser)$")
    os: str | None = Field(None, max_length=60)
    os_version: str | None = Field(None, max_length=60)
    user_id: uuid.UUID | None = None
    trust_status: str = Field("pending_verification", pattern=TRUST_PATTERN)
    notes: str | None = Field(None, max_length=2000)


class DeviceUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=150)
    device_type: str | None = Field(None, pattern="^(laptop|desktop|mobile|tablet|server|browser)$")
    os: str | None = Field(None, max_length=60)
    os_version: str | None = Field(None, max_length=60)
    user_id: uuid.UUID | None = None
    notes: str | None = Field(None, max_length=2000)


class TrustChange(BaseModel):
    status: str = Field(pattern=TRUST_PATTERN)
    reason: str | None = Field(None, max_length=500)


def device_out(d: Device) -> dict:
    return {
        "id": str(d.id), "device_identifier": d.device_identifier, "name": d.name, "device_type": d.device_type,
        "os": d.os, "os_version": d.os_version, "browser": d.browser, "ip_address": d.ip_address,
        "last_seen_at": d.last_seen_at, "trust_status": d.trust_status, "risk_score": d.risk_score,
        "registered_via": d.registered_via, "approved_at": d.approved_at, "notes": d.notes, "created_at": d.created_at,
        "is_demo": d.is_demo,
        "user": {"id": str(d.user.id), "email": d.user.email, "full_name": d.user.full_name} if d.user else None,
    }


@router.get("")
def list_devices(
    params: PageParams = Depends(),
    trust_status: str | None = Query(None, pattern=TRUST_PATTERN),
    user_id: uuid.UUID | None = None,
    auth: AuthContext = Depends(require("devices:read")),
    db: Session = Depends(get_db),
) -> dict:
    q = select(Device).outerjoin(User, User.id == Device.user_id)
    if params.q:
        like = f"%{params.q.lower()}%"
        q = q.where(or_(func.lower(Device.name).like(like), func.lower(Device.device_identifier).like(like),
                        func.lower(User.email).like(like), Device.ip_address.like(like)))
    if trust_status:
        q = q.where(Device.trust_status == trust_status)
    if user_id:
        q = q.where(Device.user_id == user_id)
    sortable = {"last_seen_at": Device.last_seen_at, "name": Device.name, "risk_score": Device.risk_score,
                "created_at": Device.created_at, "trust_status": Device.trust_status}
    return paginate(db, q, params, sortable, "last_seen_at", mapper=device_out)


@router.get("/summary")
def device_summary(auth: AuthContext = Depends(require("devices:read")), db: Session = Depends(get_db)) -> dict:
    rows = dict(db.execute(select(Device.trust_status, func.count()).group_by(Device.trust_status)).all())
    return {s.value: rows.get(s.value, 0) for s in TrustStatus} | {"total": sum(rows.values())}


@router.get("/mine")
def my_devices(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> list[dict]:
    devs = db.execute(select(Device).where(Device.user_id == auth.user.id).order_by(Device.last_seen_at.desc())).scalars()
    current = auth.session.device_id
    return [device_out(d) | {"is_current": d.id == current} for d in devs]


@router.post("", status_code=201)
def register_device(body: DeviceCreate, auth: AuthContext = Depends(require("devices:write")), db: Session = Depends(get_db)) -> dict:
    ident = body.device_identifier or f"mdev-{secrets.token_hex(12)}"
    if db.execute(select(Device.id).where(Device.device_identifier == ident)).first():
        raise conflict("A device with this identifier is already registered")
    if body.user_id and not db.get(User, body.user_id):
        raise not_found("User")
    d = Device(device_identifier=ident, name=body.name, device_type=body.device_type, os=body.os,
               os_version=body.os_version, user_id=body.user_id, trust_status="pending_verification",
               registered_via="manual", notes=body.notes, risk_score=20)
    db.add(d)
    db.flush()
    db.add(DeviceTrustHistory(device_id=d.id, to_status="pending_verification", changed_by_id=auth.user.id,
                              reason="Registered manually by administrator"))
    audit.record(db, "device.registered", "device", actor=auth.user, ip=auth.client.ip, target_type="device",
                 target_id=d.id, target_label=d.name, details={"via": "manual"})
    if body.trust_status != "pending_verification":
        set_trust(db, d, body.trust_status, auth.user, "Initial trust set at registration", auth.client.ip)
    db.commit()
    db.refresh(d)
    return device_out(d)


@router.get("/{device_id}")
def get_device(device_id: uuid.UUID, auth: AuthContext = Depends(require("devices:read")), db: Session = Depends(get_db)) -> dict:
    d = db.get(Device, device_id)
    if not d:
        raise not_found("Device")
    history = db.execute(select(DeviceTrustHistory).where(DeviceTrustHistory.device_id == d.id)
                         .order_by(DeviceTrustHistory.created_at.desc())).scalars().all()
    sessions = db.execute(select(UserSession).where(UserSession.device_id == d.id)
                          .order_by(UserSession.created_at.desc()).limit(20)).scalars().all()
    events = db.execute(select(SecurityEvent).where(SecurityEvent.device_id == d.id)
                        .order_by(SecurityEvent.created_at.desc()).limit(25)).scalars().all()
    decisions = db.execute(select(AccessDecision).where(AccessDecision.device_id == d.id)
                           .order_by(AccessDecision.evaluated_at.desc()).limit(20)).scalars().all()
    return {
        "device": device_out(d),
        "trust_history": [{"id": str(h.id), "from_status": h.from_status, "to_status": h.to_status, "reason": h.reason,
                           "changed_by": h.changed_by.email if h.changed_by else "system", "created_at": h.created_at}
                          for h in history],
        "sessions": [{"id": str(s.id), "user": s.user.email, "ip_address": s.ip_address, "created_at": s.created_at,
                      "revoked_at": s.revoked_at, "active": s.revoked_at is None and s.expires_at > utcnow()} for s in sessions],
        "events": [{"id": str(e.id), "event_type": e.event_type, "ip_address": e.ip_address, "created_at": e.created_at,
                    "severity": e.severity} for e in events],
        "decisions": [{"id": str(x.id), "decision": x.decision, "resource": x.resource.name if x.resource else None,
                       "evaluated_at": x.evaluated_at} for x in decisions],
        "posture_note": "Device identity is based on a browser-generated identifier or manual registration. "
                        "No endpoint agent is installed, so OS patch level, disk encryption and EDR status are not verified.",
    }


@router.patch("/{device_id}")
def update_device(device_id: uuid.UUID, body: DeviceUpdate, auth: AuthContext = Depends(require("devices:write")),
                  db: Session = Depends(get_db)) -> dict:
    d = db.get(Device, device_id)
    if not d:
        raise not_found("Device")
    changes = body.model_dump(exclude_unset=True)
    if "user_id" in changes and changes["user_id"] and not db.get(User, changes["user_id"]):
        raise not_found("User")
    for k, v in changes.items():
        setattr(d, k, v)
    audit.record(db, "device.updated", "device", actor=auth.user, ip=auth.client.ip, target_type="device",
                 target_id=d.id, target_label=d.name, details={"fields": sorted(changes)})
    db.commit()
    db.refresh(d)
    return device_out(d)


@router.post("/{device_id}/trust")
def change_trust(device_id: uuid.UUID, body: TrustChange, auth: AuthContext = Depends(require("devices:write")),
                 db: Session = Depends(get_db)) -> dict:
    d = db.get(Device, device_id)
    if not d:
        raise not_found("Device")
    set_trust(db, d, body.status, auth.user, body.reason, auth.client.ip)
    if body.status == "blocked":
        from app.services.sessions import revoke_session

        for s in db.execute(select(UserSession).where(UserSession.device_id == d.id, UserSession.revoked_at.is_(None))).scalars():
            revoke_session(db, s, "device_blocked", auth.user)
    db.commit()
    db.refresh(d)
    return device_out(d)


@router.delete("/{device_id}", status_code=204)
def delete_device(device_id: uuid.UUID, auth: AuthContext = Depends(require("devices:write")), db: Session = Depends(get_db)) -> None:
    d = db.get(Device, device_id)
    if not d:
        raise not_found("Device")
    audit.record(db, "device.deleted", "device", actor=auth.user, ip=auth.client.ip, severity="medium",
                 target_type="device", target_id=d.id, target_label=d.name)
    db.delete(d)
    db.commit()
