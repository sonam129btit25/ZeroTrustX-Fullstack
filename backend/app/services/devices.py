from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models import Device, DeviceTrustHistory, User
from app.services import audit
from app.services.notify import notify_user
from app.ws.manager import ADMINS, queue_event


def parse_user_agent(ua: str | None) -> dict[str, str | None]:
    ua = ua or ""
    os_name, os_ver, browser, dtype = None, None, None, "browser"
    if m := re.search(r"Windows NT ([\d.]+)", ua):
        os_name, os_ver = "Windows", {"10.0": "10/11", "6.3": "8.1", "6.1": "7"}.get(m.group(1), m.group(1))
    elif m := re.search(r"Mac OS X ([\d_]+)", ua):
        os_name, os_ver = "macOS", m.group(1).replace("_", ".")
    elif m := re.search(r"Android ([\d.]+)", ua):
        os_name, os_ver, dtype = "Android", m.group(1), "mobile"
    elif m := re.search(r"(?:iPhone|CPU) OS ([\d_]+)", ua):
        os_name, os_ver, dtype = "iOS", m.group(1).replace("_", "."), "mobile"
    elif "Linux" in ua:
        os_name = "Linux"
    for pat, name in ((r"Edg/([\d]+)", "Edge"), (r"Chrome/([\d]+)", "Chrome"), (r"Firefox/([\d]+)", "Firefox"),
                      (r"Version/([\d]+).*Safari", "Safari")):
        if m := re.search(pat, ua):
            browser = f"{name} {m.group(1)}"
            break
    if "HeadlessChrome" in ua:
        browser = "Headless Chrome"
    return {"os": os_name, "os_version": os_ver, "browser": browser, "device_type": dtype}


def get_or_register_login_device(
    db: Session, user: User, identifier: str | None, ua: str | None, ip: str | None, name_hint: str | None,
) -> tuple[Device | None, bool]:
    """Bind the browser-generated device identifier to a Device record.

    NOTE: this identifies a *browser installation*, not a verified endpoint. No endpoint agent is
    involved, so posture (disk encryption, patch level, EDR) is not assessed.
    """
    if not identifier:
        return None, False
    dev = db.execute(select(Device).where(Device.device_identifier == identifier)).scalar()
    is_new = False
    info = parse_user_agent(ua)
    if dev is None:
        label = name_hint or f"{info['browser'] or 'Browser'} on {info['os'] or 'unknown OS'}"
        dev = Device(
            device_identifier=identifier, name=label[:150], device_type=info["device_type"], os=info["os"],
            os_version=info["os_version"], browser=info["browser"], ip_address=ip, user_id=user.id,
            trust_status="pending_verification", registered_via="login", last_seen_at=utcnow(), risk_score=30,
        )
        db.add(dev)
        db.flush()
        db.add(DeviceTrustHistory(device_id=dev.id, from_status=None, to_status=dev.trust_status,
                                  reason="Automatically registered on first sign-in"))
        audit.record(db, "device.registered", "device", actor=user, ip=ip, target_type="device", target_id=dev.id,
                     target_label=dev.name, details={"via": "login", "trust_status": dev.trust_status})
        queue_event(db, "device.updated", {"id": str(dev.id), "name": dev.name, "trust_status": dev.trust_status}, ADMINS)
        is_new = True
        prefs = user.preferences or {}
        if prefs.get("notify_new_device", True):
            notify_user(db, user.id, "New device signed in",
                        f"A new device '{dev.name}' signed in from {ip or 'an unknown IP'}. It is pending verification.",
                        category="device", severity="low", link="/devices")
    else:
        if dev.user_id is None:
            dev.user_id = user.id
        dev.ip_address = ip
        dev.last_seen_at = utcnow()
        if info["browser"]:
            dev.browser = info["browser"]
    return dev, is_new


def set_trust(db: Session, dev: Device, status: str, actor: User | None, reason: str | None, ip: str | None = None) -> None:
    prev = dev.trust_status
    if prev == status:
        return
    dev.trust_status = status
    if status == "trusted":
        dev.approved_by_id = actor.id if actor else None
        dev.approved_at = utcnow()
        dev.risk_score = min(dev.risk_score, 10)
    elif status in ("suspicious", "blocked"):
        dev.risk_score = max(dev.risk_score, 70 if status == "suspicious" else 95)
    elif status == "untrusted":
        dev.risk_score = max(dev.risk_score, 50)
    db.add(DeviceTrustHistory(device_id=dev.id, from_status=prev, to_status=status,
                              changed_by_id=actor.id if actor else None, reason=reason))
    sev = "high" if status == "blocked" else "medium" if status in ("suspicious", "untrusted") else "informational"
    audit.record(db, f"device.trust_changed", "device", actor=actor, severity=sev, ip=ip, target_type="device",
                 target_id=dev.id, target_label=dev.name, details={"from": prev, "to": status, "reason": reason})
    queue_event(db, "device.updated", {"id": str(dev.id), "name": dev.name, "trust_status": status, "from": prev}, ADMINS)
    if dev.user_id:
        queue_event(db, "device.updated", {"id": str(dev.id), "name": dev.name, "trust_status": status},
                    {"users": [str(dev.user_id)]})
        notify_user(db, dev.user_id, f"Device trust changed: {dev.name}", f"Trust status changed from {prev} to {status}.",
                    category="device", severity=sev, link="/devices")
